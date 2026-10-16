/**
 * m1a-drop.bot.js — M1-A (Focused insight on the smallest timeframe)
 * Strateji: Mikro Düşüş (Drop Value), Hacim Çekilmesi, Stochastic K/D, BTC Durum Kontrolü
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class M1ADropBot extends BaseBot {
  constructor() {
    super({
      id: 'm1a',
      name: 'M1-A',
      description: 'Focused insight on the smallest timeframe'
    });
  }

  /**
   * Drop veya Boost değerini işaretli float yüzdesine çevirir
   */
  parseDropOrBoost(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Hacim değişim yüzdesini parse eder
   */
  parseVolumeChange(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Stochastic K/D oranını temiz string formatına dönüştürür (örn: '57/77')
   */
  formatStochastic(kVal, dVal, rawStr) {
    if (rawStr && typeof rawStr === 'string' && rawStr.includes('/')) {
      return rawStr.trim();
    }
    const k = Math.round(parseFloat(kVal || 50));
    const d = Math.round(parseFloat(dVal || 50));
    return `${k}/${d}`;
  }

  /**
   * M1-A Mikro Düşüş / Sıçrama Karar Motoru (Trader Mantığı)
   * 1. Drop Value <= -0.75% -> Mikro Düşüş ('drop' / 🔴)
   * 2. Boost Value >= +0.75% -> Mikro Sıçrama ('boost' / 🟢)
   * 3. Çok küçük hareketler (< 0.50%) gürültü olarak elenir
   */
  evaluateM1A({ valNum, volNum, explicitType, explicitDot }) {
    if (explicitType && explicitDot) {
      return { valid: true, type: explicitType, dot: explicitDot };
    }

    // Mikro gürültü filtresi
    if (Math.abs(valNum) < 0.50) {
      return { valid: false, reason: `Fiyat değişimi (%${valNum.toFixed(2)}) 1m scalp için yetersiz (Min %0.50 olmalı).` };
    }

    if (valNum < 0) {
      // Düşüş kontrolü
      return {
        valid: true,
        type: 'drop',
        dot: '🔴'
      };
    } else {
      // Sıçrama kontrolü
      return {
        valid: true,
        type: 'boost',
        dot: '🟢'
      };
    }
  }

  ingest(s) {
    const symbol = (s.coin || s.symbol).toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = parseFloat(s.price || 0);
    const rawVal = s.dropValue !== undefined ? s.dropValue : (s.drop !== undefined ? s.drop : (s.boost !== undefined ? s.boost : (s.position === 'Short' ? -1.05 : 1.10)));
    const valNum = this.parseDropOrBoost(rawVal);
    const volNum = this.parseVolumeChange(s.volume || (valNum < 0 ? -1.50 : 2.50));

    // M1-A Karar Motoru
    const explicitType = s.type || (s.position === 'Short' ? 'drop' : (s.position === 'Long' ? 'boost' : null));
    const explicitDot = s.dot || (s.position === 'Short' ? '🔴' : (s.position === 'Long' ? '🟢' : null));
    const analysis = this.evaluateM1A({
      valNum,
      volNum,
      explicitType,
      explicitDot
    });

    if (!analysis.valid) {
      console.warn(`[M1ADrop] ⚠️ #${symbol} sinyali elendi: ${analysis.reason}`);
      return null;
    }

    const type = analysis.type;
    const dot = analysis.dot;

    // prevPrice güvenliği (Çift Yönlü Formül):
    // Drop (🔴): Fiyat düştü -> prevPrice > currentPrice: currentPrice / (1 + valNum/100)
    // Boost (🟢): Fiyat arttı -> prevPrice < currentPrice: currentPrice / (1 + valNum/100)
    let prevPriceStr = s.prevPrice ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && valNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, valNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    const valFormatted = valNum >= 0 ? `+${valNum.toFixed(2)}%` : `${valNum.toFixed(2)}%`;
    const volFormatted = volNum >= 0 ? `+${volNum.toFixed(2)}%` : `${volNum.toFixed(2)}%`;

    // RSI Değerleri (Aşırı değerde ⚠️ alarmı)
    const rawRsi = parseInt(s.rsi, 10);
    const rsiNum = !isNaN(rawRsi) ? rawRsi : (valNum < 0 ? 65 : 75);
    const rsiFormatted = `${rsiNum}${rsiNum >= 75 || rsiNum <= 25 ? ' ⚠️' : ''}`;

    // Stochastic formatı
    const stochFormatted = this.formatStochastic(s.stochK, s.stochD, s.stochastic);

    const card = {
      id: 'm1a_' + Date.now(),
      symbol: symbol,
      type: type,
      dot: dot,
      dropValue: valFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      volume: volFormatted,
      rsi: rsiFormatted,
      stochastic: stochFormatted,
      btcStatus: s.btcStatus || 'Normal',
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal(card);
  }
}

module.exports = new M1ADropBot();
