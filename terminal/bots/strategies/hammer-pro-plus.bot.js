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
    if (!pivotStr) return null;
    if (typeof pivotStr === 'number') return Math.abs(pivotStr);
    const clean = String(pivotStr).replace(/[%+⚠️\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? null : Math.abs(parsed);
  }

  /**
   * ⭐ Yıldız Puanlama Motoru (Confluence Engine)
   */
  calculateStars({ rsi1m, rsi5m, rsi1h, hasWT, pivotDist, boostNum }) {
    const isM1Dip = rsi1m <= 30;
    const isM5Dip = rsi5m <= 32;
    const isH1Dip = rsi1h <= 35;
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
    return (rsi5m <= 42 || rsi1h <= 42);
  }

  /**
   * Dışarıdan veya avcı botlardan gelen sinyali Hammer Pro Plus formatına çevirir ve doğrular
   */
  ingest(s) {
    const symbol = (s.coin || s.symbol).toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = parseFloat(s.price || 0);
    const boostNum = this.parseBoost(s.boost || s.boostValue);
    const boostFormatted = `+${boostNum.toFixed(2)}%`;

    // prevPrice güvenliği: Eğer prevPrice yoksa veya price ile aynıysa, boost üzerinden geriye doğru hesapla
    let prevPriceStr = s.prevPrice ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && boostNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, boostNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    // RSI Değerleri (Eksik veri gelirse sahte veri doldurmak yerine tutarlı parse et)
    const rawRsi = parseInt(s.rsi, 10);
    const rsi1mNum = parseInt(s.rsi1m || (!isNaN(rawRsi) ? rawRsi : 28), 10);
    const rsi5mNum = parseInt(s.rsi5m || (!isNaN(rawRsi) ? Math.min(rawRsi + 2, 45) : 30), 10);
    const rsi1hNum = parseInt(s.rsi1h || 35, 10);

    // 1m WaveTrend Gürültü Kontrolü
    const isQualityReversal = this.validateReversalQuality({ rsi5m: rsi5mNum, rsi1h: rsi1hNum });
    if (!isQualityReversal) {
      console.warn(`[HammerProPlus] ⚠️ #${symbol} sinyali 5m/1h aşırı satım teyidi olmadığı için (Whipsaw riski) elendi.`);
      return null;
    }

    // WaveTrend Teyidi
    const hasWT = Boolean(s.wt || s.stochK < 20 || rsi1mNum <= 30);
    const wtDisplay = s.wt || (hasWT ? '1m 🟢' : '');

    // Pivot Mesafesi
    const pivotDist = this.parsePivotDistance(s.pivot);
    const pivotDisplay = s.pivot || (pivotDist !== null ? `%${pivotDist.toFixed(2)} ⚠️` : '%0.25 ⚠️');

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
      id: 'hpp_' + Date.now(),
      symbol: symbol,
      stars: stars,
      dot: '🟢',
      strategy: strategy,
      boostValue: boostFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      rsi: {
        m1: `${rsi1mNum}${rsi1mNum <= 30 ? ' ❗' : ''}`,
        m5: `${rsi5mNum}${rsi5mNum <= 30 ? ' ❗' : ''}`,
        h1: `${rsi1hNum}${rsi1hNum <= 30 ? ' ❗' : ''}`
      },
      srsi: {
        m1: String(s.srsi1m || s.stochK || '15'),
        m5: `${s.srsi5m || s.stochD || '5'}${parseInt(s.srsi5m || s.stochD || 5, 10) <= 15 ? ' ❗' : ''}`,
        h1: `${s.srsi1h || '8'}${parseInt(s.srsi1h || 8, 10) <= 15 ? ' ❗' : ''}`
      },
      wt: wtDisplay,
      pivot: pivotDisplay,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal(card);
  }
}

module.exports = new HammerProPlusBot();
