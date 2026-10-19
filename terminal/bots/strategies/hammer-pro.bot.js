/**
 * hammer-pro.bot.js — Hammer Pro (Automated Pattern Analysis & Reversal Scanner)
 * Strateji: #W1 Dip Dönüş / WaveTrend Reversal
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class HammerProBot extends BaseBot {
  constructor() {
    super({
      id: 'hammerpro',
      name: 'Hammer Pro',
      description: 'Automated pattern analysis & reversal scanner'
    });
  }

  /**
   * Boost değerini her türlü string/sayı formatından güvenle float'a çevirir
   */
  parseBoost(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%+,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Yüzdesel mesafe string veya sayısını temiz mutlak float olarak döner
   */
  parseDistance(val) {
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'number') return Math.abs(val);
    const clean = String(val).replace(/[%+⚠️\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : Math.abs(parsed);
  }

  /**
   * #W1 Dip Dönüş ve Whipsaw / Düşen Bıçak Kalite Filtresi (Trader Mantığı)
   * 1. 1m WaveTrend veya dip tepkisi olmalıdır.
   * 2. 5m veya 1h periyotlarından en az biri aşırı satımda (<= 38) olmalıdır.
   * 3. Boost ivmesi en az +0.40% olmalı, ancak aşırı geç kalınmış (> +4.50%) olmamalıdır.
   */
  validateReversalQuality({ rsi1m, rsi5m, rsi1h, boostNum, hasWT }) {
    if (!Number.isFinite(rsi1m) || !Number.isFinite(boostNum)) return { valid: false, reason: '1m dönüş verisi eksik.' };
    // Boost eşik kontrolü: Çekiç tepkisi başladı mı? (En az %0.40, en çok %4.50 FOMO tavanı)
    if (boostNum < 0.40 || boostNum > 4.50) {
      return { valid: false, reason: `Boost (${boostNum.toFixed(2)}%) ideal çekiç aralığında (%0.40 - %4.50) değil.` };
    }

    // Yüksek zaman dilimi aşırı satım teyidi: En az 5m veya 1h periyodunda aşırı satım olmalı
    if (!(Number.isFinite(rsi5m) && rsi5m <= 40) && !(Number.isFinite(rsi1h) && rsi1h <= 42)) {
      return { valid: false, reason: `5m (RSI:${rsi5m}) ve 1h (RSI:${rsi1h}) aşırı satım bölgesinde değil. Sahte tepki riski.` };
    }

    // WaveTrend veya 1m dip onayı
    if (!hasWT && rsi1m > 35) {
      return { valid: false, reason: `1m WaveTrend boğa kesişimi veya 1m aşırı satım teyidi yok.` };
    }

    return { valid: true };
  }

  ingest(s) {
    if (!s || !(s.coin || s.symbol)) return null;
    const symbol = String(s.coin || s.symbol).trim().toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = Number(s.price);
    const boostNum = this.parseMetric(s.boost ?? s.boostValue);
    if (!Number.isFinite(priceNum) || priceNum <= 0 || boostNum === null) return null;
    const boostFormatted = `+${boostNum.toFixed(2)}%`;

    // prevPrice güvenliği: Eğer prevPrice yoksa veya price ile aynıysa, boost üzerinden geriye doğru hesapla
    let prevPriceStr = Number(s.prevPrice) > 0 ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && boostNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, boostNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    // RSI Değerleri (Sayısal parse ve Trader Alarm ! Formatı)
    const rsi1mNum = this.parseMetric(s.rsi1m ?? s.rsi, 0, 100);
    const rsi5mNum = this.parseMetric(s.rsi5m, 0, 100);
    const rsi1hNum = this.parseMetric(s.rsi1h, 0, 100);

    // SRSI Değerleri
    const srsi1mNum = this.parseMetric(s.srsi1m ?? s.stochK, 0, 100);
    const srsi5mNum = this.parseMetric(s.srsi5m, 0, 100);
    const srsi1hNum = this.parseMetric(s.srsi1h, 0, 100);

    // WaveTrend Teyidi
    const hasWT = s.wtCrossUp === true || (typeof s.wt === 'string' && /🟢|cross.*up|up.*cross/i.test(s.wt));
    const wtDisplay = s.wt || (hasWT ? '1m 🟢' : '—');

    // Trader & Mantık Doğrulama Filtresi (Dışarıdan gelen onaylı sinyaller hariç)
    {
      const validation = this.validateReversalQuality({
        rsi1m: rsi1mNum,
        rsi5m: rsi5mNum,
        rsi1h: rsi1hNum,
        boostNum,
        hasWT
      });

      if (!validation.valid) {
        console.warn(`[HammerPro] ⚠️ #${symbol} sinyali elendi: ${validation.reason}`);
        return null;
      }
    }

    // Pivot Mesafesi Kontrolü
    let pivotDisplay = null;
    if (s.pivot !== undefined && s.pivot !== null) {
      const pDist = this.parseDistance(s.pivot);
      pivotDisplay = typeof s.pivot === 'string' && s.pivot.includes('%') 
        ? s.pivot 
        : (pDist !== null ? `%${pDist.toFixed(2)} ⚠️` : null);
    }

    // 4H EMA200 Mesafesi Kontrolü
    let ema200Display = null;
    if (s.ema200 !== undefined && s.ema200 !== null) {
      const eDist = this.parseDistance(s.ema200);
      ema200Display = typeof s.ema200 === 'string' && s.ema200.includes('%') 
        ? s.ema200 
        : (eDist !== null ? `%${eDist.toFixed(2)} ⚠️` : null);
    }

    const card = {
      symbol: symbol,
      strategy: s.strategy || '#W1',
      boostValue: boostFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      rsi: {
        m1: this.formatMetric(rsi1mNum, rsi1mNum <= 30),
        m5: this.formatMetric(rsi5mNum, rsi5mNum <= 30),
        h1: this.formatMetric(rsi1hNum, rsi1hNum <= 30)
      },
      srsi: {
        m1: this.formatMetric(srsi1mNum),
        m5: this.formatMetric(srsi5mNum, srsi5mNum <= 15),
        h1: this.formatMetric(srsi1hNum, srsi1hNum <= 15)
      },
      wt: wtDisplay,
      dateLabel: 'Today',
      time: nowTime
    };

    if (pivotDisplay) card.pivot = pivotDisplay;
    if (ema200Display) card.ema200 = ema200Display;

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new HammerProBot();
