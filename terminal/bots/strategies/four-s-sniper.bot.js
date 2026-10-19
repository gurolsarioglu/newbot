/**
 * four-s-sniper.bot.js — 4S Sniper (NW UP Structure Reversal)
 * Strateji: NW UP (Next / New Wave Up - 4 Saatlik Dipten Sniper Dönüş)
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class FourSSniperBot extends BaseBot {
  constructor() {
    super({
      id: '4ssniper',
      name: '4S Sniper',
      description: 'Multi-angle view of the 4H structure (NW UP Strategy)'
    });
  }

  /**
   * Boost değerini güvenli float'a çevirir
   */
  parseBoost(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%+,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Yüzdesel oran (Trader Positioning / Market Exposure) ve Dot (🟢/🔴) ayrıştırıcı
   * Top Trader threshold: %60.0
   * Market Exposure threshold: %55.0
   */
  parseRatioAndDot(val, threshold = 60.0, fallback = null) {
    let rawNum = fallback;
    let explicitDot = null;

    if (typeof val === 'number') {
      rawNum = isNaN(val) ? fallback : val;
    } else if (val) {
      const str = String(val);
      if (str.includes('🟢')) explicitDot = '🟢';
      else if (str.includes('🔴')) explicitDot = '🔴';
      else if (str.includes('⚪')) explicitDot = '⚪';

      const clean = str.replace(/[🟢🔴⚪%+,\s]/g, '').trim();
      const parsed = parseFloat(clean);
      if (!isNaN(parsed)) rawNum = parsed;
    }

    if (!Number.isFinite(rawNum) || rawNum < 0 || rawNum > 100) return { value: null, formatted: '—', dot: '⚪' };
    const dot = explicitDot || (rawNum >= threshold ? '🟢' : '🔴');
    const formatted = `${rawNum.toFixed(2)}%`;

    return { value: rawNum, formatted, dot };
  }

  /**
   * 4S Sniper (NW UP) Doğrulama ve Kalite Filtresi (Trader Mantığı)
   * 1. Boost ivmesi en az +3.00% (doküman aralığı: +3.62% ~ +32.95%)
   * 2. 1h RSI <= 38 VEYA 4h SRSI <= 20 olmalıdır (Gerçek dipten kalkış teyidi)
   * 3. Balina (Top Trader) oranı en az %48 olmalıdır (Kurşun önüne atlamama kuralı)
   */
  validateSniperReversal({ rsi1h, srsi4h, boostNum, traderRatio }) {
    if (![rsi1h, srsi4h, boostNum, traderRatio].every(Number.isFinite)) return { valid: false, reason: 'Sniper gösterge/oran verisi eksik.' };
    if (boostNum < 3.00) {
      return { valid: false, reason: `Boost (${boostNum.toFixed(2)}%) 4H Sniper için yetersiz (Min +%3.00 olmalı).` };
    }

    if (boostNum > 45.0) {
      return { valid: false, reason: `Boost (${boostNum.toFixed(2)}%) aşırı genişlemiş; tepe alım riski.` };
    }

    if (rsi1h > 38 && srsi4h > 20) {
      return { valid: false, reason: `1h RSI (${rsi1h}) ve 4h SRSI (${srsi4h}) dip bölgesinde değil. Zirveden alış riski.` };
    }

    if (traderRatio < 48.0) {
      return { valid: false, reason: `Balina Long oranı (%${traderRatio.toFixed(1)}) çok düşük; satıcı baskısı hakim.` };
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

    // RSI Değerleri (Sayısal parse ve ❗ formatı)
    const rsi1hNum = this.parseMetric(s.rsi1h ?? s.rsi, 0, 100);
    const rsi4hNum = this.parseMetric(s.rsi4h, 0, 100);
    const rsi1dNum = this.parseMetric(s.rsi1d, 0, 100);

    // SRSI Değerleri
    const srsi1hNum = this.parseMetric(s.srsi1h, 0, 100);
    const srsi4hNum = this.parseMetric(s.srsi4h, 0, 100);
    const srsi1dNum = this.parseMetric(s.srsi1d, 0, 100);

    // Trader Positioning (%60+ için 🟢) ve Market Exposure (%55+ için 🟢)
    const tpData = this.parseRatioAndDot(s.traderPositioning, 60.0);
    const meData = this.parseRatioAndDot(s.marketExposure, 55.0);

    // Doğrulama Filtresi
    const validation = this.validateSniperReversal({
      rsi1h: rsi1hNum,
      srsi4h: srsi4hNum,
      boostNum,
      traderRatio: tpData.value
    });

    if (!validation.valid) {
      console.warn(`[4SSniper] ⚠️ #${symbol} sinyali elendi: ${validation.reason}`);
      return null;
    }

    const card = {
      symbol: symbol,
      dot: '🟢', // NW UP sniper dip dönüşü her zaman Long teyitli yeşil noktadır
      strategy: s.strategy || 'NW UP',
      boostValue: boostFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      rsi: {
        h1: this.formatMetric(rsi1hNum, rsi1hNum <= 30),
        h4: this.formatMetric(rsi4hNum, rsi4hNum <= 30),
        d1: this.formatMetric(rsi1dNum)
      },
      srsi: {
        h1: this.formatMetric(srsi1hNum, srsi1hNum <= 15),
        h4: this.formatMetric(srsi4hNum, srsi4hNum <= 15),
        d1: this.formatMetric(srsi1dNum)
      },
      traderPositioning: tpData.formatted,
      traderDot: tpData.dot,
      marketExposure: meData.formatted,
      exposureDot: meData.dot,
      dateLabel: 'Today',
      time: nowTime
    };

    if (s.displaySymbol) {
      card.displaySymbol = s.displaySymbol;
    }

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new FourSSniperBot();
