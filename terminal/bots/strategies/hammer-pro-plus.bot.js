/**
 * hammer-pro-plus.bot.js — Hammer Pro Plus (Advanced Structural Pattern Framework)
 * 
 * Stratejiler:
 * - #W1 (Wyckoff Spring / WaveTrend Reversal): 1m/5m/1h dip aşırı satım + 1m WaveTrend yukarı kesişimi
 * - #S1 (Structure 1 / Support Bounce): Seanslık/Günlük Pivot desteğine milimetrik temas ve sıçrama
 * 
 * Yıldız Puanlama Sistemi (Confluence):
 * - ⭐ (1 Yıldız): Temel aşırı satım dönüşü (1m/5m RSI <= 30)
 * - ⭐⭐ (2 Yıldız): Çoklu zaman dilimi (1m+5m+1h) dip onayı + 1m WT Boğa Kesişimi + Güçlü Boost (> %2.5)
 * - ⭐⭐⭐ (3 Yıldız): Tam Konfluens (RSI dip + WT onayı + Pivot desteğine <= %0.30 milimetrik oturma)
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class HammerProPlusBot extends BaseBot {
  constructor() {
    super({
      id: 'hammerproplus',
      name: 'Hammer Pro Plus',
      description: 'Advanced structural pattern framework'
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
   * Pivot yakınlık yüzdesini temiz float olarak döner
   */
  parsePivotDistance(pivotStr) {
    if (pivotStr === undefined || pivotStr === null || pivotStr === '') return null;
    if (typeof pivotStr === 'number') return Math.abs(pivotStr);
    const clean = String(pivotStr).replace(/[%+⚠️\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : Math.abs(parsed);
  }

  /**
   * ⭐ Yıldız Puanlama Motoru (Confluence Engine)
   */
  calculateStars({ rsi1m, rsi5m, rsi1h, hasWT, pivotDist, boostNum }) {
    const isM1Dip = Number.isFinite(rsi1m) && rsi1m <= 30;
    const isM5Dip = Number.isFinite(rsi5m) && rsi5m <= 32;
    const isH1Dip = Number.isFinite(rsi1h) && rsi1h <= 35;
    const isPivotCritical = pivotDist !== null && pivotDist <= 0.35;
    const isStrongBoost = boostNum >= 2.5;

    // ⭐⭐⭐ 3 Yıldız (Tam Konfluens): Çoklu dip + WaveTrend Boğa Kesişimi + Pivot Desteği (<= %0.35)
    if (isM1Dip && isM5Dip && hasWT && isPivotCritical) {
      return '⭐⭐⭐';
    }

    // ⭐⭐ 2 Yıldız: Çoklu Zaman Dilimi Aşırı Satım + WT Kesişimi + Güçlü Boost
    if ((isM1Dip && (isM5Dip || isH1Dip)) && hasWT && isStrongBoost) {
      return '⭐⭐';
    }

    // ⭐ 1 Yıldız: Temel aşırı satım
    return '⭐';
  }

  /**
   * Strateji Ayrıştırma Motoru (#W1 vs #S1 vs #W1 / #S1)
   */
  determineStrategy({ hasWT, pivotDist, existingStrategy }) {
    if (existingStrategy && (existingStrategy.includes('#W1') || existingStrategy.includes('#S1'))) {
      return existingStrategy;
    }
    const isPivotNear = pivotDist !== null && pivotDist <= 0.35;
    if (hasWT && isPivotNear) return '#W1 / #S1';
    if (isPivotNear) return '#S1';
    return '#W1';
  }

  /**
   * 1 Dakikalık WaveTrend gürültü filtresi (Whipsaw Filter)
   * 5m veya 1h periyotlarında aşırı satım desteği yoksa zayıf/gürültülü sayılır.
   */
  validateReversalQuality({ rsi5m, rsi1h }) {
    // 5m veya 1h periyotlarından en az biri 42 altında olmalıdır.
    // Eğer 5m RSI > 45 ve 1h RSI > 45 ise, düşüş içi sahte tepkidir (Whipsaw).
    return (Number.isFinite(rsi5m) && rsi5m <= 42) || (Number.isFinite(rsi1h) && rsi1h <= 42);
  }

  /**
   * Dışarıdan veya avcı botlardan gelen sinyali Hammer Pro Plus formatına çevirir ve doğrular
   */
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

    // RSI Değerleri (Eksik veri gelirse sahte veri doldurmak yerine tutarlı parse et)
    const rsi1mNum = this.parseMetric(s.rsi1m ?? s.rsi, 0, 100);
    const rsi5mNum = this.parseMetric(s.rsi5m, 0, 100);
    const rsi1hNum = this.parseMetric(s.rsi1h, 0, 100);
    if (rsi1mNum === null) return null;
    const srsi1mNum = this.parseMetric(s.srsi1m ?? s.stochK, 0, 100);
    const srsi5mNum = this.parseMetric(s.srsi5m, 0, 100);
    const srsi1hNum = this.parseMetric(s.srsi1h, 0, 100);

    // 1m WaveTrend Gürültü Kontrolü (Dışarıdan gelen onaylı sinyaller hariç)
    {
      const isQualityReversal = this.validateReversalQuality({ rsi5m: rsi5mNum, rsi1h: rsi1hNum });
      if (!isQualityReversal) {
        console.warn(`[HammerProPlus] ⚠️ #${symbol} sinyali 5m/1h aşırı satım teyidi olmadığı için (Whipsaw riski) elendi.`);
        return null;
      }
    }

    // WaveTrend Teyidi
    const hasWT = s.wtCrossUp === true || (typeof s.wt === 'string' && /🟢|cross.*up|up.*cross/i.test(s.wt));
    const wtDisplay = s.wt || (hasWT ? '1m 🟢' : '—');

    // Pivot Mesafesi
    const pivotDist = this.parsePivotDistance(s.pivot);
    const pivotDisplay = pivotDist !== null ? `%${pivotDist.toFixed(2)} ⚠️` : '—';

    // Strateji (#W1 vs #S1) ve Yıldız Puanlama
    const strategy = this.determineStrategy({ hasWT, pivotDist, existingStrategy: s.strategy });
    const stars = s.stars || this.calculateStars({
      rsi1m: rsi1mNum,
      rsi5m: rsi5mNum,
      rsi1h: rsi1hNum,
      hasWT,
      pivotDist,
      boostNum
    });

    const card = {
      symbol: symbol,
      stars: stars,
      dot: '🟢',
      strategy: strategy,
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
      pivot: pivotDisplay,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new HammerProPlusBot();
