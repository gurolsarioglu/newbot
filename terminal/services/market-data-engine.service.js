/**
 * market-data-engine.service.js — Alpha Terminal İki Aşamalı Piyasa Veri Motoru
 * 
 * Aşama 1: Geniş Piyasa Radarı (WebSocket !miniTicker@arr ve !markPrice@arr@1s)
 * - 745+ Vadeli sembolün tamamını anlık izler, 60s kayan pencere (Sliding Window) tutar.
 * 
 * Aşama 2: Dinamik Kline Havuzu ve 250 Mumluk Ring Buffer
 * - Sadece aday ve aktif coinler için 250 mumluk ısınmalı hafıza yapısı yönetir.
 * 
 * Token Bucket Rate-Limit koruması ile Binance IP limitlerini (429/418) asla aşmaz.
 */

const EventEmitter = require('events');
const WebSocket = require('ws');
const https = require('https');
const symbolRegistry = require('./symbol-registry.service');

class RingBuffer {
  constructor(capacity = 250) {
    this.capacity = capacity;
    this.buffer = [];
  }

  push(item) {
    if (this.buffer.length >= this.capacity) {
      this.buffer.shift();
    }
    this.buffer.push(item);
  }

  updateLatest(item) {
    if (this.buffer.length === 0) {
      this.buffer.push(item);
    } else {
      this.buffer[this.buffer.length - 1] = item;
    }
  }

  getAll() {
    return this.buffer;
  }

  get length() {
    return this.buffer.length;
  }

  get latest() {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }
}

class MarketDataEngine extends EventEmitter {
  constructor() {
    super();
    this.miniTickerWs = null;
    this.markPriceWs = null;
    this.isRunning = false;
    this.reconnectAttempts = 0;

    // 745+ Vadeli parite anlık metrikleri
    this.tickerMap = new Map(); // symbol -> { price, priceNum, open24h, high24h, low24h, volUsd, eventTime }
    this.markPriceMap = new Map(); // symbol -> { markPrice, fundingRate, nextFundingTime }

    // 60 Saniyelik kayan pencere (Sliding Window) her sembol için: [ { ts, price, vol } ]
    this.slidingWindows = new Map();

    // 1 Dakikalık Mum Referans Takipçisi (Önceki 1m mum kapanışı bazlı)
    this.m1MinuteMap = new Map(); // symbol -> { minute, refPrice, lastPrice }

    // 250 Mumluk Kline Ring Buffer Havuzu: "${symbol}_${interval}" -> RingBuffer(250)
    this.klineBuffers = new Map();

    // Rate Limiting (Token Bucket)
    this.requestQueue = [];
    this.isProcessingQueue = false;
    this.usedWeight1m = 0;
    this.maxWeightPerMinute = 1200; // Binance 2400 limitinin güvenli yarısı
    this.weightResetInterval = null;

    this._startWeightTracker();
  }

  _startWeightTracker() {
    if (this.weightResetInterval) clearInterval(this.weightResetInterval);
    this.weightResetInterval = setInterval(() => {
      this.usedWeight1m = 0;
    }, 60000);
    if (this.weightResetInterval.unref) this.weightResetInterval.unref();
  }

