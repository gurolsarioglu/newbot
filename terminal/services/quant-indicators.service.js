/**
 * quant-indicators.service.js — Alpha Terminal Quant İndikatör Hesaplama Motoru
 * 
 * TradingView PineScript v5 standartlarında; 250 mumluk ısınma (warm-up) ile
 * Wilder's RSI(14), RSI-SMA(14), StochRSI(14,14,3,3), WaveTrend(10,21) LazyBear,
 * EMA(20,50,200), Pivot Seviyeleri, Hacim Sıçraması ve Pivot Lookback Divergence hesaplar.
 */

class QuantIndicatorsService {
  /**
   * Wilder's RSI(14) ve RSI-SMA(14) hesaplar
   * @param {Array<number>} closes Kapanış fiyatları dizisi (en az 15 eleman, ideal 250)
   * @param {number} period RSI periyodu (varsayılan: 14)
   */
  calculateRSI(closes, period = 14) {
    if (!Array.isArray(closes) || closes.length <= period) {
      return { rsi: 50, rsiSma: 50, rsiSeries: [], rsiSmaSeries: [] };
    }

    const gains = [];
    const losses = [];
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      gains.push(diff > 0 ? diff : 0);
      losses.push(diff < 0 ? Math.abs(diff) : 0);
    }

    // İlk 'period' mum için basit ortalama
    let avgGain = 0;
    let avgLoss = 0;
    for (let i = 0; i < period; i++) {
      avgGain += gains[i];
      avgLoss += losses[i];
    }
    avgGain /= period;
    avgLoss /= period;

    const rsiSeries = [];
    const rsFirst = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsiFirst = avgLoss === 0 ? 100 : (100 - (100 / (1 + rsFirst)));
    rsiSeries.push(parseFloat(rsiFirst.toFixed(2)));

    // Wilder RMA düzleştirmesi
    for (let i = period; i < gains.length; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;

      if (avgLoss === 0) {
        rsiSeries.push(100);
      } else {
        const rs = avgGain / avgLoss;
        const rsi = 100 - (100 / (1 + rs));
        rsiSeries.push(parseFloat(rsi.toFixed(2)));
      }
    }

    // RSI serisi üzerinden 14 periyotluk SMA
    const rsiSmaSeries = [];
    for (let i = 0; i < rsiSeries.length; i++) {
      if (i < period - 1) {
        rsiSmaSeries.push(rsiSeries[i]);
      } else {
        let sum = 0;
        for (let j = 0; j < period; j++) {
          sum += rsiSeries[i - j];
        }
        rsiSmaSeries.push(parseFloat((sum / period).toFixed(2)));
      }
    }

    const latestRsi = rsiSeries[rsiSeries.length - 1] ?? 50;
    const latestRsiSma = rsiSmaSeries[rsiSmaSeries.length - 1] ?? 50;

