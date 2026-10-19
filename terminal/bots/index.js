/** Local Binance strategies. Missing observations never become estimated metrics. */
const marketDataEngine = require('../services/market-data-engine.service');
const quant = require('../services/quant-indicators.service');
const derivatives = require('../services/derivatives-enricher.service');
const { formatCryptoPrice } = require('../services/price-formatter');
const BOT_DEFINITIONS = [
  ['hammerproplus', './strategies/hammer-pro-plus.bot', ['hammerpro+', 'hammer-pro-plus', 'proplus', '15m']],
  ['hammerpro', './strategies/hammer-pro.bot', ['hammer-pro', 'hammer']],
  ['4ssniper', './strategies/four-s-sniper.bot', ['4s-sniper', 'sniper', '4ss']],
  ['4s', './strategies/four-s.bot', ['four_s', '4-s', '4spro']],
  ['v3', './strategies/v3-volume.bot', ['v3-a', 'v3a', 'volume']],
  ['div', './strategies/divergence.bot', ['divergence', '1g', '1gpro']],
  ['fr', './strategies/funding-rate.bot', ['funding', 'fundingrate', 'funding-rate']],
  ['m1a', './strategies/m1a-drop.bot', ['m1', 'm1-a', 'ma-1', 'm1adrop', 'drop']],
  ['m1premium', './strategies/m1-premium.bot', ['m1p', 'm1-premium', 'premium', 'm1_premium']]
];

