const https = require('https');
const crypto = require('crypto');

/**
 * Binance Futures Read-Only Client
 * Güvenlik: Yalnızca okuma yetkili (Read-Only) anahtarlar için tasarlanmıştır.
 */
class BinanceClient {
  constructor(apiKey = '', apiSecret = '') {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.baseUrl = 'https://fapi.binance.com';
  }

  // Genel HTTP GET İsteği
  request(endpoint, queryParams = {}, isSigned = false) {
    return new Promise((resolve, reject) => {
      let queryString = Object.keys(queryParams)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
        .join('&');

      if (isSigned) {
        const timestamp = Date.now();
        queryString += (queryString ? '&' : '') + `timestamp=${timestamp}`;
        const signature = crypto
          .createHmac('sha256', this.apiSecret)
          .update(queryString)
          .digest('hex');
        queryString += `&signature=${signature}`;
      }

      const url = `${this.baseUrl}${endpoint}${queryString ? '?' + queryString : ''}`;
      const headers = {
        'User-Agent': 'AICoPilot/1.0',
        'Accept': 'application/json'
      };

      if (this.apiKey) {
        headers['X-MBX-APIKEY'] = this.apiKey;
      }

      https.get(url, { headers }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 400) {
              return reject(new Error(parsed.msg || `HTTP ${res.statusCode}`));
            }
            resolve(parsed);
          } catch (e) {
            reject(new Error(`JSON Parse Error: ${e.message}`));
          }
        });
      }).on('error', reject);
    });
  }

  // 1. Kullanıcının Açık Pozisyonlarını Çek (Read-Only API)
  async getActivePositions() {
    if (!this.apiKey || !this.apiSecret) {
      return [];
    }
    try {
      const positions = await this.request('/fapi/v2/positionRisk', {}, true);
      if (!Array.isArray(positions)) return [];
      
      // Sadece pozisyon büyüklüğü 0 olmayanları filtrele
      return positions
        .filter(p => Math.abs(parseFloat(p.positionAmt || 0)) > 0)
        .map(p => ({
          symbol: p.symbol,
          positionAmt: parseFloat(p.positionAmt),
          entryPrice: parseFloat(p.entryPrice),
          markPrice: parseFloat(p.markPrice),
          unRealizedProfit: parseFloat(p.unRealizedProfit),
          liquidationPrice: parseFloat(p.liquidationPrice),
          leverage: parseInt(p.leverage, 10),
          marginType: p.marginType,
          isLong: parseFloat(p.positionAmt) > 0,
          pnlPercent: p.entryPrice > 0 ? (((parseFloat(p.markPrice) - parseFloat(p.entryPrice)) / parseFloat(p.entryPrice)) * 100 * (parseFloat(p.positionAmt) > 0 ? 1 : -1) * parseInt(p.leverage, 10)).toFixed(2) : 0
        }));
    } catch (err) {
      console.warn('[BinanceClient] getActivePositions hatası (API anahtarı girilmemiş veya geçersiz olabilir):', err.message);
      return [];
    }
  }

  // 2. Çoklu Zaman Dilimi Mum Verileri (5m, 15m, 1h, 4h)
  async getMultiTimeframeKlines(symbol) {
    const timeframes = ['5m', '15m', '1h', '4h'];
    const results = {};

    await Promise.all(timeframes.map(async (tf) => {
      try {
        const klines = await this.request('/fapi/v1/klines', {
          symbol,
          interval: tf,
          limit: 30
        });

        const formatted = klines.map(k => ({
          openTime: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          closeTime: k[6]
        }));

        const closes = formatted.map(k => k.close);
        const lastBar = formatted[formatted.length - 1];

        results[tf] = {
          timeframe: tf,
          lastClose: lastBar.close,
          lastHigh: lastBar.high,
          lastLow: lastBar.low,
          volume: lastBar.volume,
          ema9: this.calculateEMA(closes, 9),
          ema21: this.calculateEMA(closes, 21),
          rsi14: this.calculateRSI(closes, 14),
          bars: formatted.slice(-5) // son 5 mum
        };
      } catch (err) {
        console.error(`[BinanceClient] ${tf} kline hatası:`, err.message);
        results[tf] = null;
      }
    }));

    return results;
  }

  // 3. Emir Defteri Derinliği (Alış/Satış Duvarları)
  async getOrderBookDepth(symbol, limit = 50) {
    try {
      const depth = await this.request('/fapi/v1/depth', { symbol, limit });
      const bids = (depth.bids || []).map(b => ({ price: parseFloat(b[0]), qty: parseFloat(b[1]) }));
      const asks = (depth.asks || []).map(a => ({ price: parseFloat(a[0]), qty: parseFloat(a[1]) }));

      // En büyük 3 alım ve satım duvarını bul
      const topBids = [...bids].sort((a, b) => (b.price * b.qty) - (a.price * a.qty)).slice(0, 3);
      const topAsks = [...asks].sort((a, b) => (b.price * b.qty) - (a.price * a.qty)).slice(0, 3);

      const totalBidVolume = bids.reduce((acc, b) => acc + (b.price * b.qty), 0);
      const totalAskVolume = asks.reduce((acc, a) => acc + (a.price * a.qty), 0);
      const buyPressureRatio = totalBidVolume + totalAskVolume > 0 
        ? ((totalBidVolume / (totalBidVolume + totalAskVolume)) * 100).toFixed(1)
        : 50;

      return {
        bestBid: bids[0]?.price || 0,
        bestAsk: asks[0]?.price || 0,
        topBids,
        topAsks,
        buyPressureRatio, // % kaç alıcı ağırlıklı
        totalBidVolume: Math.round(totalBidVolume),
        totalAskVolume: Math.round(totalAskVolume)
      };
    } catch (err) {
      console.error('[BinanceClient] OrderBook Depth hatası:', err.message);
      return null;
    }
  }

  // 4. Funding Rate & Open Interest
  async getDerivativesMetrics(symbol) {
    try {
      const [premium, oi, oiHist5m, oiHist4h, topTraders, takerRatio] = await Promise.all([
        this.request('/fapi/v1/premiumIndex', { symbol }),
        this.request('/fapi/v1/openInterest', { symbol }),
        this.request('/futures/data/openInterestHist', { symbol, period: '5m', limit: 12 }).catch(() => []),
        this.request('/futures/data/openInterestHist', { symbol, period: '4h', limit: 12 }).catch(() => []),
        this.request('/futures/data/topLongShortPositionRatio', { symbol, period: '5m', limit: 5 }).catch(() => []),
        this.request('/futures/data/takerlongshortRatio', { symbol, period: '5m', limit: 5 }).catch(() => [])
      ]);

      // 5m Para Girişi / Çıkışı (OI Delta)
      let oiDelta5m = 0;
      let oiDelta5mPercent = 0;
      if (Array.isArray(oiHist5m) && oiHist5m.length >= 2) {
        const currentOI = parseFloat(oiHist5m[oiHist5m.length - 1].sumOpenInterestValue);
        const prevOI = parseFloat(oiHist5m[oiHist5m.length - 2].sumOpenInterestValue);
        oiDelta5m = currentOI - prevOI;
        oiDelta5mPercent = prevOI > 0 ? ((oiDelta5m / prevOI) * 100).toFixed(2) : 0;
      }

      // 4H Büyük Resim Para Girişi / Çıkışı (4H OI Delta)
      let oiDelta4h = 0;
      let oiDelta4hPercent = 0;
      if (Array.isArray(oiHist4h) && oiHist4h.length >= 2) {
        const currentOI4h = parseFloat(oiHist4h[oiHist4h.length - 1].sumOpenInterestValue);
        const prevOI4h = parseFloat(oiHist4h[0].sumOpenInterestValue); // Son 12 barın başı
        oiDelta4h = currentOI4h - prevOI4h;
        oiDelta4hPercent = prevOI4h > 0 ? ((oiDelta4h / prevOI4h) * 100).toFixed(2) : 0;
      }

      // Top Trader Pozisyon Rasyosu
      const lastTopTrader = Array.isArray(topTraders) && topTraders.length > 0 
        ? topTraders[topTraders.length - 1] 
        : null;

      // Taker Buy / Sell Oranı (Piyasa Emriyle Alanlar vs Satanlar)
      const lastTaker = Array.isArray(takerRatio) && takerRatio.length > 0 
        ? takerRatio[takerRatio.length - 1] 
        : null;

      return {
        fundingRate: parseFloat(premium?.lastFundingRate || 0),
        fundingPercent: (parseFloat(premium?.lastFundingRate || 0) * 100).toFixed(4),
        nextFundingTime: premium?.nextFundingTime,
        openInterest: parseFloat(oi?.openInterest || 0),
        oiDelta5m: Math.round(oiDelta5m),
        oiDelta5mPercent: parseFloat(oiDelta5mPercent),
        oiDelta4h: Math.round(oiDelta4h),
        oiDelta4hPercent: parseFloat(oiDelta4hPercent),
        topTraderLongRatio: lastTopTrader ? parseFloat(lastTopTrader.longAccount || lastTopTrader.longPosition || 0) : null,
        topTraderShortRatio: lastTopTrader ? parseFloat(lastTopTrader.shortAccount || lastTopTrader.shortPosition || 0) : null,
        takerBuySellRatio: lastTaker ? parseFloat(lastTaker.buySellRatio || 1) : 1
      };
    } catch (err) {
      console.error('[BinanceClient] Derivatives metrics hatası:', err.message);
      return null;
    }
  }

  // İndikatör Hesaplamaları: EMA
  calculateEMA(prices, period) {
    if (prices.length < period) return prices[prices.length - 1] || 0;
    const k = 2 / (period + 1);
    let ema = prices.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] * k) + (ema * (1 - k));
    }
    return parseFloat(ema.toFixed(4));
  }

  // İndikatör Hesaplamaları: RSI
  calculateRSI(prices, period = 14) {
    if (prices.length <= period) return 50;
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    for (let i = period + 1; i < prices.length; i++) {
      const diff = prices[i] - prices[i - 1];
      if (diff >= 0) {
        avgGain = (avgGain * (period - 1) + diff) / period;
        avgLoss = (avgLoss * (period - 1)) / period;
      } else {
        avgGain = (avgGain * (period - 1)) / period;
        avgLoss = (avgLoss * (period - 1) - diff) / period;
      }
    }

    if (avgLoss === 0) return 100;
    const rs = avgGain / avgLoss;
    return parseFloat((100 - (100 / (1 + rs))).toFixed(2));
  }
}

module.exports = BinanceClient;