    return {
      rsi: latestRsi,
      rsiSma: latestRsiSma,
      rsiSeries,
      rsiSmaSeries
    };
  }

  /**
   * Stochastic RSI (14, 14, 3, 3)
   * @param {Array<number>} rsiSeries Daha önce hesaplanmış RSI serisi
   * @param {number} stochPeriod 14
   * @param {number} smoothK 3
   * @param {number} smoothD 3
   */
  calculateStochRSI(rsiSeries, stochPeriod = 14, smoothK = 3, smoothD = 3) {
    if (!Array.isArray(rsiSeries) || rsiSeries.length < stochPeriod) {
      return { k: 50, d: 50, kSeries: [], dSeries: [] };
    }

    const stochRsiRaw = [];
    for (let i = stochPeriod - 1; i < rsiSeries.length; i++) {
      let minRsi = Infinity;
      let maxRsi = -Infinity;
      for (let j = 0; j < stochPeriod; j++) {
        const val = rsiSeries[i - j];
        if (val < minRsi) minRsi = val;
        if (val > maxRsi) maxRsi = val;
      }

      const range = maxRsi - minRsi;
      const raw = range === 0 ? 50 : ((rsiSeries[i] - minRsi) / range) * 100;
      stochRsiRaw.push(Math.max(0, Math.min(100, raw)));
    }

    // %K = SMA(StochRSI, smoothK)
    const kSeries = [];
    for (let i = 0; i < stochRsiRaw.length; i++) {
      if (i < smoothK - 1) {
        kSeries.push(stochRsiRaw[i]);
      } else {
        let sum = 0;
        for (let j = 0; j < smoothK; j++) {
          sum += stochRsiRaw[i - j];
        }
        kSeries.push(parseFloat((sum / smoothK).toFixed(2)));
      }
    }

    // %D = SMA(%K, smoothD)
    const dSeries = [];
    for (let i = 0; i < kSeries.length; i++) {
      if (i < smoothD - 1) {
        dSeries.push(kSeries[i]);
      } else {
        let sum = 0;
        for (let j = 0; j < smoothD; j++) {
          sum += kSeries[i - j];
        }
        dSeries.push(parseFloat((sum / smoothD).toFixed(2)));
      }
    }

    const latestK = kSeries[kSeries.length - 1] ?? 50;
    const latestD = dSeries[dSeries.length - 1] ?? 50;

    return {
      k: latestK,
      d: latestD,
      kSeries,
      dSeries
    };
  }

  /**
   * WaveTrend Osilatörü — WT (10, 21) [LazyBear Standardı]
   * @param {Array<{high: number, low: number, close: number}>} candles 
   * @param {number} n1 Channel Length (10)
   * @param {number} n2 Average Length (21)
   */
  calculateWaveTrend(candles, n1 = 10, n2 = 21) {
    if (!Array.isArray(candles) || candles.length < n1 + n2) {
      return { wt1: 0, wt2: 0, prevWt1: 0, prevWt2: 0, crossUp: false, crossDown: false, isOversold: false, isOverbought: false };
    }

    const apSeries = candles.map(c => (c.high + c.low + c.close) / 3);

    // esa = EMA(ap, n1)
    const alpha1 = 2 / (n1 + 1);
    const esaSeries = [];
    let prevEsa = apSeries[0];
    esaSeries.push(prevEsa);
    for (let i = 1; i < apSeries.length; i++) {
      const curEsa = alpha1 * apSeries[i] + (1 - alpha1) * prevEsa;
      esaSeries.push(curEsa);
      prevEsa = curEsa;
    }

    // d = EMA(abs(ap - esa), n1)
    const dSeries = [];
    let prevD = Math.abs(apSeries[0] - esaSeries[0]);
    dSeries.push(prevD);
    for (let i = 1; i < apSeries.length; i++) {
      const diff = Math.abs(apSeries[i] - esaSeries[i]);
      const curD = alpha1 * diff + (1 - alpha1) * prevD;
      dSeries.push(curD);
      prevD = curD;
    }

    // ci = (ap - esa) / (0.015 * d)
    const ciSeries = [];
    for (let i = 0; i < apSeries.length; i++) {
      const denom = 0.015 * dSeries[i];
      const ci = denom === 0 ? 0 : (apSeries[i] - esaSeries[i]) / denom;
      ciSeries.push(ci);
    }

    // wt1 = EMA(ci, n2)
    const alpha2 = 2 / (n2 + 1);
    const wt1Series = [];
    let prevWt1 = ciSeries[0];
    wt1Series.push(prevWt1);
    for (let i = 1; i < ciSeries.length; i++) {
      const curWt1 = alpha2 * ciSeries[i] + (1 - alpha2) * prevWt1;
      wt1Series.push(curWt1);
      prevWt1 = curWt1;
    }

    // wt2 = SMA(wt1, 4)
    const wt2Series = [];
    for (let i = 0; i < wt1Series.length; i++) {
      if (i < 3) {
        wt2Series.push(wt1Series[i]);
      } else {
        const sum = wt1Series[i] + wt1Series[i - 1] + wt1Series[i - 2] + wt1Series[i - 3];
        wt2Series.push(sum / 4);
      }
    }

    const len = wt1Series.length;
    const wt1 = parseFloat(wt1Series[len - 1].toFixed(2));
    const wt2 = parseFloat(wt2Series[len - 1].toFixed(2));
    const pWt1 = len > 1 ? parseFloat(wt1Series[len - 2].toFixed(2)) : wt1;
    const pWt2 = len > 1 ? parseFloat(wt2Series[len - 2].toFixed(2)) : wt2;

    const crossUp = pWt1 <= pWt2 && wt1 > wt2;
    const crossDown = pWt1 >= pWt2 && wt1 < wt2;

    return {
      wt1,
      wt2,
      prevWt1: pWt1,
      prevWt2: pWt2,
      crossUp,
      crossDown,
      isOversold: wt1 <= -60,
      isOverbought: wt1 >= 60,
      wt1Series,
      wt2Series
    };
  }

  /**
   * EMA serisi ve son değerini hesaplar
   */
  calculateEMA(series, period) {
    if (!Array.isArray(series) || series.length === 0) return 0;
    if (series.length < period) {
      const sum = series.reduce((a, b) => a + b, 0);
      return parseFloat((sum / series.length).toFixed(4));
    }

    const alpha = 2 / (period + 1);
    let ema = series[0];
    for (let i = 1; i < series.length; i++) {
      ema = alpha * series[i] + (1 - alpha) * ema;
    }
    return parseFloat(ema.toFixed(4));
  }

  /**
   * Klasik / Seanslık Pivot Seviyeleri
   * @param {{high: number, low: number, close: number}} prevBar Bir önceki tamamlanmış periyot/gün barı
   * @param {number} currentPrice Anlık fiyat
   */
  calculatePivots(prevBar, currentPrice) {
    if (!prevBar || !prevBar.high || !prevBar.low || !prevBar.close) {
      return { p: currentPrice, s1: currentPrice, s2: currentPrice, r1: currentPrice, r2: currentPrice, pivotDistancePct: 0 };
    }

    const H = prevBar.high;
    const L = prevBar.low;
    const C = prevBar.close;

    const P = (H + L + C) / 3;
    const S1 = 2 * P - H;
    const S2 = P - (H - L);
    const R1 = 2 * P - L;
    const R2 = P + (H - L);

    const pivotDistancePct = P > 0 ? parseFloat((Math.abs(currentPrice - P) / P * 100).toFixed(2)) : 0;

    return {
      p: parseFloat(P.toFixed(4)),
      s1: parseFloat(S1.toFixed(4)),
      s2: parseFloat(S2.toFixed(4)),
      r1: parseFloat(R1.toFixed(4)),
      r2: parseFloat(R2.toFixed(4)),
      pivotDistancePct
    };
  }

  /**
   * Hacim Sıçraması (Delta Vol %)
   * @param {Array<number>} volumes Mum hacimleri (son eleman anlık/kapanan mum)
   * @param {number} period 20
   */
  calculateDeltaVolume(volumes, period = 20) {
    if (!Array.isArray(volumes) || volumes.length < 2) return 0;

    const currentVol = volumes[volumes.length - 1];
    // Önceki kapanmış 20 mumun ortalaması
    const closedVols = volumes.slice(Math.max(0, volumes.length - 1 - period), volumes.length - 1);
    if (closedVols.length === 0) return 0;

    const avgVol = closedVols.reduce((a, b) => a + b, 0) / closedVols.length;
    if (avgVol === 0) return 0;

    const deltaVolPct = ((currentVol - avgVol) / avgVol) * 100;
    return parseFloat(deltaVolPct.toFixed(2));
  }

  /**
   * Pivot Lookback Bullish / Bearish RSI(14) Divergence Tespiti
   * Son 30 kapanmış mum içinde yerel fiyat dipleri/tepeleri ile RSI dipleri/tepelerini kıyaslar.
   * 
   * Boğa (🟢): Price_Low2 < Price_Low1 ve RSI_Low2 > RSI_Low1 ve RSI_Low1 <= 35
   * Ayı (🔴): Price_High2 > Price_High1 ve RSI_High2 < RSI_High1 ve RSI_High1 >= 65
   */
  detectPivotDivergence(candles, rsiSeries) {
    if (!Array.isArray(candles) || !Array.isArray(rsiSeries) || candles.length < 15 || rsiSeries.length < 15) {
      return { hasBullDiv: false, hasBearDiv: false, type: null, detail: '' };
    }

    const lookback = Math.min(30, candles.length - 2);
    const startIdx = candles.length - lookback;

    // 1. Pivot Low Tespiti (sağında ve solunda 2 bar daha yüksek low)
    const pivotLows = [];
    for (let i = startIdx; i <= candles.length - 3; i++) {
      const c = candles[i].low;
      if (
        c < candles[i - 1].low &&
        c < candles[i - 2].low &&
        c <= candles[i + 1].low &&
        c <= candles[i + 2].low
      ) {
        // İlgili barın RSI değerini bul
        const rsiIdx = rsiSeries.length - (candles.length - i);
        if (rsiIdx >= 0 && rsiIdx < rsiSeries.length) {
          pivotLows.push({ index: i, price: c, rsi: rsiSeries[rsiIdx] });
        }
      }
    }

    // 2. Pivot High Tespiti (sağında ve solunda 2 bar daha düşük high)
    const pivotHighs = [];
    for (let i = startIdx; i <= candles.length - 3; i++) {
      const c = candles[i].high;
      if (
        c > candles[i - 1].high &&
        c > candles[i - 2].high &&
        c >= candles[i + 1].high &&
        c >= candles[i + 2].high
      ) {
        const rsiIdx = rsiSeries.length - (candles.length - i);
        if (rsiIdx >= 0 && rsiIdx < rsiSeries.length) {
          pivotHighs.push({ index: i, price: c, rsi: rsiSeries[rsiIdx] });
        }
      }
    }

    // Boğa Uyumsuzluğu Kontrolü
    let hasBullDiv = false;
    let bullDetail = '';
    if (pivotLows.length >= 2) {
      const p1 = pivotLows[pivotLows.length - 2];
      const p2 = pivotLows[pivotLows.length - 1]; // Daha güncel dip
      if (p2.price < p1.price && p2.rsi > p1.rsi && p1.rsi <= 35) {
        hasBullDiv = true;
        bullDetail = `Price: ${p1.price.toFixed(4)} -> ${p2.price.toFixed(4)} (Daha Düşük Dip), RSI: ${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)} (Daha Yüksek Dip)`;
      }
    }

    // Ayı Uyumsuzluğu Kontrolü
    let hasBearDiv = false;
    let bearDetail = '';
    if (pivotHighs.length >= 2) {
      const p1 = pivotHighs[pivotHighs.length - 2];
      const p2 = pivotHighs[pivotHighs.length - 1]; // Daha güncel tepe
      if (p2.price > p1.price && p2.rsi < p1.rsi && p1.rsi >= 65) {
        hasBearDiv = true;
        bearDetail = `Price: ${p1.price.toFixed(4)} -> ${p2.price.toFixed(4)} (Daha Yüksek Tepe), RSI: ${p1.rsi.toFixed(1)} -> ${p2.rsi.toFixed(1)} (Daha Düşük Tepe)`;
      }
    }

    const type = hasBullDiv ? 'bull' : (hasBearDiv ? 'bear' : null);
    const detail = hasBullDiv ? bullDetail : bearDetail;

    return {
      hasBullDiv,
      hasBearDiv,
      type,
      detail
    };
  }

  /**
   * 250 Mumluk Kayan Pencereden tüm temel metrikleri tek seferde çıkarır
   */
  calculateAllMetrics(candles) {
    if (!Array.isArray(candles) || candles.length < 15) {
      return null;
    }

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const latestCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2] || latestCandle;

    const rsiData = this.calculateRSI(closes, 14);
    const stochData = this.calculateStochRSI(rsiData.rsiSeries, 14, 3, 3);
    const wtData = this.calculateWaveTrend(candles, 10, 21);
    const ema20 = this.calculateEMA(closes, 20);
    const ema50 = this.calculateEMA(closes, 50);
    const ema200 = this.calculateEMA(closes, 200);
    const pivots = this.calculatePivots(prevCandle, latestCandle.close);
    const deltaVolPct = this.calculateDeltaVolume(volumes, 20);
    const divergence = this.detectPivotDivergence(candles, rsiData.rsiSeries);

    return {
      rsi: rsiData.rsi,
      rsiSma: rsiData.rsiSma,
      srsiK: stochData.k,
      srsiD: stochData.d,
      wt1: wtData.wt1,
      wt2: wtData.wt2,
      wtCrossUp: wtData.crossUp,
      wtCrossDown: wtData.crossDown,
      wtOversold: wtData.isOversold,
      wtOverbought: wtData.isOverbought,
      ema20,
      ema50,
      ema200,
      pivots,
      deltaVolPct,
      divergence
    };
  }
}

const quantIndicatorsService = new QuantIndicatorsService();
module.exports = quantIndicatorsService;
