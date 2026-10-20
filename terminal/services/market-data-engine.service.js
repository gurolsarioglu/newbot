/** Binance market data. Rolling 24h tickers are never used as candle volume. */
const EventEmitter = require('events');
const WebSocket = require('ws');
const https = require('https');
const INTERVALS = new Set(['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M']);

class RingBuffer {
  // 250 completed candles plus the forming candle.
  constructor(capacity = 251) { this.capacity = capacity; this.buffer = []; }
  push(item) {
    const i = this.buffer.findIndex(k => k.openTime === item.openTime);
    if (i >= 0) {
      const old = this.buffer[i];
      if ((old.isClosed && !item.isClosed) || (old.receivedAt || 0) > (item.receivedAt || 0)) return;
      this.buffer[i] = item;
    } else {
      this.buffer.push(item);
      this.buffer.sort((a, b) => a.openTime - b.openTime);
      if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    }
  }
  getAll() { return this.buffer.slice(); }
  get length() { return this.buffer.length; }
  get latest() { return this.buffer.at(-1) || null; }
}

class MarketDataEngine extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    for (const key of ['tickerMap', 'markPriceMap', 'klineBuffers', 'klineFetchedAt', 'klineRequests', 'liveCandles', 'alertedCandles', 'minuteReferences']) this[key] = new Map();
    this.subscriptions = new Set();
    this.klineSockets = [];
    this.reconnectTimers = new Set();
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.usedWeight1m = 0;
    this.maxWeightPerMinute = 1200;
    this.weightWindow = Math.floor(Date.now() / 60000);
    this.rateBlockedUntil = 0;
    this.stopped = false;
    this.generation = 0;
    this.activeRequests = new Set();
  }
  safeFetch(url, weight = 1) {
    if (this.stopped) return Promise.reject(new Error('Market data engine stopped'));
    if (!Number.isFinite(weight) || weight < 0 || weight > this.maxWeightPerMinute) return Promise.reject(new Error('Invalid request weight'));
    return new Promise((resolve, reject) => { this.requestQueue.push({ url, weight, resolve, reject, retries: 0 }); this._processQueue(); });
  }
  async _processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    try {
      while (this.requestQueue.length && !this.stopped) {
        const now = Date.now(), window = Math.floor(now / 60000);
        if (window !== this.weightWindow) { this.weightWindow = window; this.usedWeight1m = 0; }
        const item = this.requestQueue[0];
        if (now < this.rateBlockedUntil || this.usedWeight1m + item.weight > this.maxWeightPerMinute) { await new Promise(r => setTimeout(r, 250)); continue; }
        this.requestQueue.shift();
        this.usedWeight1m += item.weight;
        try { item.resolve(await this._httpGet(item.url)); }
        catch (err) {
          if ((err.statusCode === 429 || err.statusCode === 418) && item.retries++ < 2) {
            this.rateBlockedUntil = Date.now() + Math.max(err.retryAfterMs || 60000, 1000);
            this.requestQueue.unshift(item);
          } else item.reject(err);
        }
        if (this.requestQueue.length) await new Promise(r => setTimeout(r, 30));
      }
    } finally { this.isProcessingQueue = false; }
  }
  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'AlphaTerminal/3.0', Accept: 'application/json' }, timeout: 8000 }, res => {
        const weight = Number(res.headers['x-mbx-used-weight-1m']);
        if (Number.isFinite(weight)) this.usedWeight1m = Math.max(this.usedWeight1m, weight);
        if (res.statusCode !== 200) {
          const err = new Error(`HTTP ${res.statusCode}`);
          err.statusCode = res.statusCode;
          err.retryAfterMs = Number(res.headers['retry-after']) * 1000;
          res.resume(); reject(err); return;
        }
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('error', reject);
        res.on('aborted', () => reject(new Error('HTTP response aborted')));
        res.on('end', () => { try { resolve(JSON.parse(data)); } catch (err) { reject(err); } });
      });
      this.activeRequests.add(req);
      req.on('close', () => this.activeRequests.delete(req));
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('HTTP Timeout')));
    });
  }
  _reconnect(fn, delay = 5000) {
    if (!this.isRunning) return;
    const timer = setTimeout(() => { this.reconnectTimers.delete(timer); if (this.isRunning) fn(); }, delay);
    this.reconnectTimers.add(timer);
  }
  start() {
    if (this.isRunning) return;
    this.isRunning = true; this.stopped = false;
    this.generation++;
    this.primeTickersFromRest();
    this._connectMarketSocket('miniTickerWs', '!miniTicker@arr', data => this._handleMiniTickers(data));
    this._connectMarketSocket('markPriceWs', '!markPrice@arr@1s', data => this._handleMarkPrices(data));
    this.klineSockets = [];
    for (const stream of this.subscriptions) this._assignStream(stream);
  }
  _connectMarketSocket(field, stream, handler) {
    const generation = this.generation;
    const ws = new WebSocket(`wss://fstream.binance.com/market/ws/${stream}`);
    this[field] = ws;
    ws.on('message', raw => {
      try { const msg = JSON.parse(raw); const arr = msg.data || msg; if (Array.isArray(arr)) handler(arr); }
      catch (err) { console.warn(`[MarketData] ${stream}: ${err.message}`); }
    });
    ws.on('error', err => console.warn(`[MarketData] ${stream}: ${err.message}`));
    ws.on('close', () => { if (generation === this.generation) this._reconnect(() => this._connectMarketSocket(field, stream, handler)); });
  }
  async primeTickersFromRest() {
    try {
      const data = await this.safeFetch('https://fapi.binance.com/fapi/v1/ticker/24hr', 40);
      if (Array.isArray(data)) this._handleMiniTickers(data.map(t => ({ s: t.symbol, c: t.lastPrice, o: t.openPrice, h: t.highPrice, l: t.lowPrice, q: t.quoteVolume, P: t.priceChangePercent, E: t.closeTime })));
    } catch (err) { console.warn('[MarketData] Ticker warm-up:', err.message); }
  }
  _handleMiniTickers(tickers) {
    for (const t of tickers) {
      if (!t.s || !t.s.endsWith('USDT')) continue;
      const price = Number(t.c), vol = Number(t.q), eventTime = Number(t.E) || Date.now();
      if (!(price > 0) || !Number.isFinite(vol) || vol < 0 || (this.tickerMap.get(t.s)?.eventTime || 0) > eventTime) continue;
      this.tickerMap.set(t.s, { symbol: t.s, price: t.c, priceNum: price, open24h: Number(t.o), high24h: Number(t.h), low24h: Number(t.l), chg24Pct: t.P !== undefined ? Number(t.P) : (price / Number(t.o) - 1) * 100, volUsd: vol, eventTime });
      if (vol >= 1000000) this._subscribeKline(t.s, '1m');
    }
  }
  _subscribeKline(symbol, interval) {
    const stream = `${symbol.toLowerCase()}@kline_${interval}`;
    if (this.subscriptions.has(stream)) return;
    this.subscriptions.add(stream);
    if (this.isRunning) this._assignStream(stream);
  }
  _assignStream(stream) {
    let group = this.klineSockets.find(g => g.streams.size < 180);
    if (!group) { group = { streams: new Set(), ws: null, flushTimer: null }; this.klineSockets.push(group); this._connectKlineSocket(group); }
    group.streams.add(stream);
    this._flushSubscriptions(group);
  }
  _connectKlineSocket(group) {
    if (!this.isRunning) return;
    const generation = this.generation;
    for (const stream of group.streams) {
      const [symbol, interval] = stream.split('@kline_');
      this.klineFetchedAt.delete(`${symbol.toUpperCase()}_${interval}`);
    }
    const ws = new WebSocket('wss://fstream.binance.com/market/stream');
    group.ws = ws; group.sent = new Set();
    ws.on('open', () => this._flushSubscriptions(group));
    ws.on('message', raw => {
      try { const msg = JSON.parse(raw); const event = msg.data || msg; if (event.e === 'kline') this._handleKline(event); else if (msg.code) console.warn('[MarketData] Subscription error:', msg.msg); }
      catch (err) { console.warn('[MarketData] Kline:', err.message); }
    });
    ws.on('error', err => console.warn('[MarketData] Kline WS:', err.message));
    ws.on('close', () => { clearTimeout(group.flushTimer); group.flushTimer = null; if (generation === this.generation) this._reconnect(() => this._connectKlineSocket(group)); });
  }
  _flushSubscriptions(group) {
    if (group.flushTimer || group.ws?.readyState !== WebSocket.OPEN) return;
    group.flushTimer = setTimeout(() => {
      group.flushTimer = null;
      if (!this.isRunning || group.ws?.readyState !== WebSocket.OPEN) return;
      const pending = [...group.streams].filter(s => !group.sent.has(s));
      const batch = pending.slice(0, 40);
      if (batch.length) {
        group.ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: batch, id: Date.now() }));
        batch.forEach(s => group.sent.add(s));
      }
      if (pending.length > batch.length) this._flushSubscriptions(group);
    }, 250);
  }
  _handleKline(event) {
    const k = event.k, symbol = event.s || k?.s;
    if (!k || !symbol?.endsWith('USDT') || !INTERVALS.has(k.i)) return;
    const candle = { time: k.t / 1000, openTime: Number(k.t), closeTime: Number(k.T), open: Number(k.o), high: Number(k.h), low: Number(k.l), close: Number(k.c), volume: Number(k.v), quoteVolume: Number(k.q), isClosed: k.x === true, eventTime: Number(event.E), receivedAt: Date.now() };
    if (![candle.openTime, candle.closeTime, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.quoteVolume, candle.eventTime].every(Number.isFinite) || candle.close <= 0 || candle.quoteVolume < 0) return;
    const key = `${symbol}_${k.i}`, previous = this.liveCandles.get(key);
    if (previous && (previous.openTime > candle.openTime || (previous.openTime === candle.openTime && (previous.eventTime > candle.eventTime || previous.isClosed)))) return;
    if (k.i === '1m' && previous?.isClosed && previous.openTime === candle.openTime - 60000) this.minuteReferences.set(symbol, { openTime: candle.openTime, price: previous.close });
    this.liveCandles.set(key, candle);
    this.klineBuffers.get(key)?.push(candle);
    if (candle.isClosed) this.emit('candleClosed', { symbol, interval: k.i, candle: { ...candle } });
    if (k.i !== '1m') return;
    const ticker = this.getTicker(symbol);
    if (!ticker || ticker.volUsd < 1000000 || candle.eventTime - ticker.eventTime > 120000) return;
    const configured = Number(process.env.M1_SCAN_SECOND ?? 45);
    const scanSecond = Number.isFinite(configured) ? Math.max(0, Math.min(59, configured)) : 45;
    if ((candle.eventTime - candle.openTime) / 1000 < scanSecond) return;
    const reference = this.minuteReferences.get(symbol);
    const referencePrice = reference?.openTime === candle.openTime ? reference.price : candle.open;
    const change = (candle.close / referencePrice - 1) * 100;
    if (Math.abs(change) >= 0.70 && this.alertedCandles.get(`${symbol}_m1`) !== candle.openTime) {
      this.alertedCandles.set(`${symbol}_m1`, candle.openTime);
      this.emit('radarAlert', { type: change < 0 ? 'm1a' : 'm1premium', symbol, price: candle.close, priceStr: k.c, candleMinute: candle.openTime / 60000, candleQuoteVol: candle.quoteVolume, candle: { ...candle }, timestamp: candle.eventTime });
    }
    if (candle.isClosed && ticker.volUsd > 10000000) this.emit('radarAlert', { type: 'v3', symbol, price: candle.close, volUsd: ticker.volUsd, candle: { ...candle }, timestamp: candle.eventTime });
  }
  _handleMarkPrices(arr) {
    for (const m of arr) {
      if (!m.s?.endsWith('USDT')) continue;
      const fundingRate = Number(m.r), markPrice = Number(m.p), nextFundingTime = Number(m.T), eventTime = Number(m.E) || Date.now();
      if (m.r === undefined || !Number.isFinite(fundingRate) || !(markPrice > 0) || !(nextFundingTime > 0)) continue;
      const prev = this.markPriceMap.get(m.s);
      if (prev && prev.eventTime > eventTime) continue;
      this.markPriceMap.set(m.s, { symbol: m.s, fundingRate, markPrice, nextFundingTime, eventTime, previousFundingRate: prev?.fundingRate ?? null });
      if ((prev?.fundingRate > 0 && fundingRate < 0) || fundingRate <= -0.001) this.emit('radarAlert', { type: 'fr', symbol: m.s, fundingRate, prevFundingRate: prev?.fundingRate ?? null, nextFundingTime, timestamp: eventTime });
    }
  }
  async getKlines(symbol, interval = '1h', limit = 250) {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!/^[A-Z0-9_]+USDT$/.test(sym) || !INTERVALS.has(interval) || !Number.isInteger(limit) || limit < 1 || limit > 251) return [];
    const key = `${sym}_${interval}`;
    this._subscribeKline(sym, interval);
    const buffer = this.klineBuffers.get(key), age = Date.now() - (this.klineFetchedAt.get(key) || 0), live = this.liveCandles.get(key);
    const streamFresh = live && Date.now() - live.eventTime < 10000;
    const candles = buffer?.getAll() || [];
    const continuous = candles.every((k, i) => !i || k.openTime === candles[i - 1].closeTime + 1);
    if (buffer?.length >= limit && continuous && (age < 30000 || streamFresh)) return candles.slice(-limit);
    if (!this.klineRequests.has(key)) this.klineRequests.set(key, this._loadKlines(sym, interval, key).finally(() => this.klineRequests.delete(key)));
    try { await this.klineRequests.get(key); } catch (err) { console.warn(`[MarketData] ${key}: ${err.message}`); return []; }
    return (this.klineBuffers.get(key)?.getAll() || []).slice(-limit);
  }
  async _loadKlines(symbol, interval, key) {
    const requestTime = Date.now(), generation = this.generation;
    const raw = await this.safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=251`, 2);
    if (this.stopped || generation !== this.generation) throw new Error('Market data request belongs to a stopped engine');
    if (!Array.isArray(raw)) throw new Error('Invalid kline response');
    const buffer = this.klineBuffers.get(key) || new RingBuffer();
    for (const k of raw) {
      const candle = { time: Number(k[0]) / 1000, openTime: Number(k[0]), open: Number(k[1]), high: Number(k[2]), low: Number(k[3]), close: Number(k[4]), volume: Number(k[5]), closeTime: Number(k[6]), quoteVolume: Number(k[7]), isClosed: Number(k[6]) < requestTime, eventTime: requestTime, receivedAt: requestTime };
      if ([candle.openTime, candle.open, candle.high, candle.low, candle.close, candle.volume, candle.closeTime, candle.quoteVolume].every(Number.isFinite) && candle.close > 0 && candle.quoteVolume >= 0) buffer.push(candle);
    }
    const live = this.liveCandles.get(key);
    if (live) buffer.push(live);
    this.klineBuffers.set(key, buffer); this.klineFetchedAt.set(key, Date.now());
  }
  async getFreshKlines(symbol, interval = '1m', limit = 250) { this.klineFetchedAt.delete(`${String(symbol).toUpperCase()}_${interval}`); return this.getKlines(symbol, interval, limit); }
  getTicker(symbol) { return this.tickerMap.get(String(symbol || '').trim().toUpperCase()) || null; }
  getMarkPrice(symbol) { return this.markPriceMap.get(String(symbol || '').trim().toUpperCase()) || null; }
  getAllTickers() { return [...this.tickerMap.values()]; }
  getTopNegativeFunding(limit = 10) { return [...this.markPriceMap.values()].filter(m => m.fundingRate < 0 && Date.now() - m.eventTime < 120000).sort((a, b) => a.fundingRate - b.fundingRate).slice(0, limit); }
  get trackedSymbolsCount() { return this.tickerMap.size; }
  stop() {
    this.isRunning = false; this.stopped = true;
    this.generation++;
    for (const timer of this.reconnectTimers) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const group of this.klineSockets) { clearTimeout(group.flushTimer); group.ws?.terminate(); }
    this.miniTickerWs?.terminate(); this.markPriceWs?.terminate();
    for (const req of this.activeRequests) req.destroy(new Error('Market data engine stopped'));
    for (const item of this.requestQueue.splice(0)) item.reject(new Error('Market data engine stopped'));
  }
}
module.exports = new MarketDataEngine();
