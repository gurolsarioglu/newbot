/**
 * symbol-registry.service.js — Binance USD-M Futures Borsa Kontrat Kayıt Defteri
 * 
 * Binance GET /fapi/v1/exchangeInfo üzerinden 745+ vadeli paritenin resmi
 * PRICE_FILTER (tickSize, decimals, minMove) ve LOT_SIZE (stepSize) kontrat
 * tanımlarını yönetir. Hiçbir basamak tahminine veya yuvarlamaya yer bırakmaz.
 */

const https = require('https');

class SymbolRegistryService {
  constructor() {
    this.symbols = new Map();
    this.lastUpdated = 0;
    this.refreshTimer = null;
    this.isInitialized = false;

    // Temel fallback tablosu (Ağ hatası veya ilk boot anı için koruma)
    this._initDefaultFallbacks();
  }

  _initDefaultFallbacks() {
    const defaults = [
      { s: 'BTCUSDT', tick: '0.10', dec: 1, move: 0.1, step: '0.001' },
      { s: 'ETHUSDT', tick: '0.01', dec: 2, move: 0.01, step: '0.001' },
      { s: 'SOLUSDT', tick: '0.0100', dec: 2, move: 0.01, step: '0.01' },
      { s: 'BNBUSDT', tick: '0.01', dec: 2, move: 0.01, step: '0.01' },
      { s: 'XRPUSDT', tick: '0.0001', dec: 4, move: 0.0001, step: '0.1' },
      { s: 'DOGEUSDT', tick: '0.000010', dec: 5, move: 0.00001, step: '1' },
      { s: 'IMXUSDT', tick: '0.0001', dec: 4, move: 0.0001, step: '0.1' },
      { s: '1000PEPEUSDT', tick: '0.0000001', dec: 7, move: 0.0000001, step: '1' },
      { s: '1000SHIBUSDT', tick: '0.000001', dec: 6, move: 0.000001, step: '1' },
      { s: 'SUIUSDT', tick: '0.0001', dec: 4, move: 0.0001, step: '0.1' },
      { s: 'NEARUSDT', tick: '0.001', dec: 3, move: 0.001, step: '0.1' },
      { s: 'WIFUSDT', tick: '0.0001', dec: 4, move: 0.0001, step: '0.1' },
      { s: 'BONKUSDT', tick: '0.000001', dec: 6, move: 0.000001, step: '1' },
      { s: 'SYNUSDT', tick: '0.00010', dec: 4, move: 0.0001, step: '0.1' }
    ];

    defaults.forEach(d => {
      this.symbols.set(d.s, {
        symbol: d.s,
        tickSize: d.tick,
        decimals: d.dec,
        minMove: d.move,
        stepSize: d.step,
        qtyDecimals: this._parseDecimals(d.step),
        isFallback: true
      });
    });
  }

  _parseDecimals(tickOrStepStr) {
    if (!tickOrStepStr) return 2;
    const str = String(tickOrStepStr).trim();
    if (!str.includes('.')) return 0;
    const fraction = str.split('.')[1].replace(/0+$/, '');
    return fraction.length > 0 ? fraction.length : 0;
  }

  async fetchExchangeInfo() {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'AlphaTerminal/QuantEngine-2.0',
          'Accept': 'application/json'
        },
        timeout: 10000
      };

      https.get('https://fapi.binance.com/fapi/v1/exchangeInfo', options, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Binance exchangeInfo HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }).on('error', reject).on('timeout', () => {
        reject(new Error('Binance exchangeInfo timeout'));
      });
    });
  }

  async init() {
    try {
      console.log('[SymbolRegistry] Binance /fapi/v1/exchangeInfo verisi cekiliyor...');
      const info = await this.fetchExchangeInfo();
      this._processExchangeInfo(info);
      this.isInitialized = true;
      console.log(`[SymbolRegistry] ${this.symbols.size} vadeli sembol resmi kontrat tanimiyla yuklendi.`);
    } catch (err) {
      console.warn('[SymbolRegistry] Ilk yukleme hatasi (fallbackler aktif):', err.message);
    }

    // Her 6 saatte bir guncelle
    if (!this.refreshTimer) {
      this.refreshTimer = setInterval(() => {
        this.refresh().catch(e => console.error('[SymbolRegistry Refresh Error]:', e.message));
      }, 6 * 3600 * 1000);
      if (this.refreshTimer.unref) this.refreshTimer.unref();
    }
  }

  async refresh() {
    try {
      const info = await this.fetchExchangeInfo();
      this._processExchangeInfo(info);
      console.log(`[SymbolRegistry] 6 saatlik periyodik yenileme tamamlandi. Toplam: ${this.symbols.size}`);
    } catch (err) {
      console.error('[SymbolRegistry] Yenileme basarisiz:', err.message);
    }
  }

  _processExchangeInfo(info) {
    if (!info || !Array.isArray(info.symbols)) return;

    info.symbols.forEach(s => {
      if (s.contractType !== 'PERPETUAL' || s.status !== 'TRADING' || s.quoteAsset !== 'USDT') {
        return;
      }

      const priceFilter = (s.filters || []).find(f => f.filterType === 'PRICE_FILTER');
      const lotSizeFilter = (s.filters || []).find(f => f.filterType === 'LOT_SIZE');

      const rawTickSize = priceFilter ? priceFilter.tickSize : '0.01';
      const rawStepSize = lotSizeFilter ? lotSizeFilter.stepSize : '0.001';

      const decimals = this._parseDecimals(rawTickSize);
      const minMove = Number(Math.pow(10, -decimals).toFixed(decimals));
      const qtyDecimals = this._parseDecimals(rawStepSize);

      this.symbols.set(s.symbol, {
        symbol: s.symbol,
        baseAsset: s.baseAsset,
        quoteAsset: s.quoteAsset,
        tickSize: rawTickSize,
        decimals,
        minMove,
        stepSize: rawStepSize,
        qtyDecimals,
        isFallback: false
      });
    });

    this.lastUpdated = Date.now();
  }

  getSymbol(sym) {
    if (!sym) return null;
    const clean = String(sym).toUpperCase().trim();
    return this.symbols.get(clean) || null;
  }

  getPrecision(sym) {
    const meta = this.getSymbol(sym);
    if (meta) return meta.decimals;
    return 2;
  }

  getMinMove(sym) {
    const meta = this.getSymbol(sym);
    if (meta) return meta.minMove;
    return 0.01;
  }

  getStepSize(sym) {
    const meta = this.getSymbol(sym);
    if (meta) return meta.stepSize;
    return '0.001';
  }

  formatPrice(rawPrice, sym) {
    if (rawPrice === null || rawPrice === undefined || rawPrice === '') return '0.00';
    const num = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
    if (isNaN(num)) return '0.00';

    const decimals = this.getPrecision(sym);
    return num.toFixed(decimals);
  }

  getAllSymbols() {
    return Array.from(this.symbols.keys());
  }

  getAllRegistryData() {
    const result = {};
    for (const [sym, meta] of this.symbols.entries()) {
      result[sym] = {
        decimals: meta.decimals,
        minMove: meta.minMove,
        tickSize: meta.tickSize,
        stepSize: meta.stepSize
      };
    }
    return result;
  }
}

const symbolRegistryService = new SymbolRegistryService();
module.exports = symbolRegistryService;