  /**
   * Rate Limit korumalı REST isteği
   */
  async safeFetch(url, weight = 1) {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ url, weight, resolve, reject, retries: 0 });
      this._processQueue();
    });
  }

  async _processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const item = this.requestQueue[0];

      // Ağırlık limiti aşılırsa bekle
      if (this.usedWeight1m + item.weight > this.maxWeightPerMinute) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      this.requestQueue.shift();
      this.usedWeight1m += item.weight;

      try {
        const data = await this._httpGet(item.url);
        item.resolve(data);
      } catch (err) {
        if (err.message.includes('429') || err.message.includes('418')) {
          console.warn('[MarketDataEngine] Rate limit uyarisi! 5sn kuyruk donduruluyor...');
          await new Promise(r => setTimeout(r, 5000));
          if (item.retries < 3) {
            item.retries++;
            this.requestQueue.unshift(item);
          } else {
            item.reject(err);
          }
        } else {
          item.reject(err);
        }
      }

      // İstekler arasına minimum 30ms nefes payı
      await new Promise(r => setTimeout(r, 30));
    }

    this.isProcessingQueue = false;
  }

  _httpGet(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'AlphaTerminal/QuantEngine-2.0',
          'Accept': 'application/json'
        },
        timeout: 8000
      };

      https.get(url, options, (res) => {
        const headerWeight = res.headers['x-mbx-used-weight-1m'];
        if (headerWeight) {
          this.usedWeight1m = parseInt(headerWeight, 10);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject).on('timeout', () => reject(new Error('HTTP Timeout')));
    });
  }

  /**
   * WebSocket Motorunu Başlatır (Aşama 1)
   */
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[MarketDataEngine] WebSocket Genis Piyasa Radari baslatiliyor...');
    
    // REST ile hızlı başlangıç (Zero-latency warm-up)
    this.primeTickersFromRest();

    this._connectMiniTickerWs();
    this._connectMarkPriceWs();
  }

  async primeTickersFromRest() {
    try {
      const data = await this.safeFetch('https://fapi.binance.com/fapi/v1/ticker/24hr', 40);
      if (Array.isArray(data)) {
        const tickers = data.map(d => ({
          s: d.symbol,
          c: d.lastPrice,
          o: d.openPrice,
          h: d.highPrice,
          l: d.lowPrice,
          q: d.quoteVolume,
          P: d.priceChangePercent,
          E: d.closeTime
        }));
        this._handleMiniTickers(tickers);
        console.log(`[MarketDataEngine] ✅ REST 24hr Ticker ile ${this.tickerMap.size} vadeli sembol onceden yuklendi.`);
      }
    } catch (err) {
      console.warn('[MarketDataEngine] REST Ticker warm-up uyarisi:', err.message);
    }
  }

  _connectMiniTickerWs() {
    try {
      // Binance Futures güncel endpoint: /market/ws/
      this.miniTickerWs = new WebSocket('wss://fstream.binance.com/market/ws/!miniTicker@arr');

      this.miniTickerWs.on('open', () => {
        console.log('[MarketDataEngine] !miniTicker@arr WebSocket baglantisi kuruldu.');
        this.reconnectAttempts = 0;
      });

      this.miniTickerWs.on('message', (data) => {
        try {
          const parsed = JSON.parse(data);
          const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.data) ? parsed.data : null);
          if (arr && arr.length > 0) {
            if (!this._miniTickerLogged) {
              console.log(`[MarketDataEngine] ✅ Canli MiniTicker verisi akmaya basladi: ${arr.length} sembol.`);
              this._miniTickerLogged = true;
            }
            this._handleMiniTickers(arr);
          }
        } catch (e) {}
      });

      this.miniTickerWs.on('error', (err) => {
        console.warn('[MarketDataEngine] MiniTicker WS Hatasi:', err.message);
      });

      this.miniTickerWs.on('close', () => {
        if (!this.isRunning) return;
        const delay = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts++));
        console.log(`[MarketDataEngine] MiniTicker WS kapandi. ${delay}ms sonra tekrar baglanilacak...`);
        setTimeout(() => this._connectMiniTickerWs(), delay);
      });
    } catch (err) {
      console.error('[MarketDataEngine] WS Baglanti hatasi:', err.message);
    }
  }

  _connectMarkPriceWs() {
    try {
      // Binance Futures güncel endpoint: /market/ws/
      this.markPriceWs = new WebSocket('wss://fstream.binance.com/market/ws/!markPrice@arr@1s');

      this.markPriceWs.on('open', () => {
        console.log('[MarketDataEngine] !markPrice@arr@1s WebSocket baglantisi kuruldu.');
      });

      this.markPriceWs.on('message', (data) => {
        try {
          const parsed = JSON.parse(data);
          const arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.data) ? parsed.data : null);
          if (arr && arr.length > 0) {
            if (!this._markPriceLogged) {
              console.log(`[MarketDataEngine] ✅ Canli MarkPrice verisi akmaya basladi: ${arr.length} sembol.`);
              this._markPriceLogged = true;
            }
            this._handleMarkPrices(arr);
          }
        } catch (e) {}
      });

      this.markPriceWs.on('error', (err) => {
        console.warn('[MarketDataEngine] MarkPrice WS Hatasi:', err.message);
      });

      this.markPriceWs.on('close', () => {
        if (!this.isRunning) return;
        setTimeout(() => this._connectMarkPriceWs(), 5000);
      });
    } catch (err) {
      console.error('[MarketDataEngine] MarkPrice WS baslatilamadi:', err.message);
    }
  }

  _handleMiniTickers(tickers) {
    const now = Date.now();

    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const sym = t.s;
      if (!sym || !sym.endsWith('USDT')) continue;

      const curPrice = parseFloat(t.c);
      const openPrice = parseFloat(t.o);
      const highPrice = parseFloat(t.h);
      const lowPrice = parseFloat(t.l);
      const quoteVol = parseFloat(t.q); // USDT Hacmi
      const chg24Pct = t.P !== undefined ? parseFloat(t.P) : ((curPrice - openPrice) / (openPrice || 1) * 100);

      this.tickerMap.set(sym, {
        symbol: sym,
        price: t.c,
        priceNum: curPrice,
        open24h: openPrice,
        high24h: highPrice,
        low24h: lowPrice,
        chg24Pct,
        volUsd: quoteVol,
        eventTime: t.E || now
      });

      // 60 Saniyelik Sliding Window Guncelleme
      let sw = this.slidingWindows.get(sym);
      if (!sw) {
        sw = [];
        this.slidingWindows.set(sym, sw);
      }

      sw.push({ ts: now, price: curPrice, vol: quoteVol });

      // 60 saniyeden eski noktalari temizle
      const cutoff = now - 60000;
      while (sw.length > 1 && sw[0].ts < cutoff) {
        sw.shift();
      }

      // 1 Dakikalık Mum Referans Takipçisi (Önceki 1m mum kapanışı bazlı - Visivero standardı)
      // startVol: dakikanın ilk tick'indeki 24s kümülatif USDT hacmi -> canlı mum hacmi = quoteVol - startVol
      const curMinute = Math.floor(now / 60000);
      let m1State = this.m1MinuteMap.get(sym);
      if (!m1State || m1State.minute !== curMinute) {
        const hadPrev = !!m1State;
        const refPrice = m1State ? m1State.lastPrice : curPrice;
        m1State = {
          minute: curMinute,
          refPrice: refPrice,
          lastPrice: curPrice,
          startVol: quoteVol,
          volValid: hadPrev // ilk dakika (sunucu yeni açıldı) güvenilir değil
        };
        this.m1MinuteMap.set(sym, m1State);
      } else {
        m1State.lastPrice = curPrice;
      }

      const candle1mChangePct = m1State.refPrice > 0 ? ((curPrice - m1State.refPrice) / m1State.refPrice) * 100 : 0;
      const candleQuoteVol = m1State.volValid ? Math.max(0, quoteVol - m1State.startVol) : null;

      // 1 Dakikalık değişim analizi (Aşama 1 Radarı)
      if (sw.length >= 2) {
        const oldest = sw[0];
        const elapsed = now - oldest.ts;
        if (elapsed < 6000) continue; // En az 6 saniyelik veri penceresi

        const price1mChangePct = ((curPrice - oldest.price) / oldest.price) * 100;
        const vol1mChange = quoteVol - oldest.vol;
        const volChangePct = oldest.vol > 0 ? ((quoteVol - oldest.vol) / oldest.vol) * 100 : 0;

        // Hem mum başı (candle1mChangePct) hem kayan pencere (price1mChangePct) hareketini yakala
        const effChgPct = Math.abs(candle1mChangePct) >= Math.abs(price1mChangePct) ? candle1mChangePct : price1mChangePct;
        const effPrevPrice = Math.abs(candle1mChangePct) >= Math.abs(price1mChangePct) ? m1State.refPrice : oldest.price;

        // Anlık M1-A ve M1-Premium Radar Olayları (%100 Bağımsız Yerel Motor)
        // Yalnızca 24s hacmi $1M üzerinde olan ve en az %0.70 hareket eden gerçek pariteler taranır
        // Zamanlama (Visivero uyumu): ilk eşik geçişinde değil, mumun M1_SCAN_SECOND. saniyesinden sonra
        // değerlendirilir; eşik o anda hâlâ aşılıyorsa mum başına tek alarm üretilir.
        const scanSec = parseInt(process.env.M1_SCAN_SECOND || '45', 10);
        const secInMin = (now % 60000) / 1000;
        if (quoteVol >= 1000000 && secInMin >= scanSec && !m1State.alerted) {
          if (Math.abs(effChgPct) >= 0.70) m1State.alerted = true;
          if (effChgPct <= -0.70) {
            this.emit('radarAlert', {
              type: 'm1a',
              symbol: sym,
              price: curPrice,
              prevPrice: effPrevPrice,
              priceStr: t.c,
              dropPct: effChgPct,
              volUsd: quoteVol,
              volChangePct,
              candleQuoteVol,
              candleMinute: curMinute,
              timestamp: now
            });
          } else if (effChgPct >= 0.70) {
            this.emit('radarAlert', {
              type: 'm1premium',
              symbol: sym,
              price: curPrice,
              prevPrice: effPrevPrice,
              priceStr: t.c,
              boostPct: effChgPct,
              volUsd: quoteVol,
              volChangePct,
              candleQuoteVol,
              candleMinute: curMinute,
              timestamp: now
            });
          }
        }

        // V3 Hacim Radarı (Son 24 saatlik hacim > $3M ve anlık hacim sıçraması)
        if (quoteVol > 3000000 && vol1mChange > 80000) {
          this.emit('radarAlert', {
            type: 'v3',
            symbol: sym,
            price: curPrice,
            priceStr: t.c,
            volUsd: quoteVol,
            vol1mChange,
            timestamp: now
          });
        }
      }
    }
  }

  _handleMarkPrices(arr) {
    const now = Date.now();
    for (let i = 0; i < arr.length; i++) {
      const m = arr[i];
      const sym = m.s;
      if (!sym || !sym.endsWith('USDT')) continue;

      const fr = parseFloat(m.r || 0);
      const nextTime = m.T || (now + 14400000);
      const prev = this.markPriceMap.get(sym);

      this.markPriceMap.set(sym, {
        symbol: sym,
        markPrice: parseFloat(m.p || 0),
        fundingRate: fr,
        nextFundingTime: nextTime
      });

      // Funding Rate Anomali Tespiti (Pozitiften negatife geçiş veya negatif fonlama)
      if ((prev && prev.fundingRate > 0 && fr < 0) || (fr <= -0.00015)) {
        this.emit('radarAlert', {
          type: 'fr',
          symbol: sym,
          fundingRate: fr,
          prevFundingRate: prev ? prev.fundingRate : 0.0001,
          nextFundingTime: nextTime,
          timestamp: now
        });
      }
    }
  }

  getTopNegativeFunding(limit = 10) {
    return Array.from(this.markPriceMap.values())
      .filter(m => m.fundingRate < 0)
      .sort((a, b) => a.fundingRate - b.fundingRate)
      .slice(0, limit);
  }

  /**
   * Aşama 2: 250 Mumluk Isınmalı (Warm-up) Kline Buffer Yönetimi
   */
  async getKlines(symbol, interval = '1h', limit = 250) {
    if (!symbol) return [];
    const cleanSym = String(symbol).toUpperCase().trim();
    const key = `${cleanSym}_${interval}`;

    let buffer = this.klineBuffers.get(key);
    if (!buffer || buffer.length < Math.min(limit, 50)) {
      buffer = new RingBuffer(250);
      this.klineBuffers.set(key, buffer);

      // Binance REST ile 250 mumu tek seferde ısıt (Warm-up)
      try {
        const raw = await this.safeFetch(
          `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${interval}&limit=250`,
          1
        );

        if (Array.isArray(raw)) {
          raw.forEach(k => {
            buffer.push({
              time: Math.floor(k[0] / 1000),
              openTime: k[0],
              open: parseFloat(k[1]),
              high: parseFloat(k[2]),
              low: parseFloat(k[3]),
              close: parseFloat(k[4]),
              volume: parseFloat(k[5]),
              closeTime: k[6],
              quoteVolume: parseFloat(k[7])
            });
          });
        }
      } catch (e) {
        console.warn(`[MarketDataEngine] ${key} klines warm-up hatasi:`, e.message);
      }
    }

    return buffer.getAll();
  }

  /**
   * Sinyal anında en güncel ve canlı mumları doğrudan Binance REST ile çeker
   * Son mum: Canlı oluşan 1m mumu (güncel hacim ve açılış fiyatı)
   * Sondan bir önceki mum: Kapanmış önceki 1m mumu (referans hacim)
   */
  async getFreshKlines(symbol, interval = '1m', limit = 100) {
    if (!symbol) return [];
    const cleanSym = String(symbol).toUpperCase().trim();
    try {
      const raw = await this.safeFetch(
        `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSym}&interval=${interval}&limit=${limit}`,
        1
      );
      if (Array.isArray(raw)) {
        return raw.map(k => ({
          time: Math.floor(k[0] / 1000),
          openTime: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6],
          quoteVolume: parseFloat(k[7])
        }));
      }
    } catch (e) {
      console.warn(`[MarketDataEngine] ${cleanSym} fresh klines hatasi:`, e.message);
    }
    return [];
  }

  /**
   * Sembolün en güncel ticker bilgisini döner
   */
  getTicker(symbol) {
    if (!symbol) return null;
    return this.tickerMap.get(String(symbol).toUpperCase().trim()) || null;
  }

  /**
   * Sembolün en güncel Mark Price ve Fonlama bilgisini döner
   */
  getMarkPrice(symbol) {
    if (!symbol) return null;
    return this.markPriceMap.get(String(symbol).toUpperCase().trim()) || null;
  }

  /**
   * 745+ sembolün tamamını döner
   */
  getAllTickers() {
    return Array.from(this.tickerMap.values());
  }

  /**
   * Aktif sembol sayısı
   */
  get trackedSymbolsCount() {
    return this.tickerMap.size;
  }

  stop() {
    this.isRunning = false;
    if (this.miniTickerWs) {
      try { this.miniTickerWs.close(); } catch (e) {}
    }
    if (this.markPriceWs) {
      try { this.markPriceWs.close(); } catch (e) {}
    }
    if (this.weightResetInterval) {
      clearInterval(this.weightResetInterval);
    }
  }
}

const marketDataEngine = new MarketDataEngine();
module.exports = marketDataEngine;
