/**
 * m1-premium.bot.js — M1 Premium (Momentum & Breakout)
 * Strateji: 1 Dakikalık Ani Mum Sıçraması (Boost), RSI >= 70 Tavan İvmesi, 1m Divergence
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class M1PremiumBot extends BaseBot {
  constructor() {
    super({
      id: 'm1premium',
      name: 'M1 Premium',
      description: 'Enhanced minute-level analytics & divergence'
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
   * M1 Premium Momentum & Yıldız (⭐) Değerlendirme Motoru (Trader Mantığı)
   * 1. Boost ivmesi en az +0.80% olmalıdır (doküman: +1.00% ~ +3.00%)
   * 2. 1m RSI >= 60 veya 1m SRSI >= 75 olmalıdır (Güçlü alıcı / momentum)
   * 3. Yıldız (⭐ / isFavorite): Boost >= +1.50% ve (RSI >= 68 veya Divergence veya SRSI >= 95)
   */
  evaluateM1Premium({ boostNum, rsi1m, srsi1m, divergence, explicitFav }) {
    // Breakout eşik kontrolü: En az %0.80 ani sıçrama
    if (boostNum < 0.80) {
      return { valid: false, reason: `Boost (${boostNum.toFixed(2)}%) 1m breakout ivmesi için yetersiz (Min +%0.80 olmalı).` };
    }

    // Momentum teyidi: 1m RSI veya SRSI canlı olmalı
    if (rsi1m < 60 && srsi1m < 75) {
      return { valid: false, reason: `1m RSI (${rsi1m}) ve 1m SRSI (${srsi1m}) momentum bölgesinde değil.` };
    }

    // ⭐ Yıldız / Premium Kalite Kararı
    let isFavorite = false;
    if (explicitFav === true) {
      isFavorite = true;
    } else if (boostNum >= 1.50 && (rsi1m >= 68 || divergence || srsi1m >= 90)) {
      isFavorite = true;
    }

    return { valid: true, isFavorite };
  }

  ingest(s) {
    const symbol = (s.coin || s.symbol).toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = parseFloat(s.price || 0);
    const boostNum = this.parseBoost(s.boost || s.boostValue);
    const boostFormatted = `+${boostNum.toFixed(2)}%`;

    // RSI Değerleri (Sayısal parse)
    const rawRsi = parseInt(s.rsi, 10);
    const rsi1mNum = parseInt(s.rsi1m || (!isNaN(rawRsi) ? rawRsi : 72), 10);
    const rsi5mNum = parseInt(s.rsi5m || 60, 10);
    const rsi1hNum = parseInt(s.rsi1h || 45, 10);

    // SRSI Değerleri
    const srsi1mNum = parseInt(s.srsi1m || s.stochK || 85, 10);
    const srsi5mNum = parseInt(s.srsi5m || s.stochD || 70, 10);
    const srsi1hNum = parseInt(s.srsi1h || 30, 10);

    // Divergence Teyidi
    const hasDiv = Boolean(s.divergence || s.rsi1mDiv || s.rsi1hDiv);
    const divDisplay = hasDiv ? '1m ✅' : undefined;

    // M1 Premium Doğrulama ve Yıldız Motoru
    const explicitFav = s.isFavorite !== undefined ? Boolean(s.isFavorite) : null;
    const analysis = this.evaluateM1Premium({
      boostNum,
      rsi1m: rsi1mNum,
      srsi1m: srsi1mNum,
      divergence: hasDiv,
      explicitFav
    });

    if (!analysis.valid) {
      console.warn(`[M1Premium] ⚠️ #${symbol} sinyali elendi: ${analysis.reason}`);
      return null;
    }

    // prevPrice güvenliği: Eğer prevPrice yoksa veya price ile aynıysa, boost üzerinden geriye doğru hesapla
    let prevPriceStr = s.prevPrice ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && boostNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, boostNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    // Dinamik ❗ formatlama: RSI >= 70; SRSI >= 80
    const fmtRsi = (v) => `${v}${v >= 70 ? ' ❗' : ''}`;
    const fmtSrsi = (v) => `${v}${v >= 80 ? ' ❗' : ''}`;

    const card = {
      id: 'm1p_' + Date.now(),
      symbol: symbol,
      isFavorite: analysis.isFavorite,
      boostValue: boostFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      rsi: {
        m1: fmtRsi(rsi1mNum),
        m5: fmtRsi(rsi5mNum),
        h1: fmtRsi(rsi1hNum)
      },
      srsi: {
        m1: fmtSrsi(srsi1mNum),
        m5: fmtSrsi(srsi5mNum),
        h1: fmtSrsi(srsi1hNum)
      },
      dateLabel: 'Today',
      time: nowTime
    };

    if (divDisplay) {
      card.divergence = divDisplay;
    }

    return this.addSignal(card);
  }
}

module.exports = new M1PremiumBot();