class BotManager {
  constructor() {
    this.bots = new Map(); this.aliasMap = new Map();
    this.isEngineRunning = false; this.structureScanTimer = null;
    this.pendingRadar = new Map(); this.scanRunning = false; this.generation = 0;
    for (const [id, file, aliases] of BOT_DEFINITIONS) this.register(id, require(file), aliases);
  }
  register(id, bot, aliases = []) { this.bots.set(id, bot); [id, ...aliases].forEach(alias => this.aliasMap.set(alias, id)); }
  getBot(identifier) { return this.bots.get(this.aliasMap.get(String(identifier || 'hammerproplus').toLowerCase().trim())) || null; }
  getAllBots() { return [...this.bots.values()]; }
  emitSignal(data) {
    if (!data || typeof data !== 'object' || typeof (data.symbol || data.coin) !== 'string') throw new Error('Gecersiz sinyal verisi');
    const symbol = (data.symbol || data.coin).trim().toUpperCase();
    if (!/^[A-Z0-9_]+USDT$/.test(symbol)) throw new Error('Gecersiz sembol');
    const bot = this.getBot(data.botId || data.botType);
    if (!bot) throw new Error('Bilinmeyen bot');
    const signal = bot.ingest({ ...data, symbol, coin: symbol });
    return { symbol, affectedBots: signal ? [bot.id] : [], time: new Date().toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) };
  }
  routeSignal(data) { return this.emitSignal(data); }
  startBackgroundEngine() {
    if (this.isEngineRunning) return;
    this.isEngineRunning = true;
    this.generation++;
    this.radarListener = alert => this._handleRadarAlert(alert).catch(err => console.warn('[BotManager radar]', err.message));
    this.closedListener = event => { if (['5m', '1h', '4h'].includes(event.interval)) this._scanStructuralSetups().catch(err => console.warn('[BotManager scan]', err.message)); };
    marketDataEngine.on('radarAlert', this.radarListener);
    marketDataEngine.on('candleClosed', this.closedListener);
    marketDataEngine.start();
    this.initialScanTimer = setTimeout(() => this._scanStructuralSetups().catch(err => console.warn('[BotManager scan]', err.message)), 3500);
    this.structureScanTimer = setInterval(() => {
      this._scanStructuralSetups().catch(err => console.warn('[BotManager scan]', err.message));
      this._scanFundingRates().catch(err => console.warn('[BotManager funding]', err.message));
    }, 45000);
    this.structureScanTimer.unref?.();
  }
  _metadata(timestamp) {
    const date = new Date(timestamp);
    return { timestamp, isoDate: date.toISOString(), dateStr: date.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' }), time: date.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' }) };
  }
  async _computeM1Metrics(alert) {
    const snapshot = alert.candle;
    if (!snapshot || !Number.isFinite(snapshot.quoteVolume) || snapshot.quoteVolume < 0 || !Number.isInteger(snapshot.openTime) || snapshot.openTime % 60000 !== 0 || alert.timestamp < snapshot.openTime || alert.timestamp > snapshot.openTime + 70000) return null;
    const klines = await marketDataEngine.getKlines(alert.symbol, '1m', 251);
    const closed = klines.filter(k => k.openTime < snapshot.openTime && k.closeTime < snapshot.openTime).slice(-249);
    if (closed.length !== 249 || closed.at(-1).openTime !== snapshot.openTime - 60000) return null;
    if (closed.some((k, i) => i && k.openTime - closed[i - 1].openTime !== 60000)) return null;
    const prev = closed.at(-1);
    if (!(prev.close > 0) || !(prev.quoteVolume > 0) || !(snapshot.close > 0)) return null;
    const closes = closed.map(k => k.close).concat(snapshot.close);
    const rsi = quant.calculateRSI(closes, 14);
    const stoch = quant.calculateStochRSI(rsi.rsiSeries, 14, 3, 3);
    if (![rsi.rsi, stoch.k, stoch.d].every(Number.isFinite)) return null;
    const result = { prevClose: prev.close, pct: (snapshot.close / prev.close - 1) * 100, volDelta: (snapshot.quoteVolume / prev.quoteVolume - 1) * 100, rsi: Math.round(rsi.rsi), stochK: Math.round(stoch.k), stochD: Math.round(stoch.d) };
    return Object.values(result).every(Number.isFinite) ? result : null;
  }
  async _closedMetrics(symbol, interval, timestamp) {
    const raw = await marketDataEngine.getKlines(symbol, interval, 251);
    const closed = raw.filter(k => k.closeTime < timestamp).slice(-250);
    if (closed.length !== 250) return null;
    if (closed.some((k, i) => i && k.openTime !== closed[i - 1].closeTime + 1)) return null;
    const duration = closed.at(-1).closeTime - closed.at(-1).openTime + 1;
    if (timestamp - closed.at(-1).closeTime > duration + 10000) return null;
    const metrics = quant.calculateAllMetrics(closed);
    return metrics ? { ...metrics, candles: closed, last: closed.at(-1), previous: closed.at(-2) } : null;
  }
  async _handleRadarAlert(alert) {
    if (!alert?.symbol || !Number.isFinite(alert.timestamp)) return;
    const key = `${alert.symbol}_${alert.type}`;
    const generation = this.generation;
    if (this.pendingRadar.get(key) === generation) return;
    this.pendingRadar.set(key, generation);
    try { await this._processRadarAlert(alert); }
    finally { if (this.pendingRadar.get(key) === generation) this.pendingRadar.delete(key); }
  }
  async _processRadarAlert(alert) {
    const sym = alert.symbol, timestamp = alert.timestamp, meta = this._metadata(timestamp);
    const generation = this.generation;
    if (alert.type === 'm1a' || alert.type === 'm1premium') {
      const candleTime = alert.candle?.openTime;
      if (!this.getBot('m1a').canEmitSignal(sym, '1m', candleTime, 45000)) return;
      const m = await this._computeM1Metrics(alert);
      if (generation !== this.generation) return;
      if (!m || Math.abs(m.pct) < 0.70) return;
      const drop = m.pct < 0, pct = `${drop ? '' : '+'}${m.pct.toFixed(2)}%`;
      const common = { ...meta, symbol: sym, candleOpenTime: candleTime, timeframe: '1m', currentPrice: formatCryptoPrice(alert.candle.close, sym), prevPrice: formatCryptoPrice(m.prevClose, sym), volume: `${m.volDelta.toFixed(2)}%`, volumeSource: 'binance-kline-quote', currentQuoteVolume: alert.candle.quoteVolume, dot: drop ? '🔴' : '🟢' };
      this.getBot('m1a').addSignal({ ...common, id: `m1a_${sym}_${candleTime}`, type: drop ? 'drop' : 'boost', ...(drop ? { dropValue: pct } : { boostValue: pct }), rsi: `${m.rsi}${m.rsi <= 30 || m.rsi >= 70 ? ' ⚠️' : ''}`, stochastic: `${m.stochK}/${m.stochD}${m.stochK <= 20 || m.stochK >= 80 ? ' ⚠️' : ''}`, btcStatus: '—' });
      if (!drop && this.getBot('m1premium').canEmitSignal(sym, '1m', candleTime, 45000)) {
        const [m5, h1] = await Promise.all([this._closedMetrics(sym, '5m', timestamp), this._closedMetrics(sym, '1h', timestamp)]);
        if (generation !== this.generation) return;
        const label = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
        this.getBot('m1premium').addSignal({ ...common, id: `m1p_${sym}_${candleTime}`, boostValue: pct, stars: m.pct >= 1.50 ? '⭐️' : '', isFavorite: m.pct >= 1.50, rsi: { m1: label(m.rsi), m5: label(m5?.rsi), h1: label(h1?.rsi) }, srsi: { m1: label(m.stochK), m5: label(m5?.srsiK), h1: label(h1?.srsiK) } });
      }
      return;
    }
    if (alert.type === 'v3') {
      const bot = this.getBot('v3'), candle = alert.candle;
      if (!candle?.isClosed || !bot.canEmitSignal(sym, '1m', candle.openTime, 300000) || !(alert.volUsd > 10000000)) return;
      const raw = await marketDataEngine.getKlines(sym, '1m', 251);
      if (generation !== this.generation) return;
      const prior = raw.filter(k => k.openTime < candle.openTime && k.closeTime < candle.openTime).slice(-20);
      if (prior.length !== 20 || prior.at(-1).openTime !== candle.openTime - 60000 || prior.some((k, i) => i && k.openTime !== prior[i - 1].openTime + 60000)) return;
      const avg = prior.reduce((sum, k) => sum + k.quoteVolume, 0) / 20;
      if (!(avg > 0) || !Number.isFinite(candle.quoteVolume)) return;
      const delta = (candle.quoteVolume / avg - 1) * 100;
      if (delta < 25) return;
      bot.addSignal({ ...meta, symbol: sym, id: `v3_${sym}_${candle.openTime}`, candleOpenTime: candle.openTime, timeframe: '1m', hacimChange: `+${delta.toFixed(2)}%`, hacim24s: `$${(alert.volUsd / 1000000).toFixed(1)}M`, volumeSource: 'binance-kline-quote-sma20' });
      return;
    }
    if (alert.type === 'fr') {
      const bot = this.getBot('fr');
      const flip = Number.isFinite(alert.prevFundingRate) && alert.prevFundingRate > 0 && alert.fundingRate < 0;
      if ((!flip && !(alert.fundingRate <= -0.001)) || !bot.canEmitSignal(sym, 'fr', null, 900000)) return;
      const data = await derivatives.enrich(sym, marketDataEngine.getMarkPrice(sym));
      if (generation !== this.generation) return;
      if (!data || !(data.oiDeltaPct > 0)) return;
      const prev = alert.prevFundingRate;
      const remaining = Math.max(0, Math.floor((alert.nextFundingTime - timestamp) / 1000));
      const countdown = [Math.floor(remaining / 3600), Math.floor(remaining % 3600 / 60), remaining % 60].map(n => String(n).padStart(2, '0')).join(':');
      bot.addSignal({ ...meta, symbol: sym, id: `fr_${sym}_${timestamp}`, dot: flip ? '🟢' : '🔴', alertText: flip ? 'Funding changed from + to -' : 'Negative Funding (OI rising)', fundingRate: `${(alert.fundingRate * 100).toFixed(4)}%`, previousFunding: Number.isFinite(prev) ? `${(prev * 100).toFixed(4)}%` : '—', difference: Number.isFinite(prev) ? `${((alert.fundingRate - prev) * 100).toFixed(4)}%` : '—', timeRemaining: countdown });
    }
  }
  async _scanFundingRates() {
    for (const item of marketDataEngine.getTopNegativeFunding(10)) await this._handleRadarAlert({ type: 'fr', symbol: item.symbol, fundingRate: item.fundingRate, prevFundingRate: item.previousFundingRate, nextFundingTime: item.nextFundingTime, timestamp: item.eventTime });
  }
  async _scanStructuralSetups() {
    const generation = this.generation;
    if (this.scanRunning && this.scanGeneration === generation) return;
    this.scanRunning = true; this.scanGeneration = generation;
    try {
      const now = Date.now();
      const candidates = marketDataEngine.getAllTickers().filter(t => now - t.eventTime < 120000 && t.volUsd > 1000000).sort((a, b) => b.volUsd - a.volUsd).slice(0, 15);
      for (const ticker of candidates) {
        if (generation !== this.generation) break;
        try { await this._scanSymbol(ticker.symbol, now); }
        catch (err) { console.warn(`[BotManager ${ticker.symbol}]`, err.message); }
      }
    } finally { if (this.scanGeneration === generation) this.scanRunning = false; }
  }
  async _scanSymbol(sym, now) {
    const generation = this.generation;
    const [m1, m5, h1, h4, d1, daily] = await Promise.all([
      ...['1m', '5m', '1h', '4h', '1d'].map(tf => this._closedMetrics(sym, tf, now)),
      marketDataEngine.getKlines(sym, '1d', 2)
    ]);
    if (generation !== this.generation) return;
    if (!h1) return;
    // Session pivots come from the previous completed UTC day, not a random 5m candle.
    const previousDay = daily.filter(k => k.closeTime < now).at(-1);
    const pivots = previousDay ? quant.calculatePivots(previousDay, (m5 || h1).last.close) : null;
    const label = value => Number.isFinite(value) ? String(Math.round(value)) : '—';
    const rsi = { m1: label(m1?.rsi), m5: label(m5?.rsi), h1: label(h1.rsi), h4: label(h4?.rsi), d1: label(d1?.rsi) };
    const srsi = { m1: label(m1?.srsiK), m5: label(m5?.srsiK), h1: label(h1.srsiK), h4: label(h4?.srsiK), d1: label(d1?.srsiK) };
    const add = (id, metric, tf, cooldown, fields = {}) => {
      const bot = this.getBot(id);
      if (!bot.canEmitSignal(sym, tf, metric.last.openTime, cooldown)) return;
      const change = (metric.last.close / metric.previous.close - 1) * 100;
      return bot.addSignal({ ...this._metadata(metric.last.closeTime + 1), id: `${id}_${sym}_${metric.last.openTime}`, symbol: sym, candleOpenTime: metric.last.openTime, timeframe: tf, currentPrice: formatCryptoPrice(metric.last.close, sym), prevPrice: formatCryptoPrice(metric.previous.close, sym), boostValue: `${change >= 0 ? '+' : ''}${change.toFixed(2)}%`, rsi, srsi, pivot: pivots ? `%${pivots.pivotDistancePct.toFixed(2)}` : '—', ...fields });
    };
    if (m1 && m5 && h4 && m5.rsi <= 30 && h1.rsi <= 30 && Number.isFinite(m5.srsiK) && Number.isFinite(h1.srsiK) && m5.srsiK <= 15 && h1.srsiK <= 15 && m1.wtCrossUp && h4.last.close >= h4.ema200) add('hammerpro', m5, '5m', 300000, { dot: '🟢', strategy: '#W1 Dip Donus', wt: '1m 🟢 Cross' });
    if (m1 && m5 && pivots && m1.rsi <= 30 && m5.rsi <= 30 && h1.rsi <= 30 && m1.wtCrossUp && m1.wt1 <= -50 && pivots.pivotDistancePct <= 0.50) add('hammerproplus', m5, '5m', 300000, { dot: '🟢', strategy: '#W1 / #S1', wt: '1m 🟢 Cross' });
    const div = h1.divergence;
    if (div?.hasBullDiv || div?.hasBearDiv) add('div', h1, '1h', 900000, { dot: div.hasBullDiv ? '🟢' : '🔴', strategy: '1H RSI DIVERGENCE' });
    if (!h4) return;
    const sniper = h1.rsi <= 30 && ((Number.isFinite(h4.srsiK) && h4.srsiK <= 5) || (Number.isFinite(d1?.srsiK) && d1.srsiK <= 5));
    const momentum = (h4.last.close / h4.previous.close - 1) * 100 >= 4;
    if (!sniper && !momentum) return;
    const data = await derivatives.enrich(sym, marketDataEngine.getMarkPrice(sym));
    if (generation !== this.generation) return;
    if (!Number.isFinite(data?.topTraderLongRatio) || !Number.isFinite(data?.globalLongRatio)) return;
    const ratios = { traderPositioning: `${data.topTraderLongRatio}%`, traderDot: data.topTraderLongRatio >= 50 ? '🟢' : '🔴', marketExposure: `${data.globalLongRatio}%`, exposureDot: data.globalLongRatio >= 50 ? '🟢' : '🔴' };
    if (sniper && data.topTraderLongRatio >= 60) add('4ssniper', h1, '1h', 600000, { ...ratios, dot: '🟢', strategy: 'NW UP' });
    if (momentum) add('4s', h4, '4h', 600000, { ...ratios, dot: data.topTraderLongRatio >= data.globalLongRatio ? '🟢' : '🔴', strategy: '4H Yapi Momentum' });
  }
  stopBackgroundEngine() {
    this.isEngineRunning = false;
    this.generation++;
    clearTimeout(this.initialScanTimer); clearInterval(this.structureScanTimer);
    if (this.radarListener) marketDataEngine.off('radarAlert', this.radarListener);
    if (this.closedListener) marketDataEngine.off('candleClosed', this.closedListener);
    marketDataEngine.stop();
  }
}
module.exports = new BotManager();
