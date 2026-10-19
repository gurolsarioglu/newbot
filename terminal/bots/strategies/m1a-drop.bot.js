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
      description: 'Küçük zaman diliminde odaklı içgörü'
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
    const kNum = this.parseMetric(kVal, 0, 100);
    const dNum = this.parseMetric(dVal, 0, 100);
    if (kNum === null || dNum === null) return '—';
    const k = Math.round(kNum);
    const d = Math.round(dNum);
    return `${k}/${d}`;
  }

  /**
   * M1-A Mikro Düşüş / Sıçrama Karar Motoru (Trader Mantığı)
   * 1. Drop Value <= -0.75% -> Mikro Düşüş ('drop' / 🔴)
   * 2. Boost Value >= +0.75% -> Mikro Sıçrama ('boost' / 🟢)
   * 3. Çok küçük hareketler (< 0.50%) gürültü olarak elenir
   */
  evaluateM1A({ valNum, volNum, explicitType, explicitDot }) {
    if (!Number.isFinite(valNum) || !Number.isFinite(volNum)) return { valid: false, reason: 'Fiyat/hacim verisi eksik.' };

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
    if (!s || !(s.coin || s.symbol)) return null;
    const symbol = String(s.coin || s.symbol).trim().toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = Number(s.price);
    const rawVal = s.dropValue ?? s.drop ?? s.boost ?? s.boostValue;
    const valNum = this.parseMetric(rawVal);
    const volNum = this.parseMetric(s.volume);
    const rsiNum = this.parseMetric(s.rsi, 0, 100);
    if (!Number.isFinite(priceNum) || priceNum <= 0 || valNum === null || volNum === null || rsiNum === null) return null;

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
    let prevPriceStr = Number(s.prevPrice) > 0 ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && valNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, valNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    const valFormatted = valNum >= 0 ? `+${valNum.toFixed(2)}%` : `${valNum.toFixed(2)}%`;
    const volFormatted = volNum >= 0 ? `+${volNum.toFixed(2)}%` : `${volNum.toFixed(2)}%`;

    // RSI Değerleri (Aşırı değerde ⚠️ alarmı: <= 30 veya >= 70)
    const rsiFormatted = `${rsiNum}${rsiNum >= 70 || rsiNum <= 30 ? ' ⚠️' : ''}`;

    // Stochastic formatı (K <= 20 veya K >= 80 ise ⚠️ alarmı)
    let stochFormatted = this.formatStochastic(s.stochK, s.stochD, s.stochastic);
    const stochParts = String(stochFormatted).replace(/[^\d/]/g, '').split('/');
    if (stochParts.length === 2) {
      const k = parseInt(stochParts[0], 10);
      if (!isNaN(k) && (k <= 20 || k >= 80)) {
        if (!stochFormatted.includes('⚠️')) {
          stochFormatted = `${stochFormatted} ⚠️`;
        }
      }
    }

    const card = {
      symbol: symbol,
      type: type,
      dot: dot,
      dropValue: type === 'drop' ? valFormatted : null,
      boostValue: type === 'boost' ? valFormatted : null,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      volume: volFormatted,
      rsi: rsiFormatted,
      stochastic: stochFormatted,
      btcStatus: s.btcStatus || '—',
      dateLabel: 'Bugün',
      time: nowTime
    };

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new M1ADropBot();
