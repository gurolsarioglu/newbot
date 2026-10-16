/**
 * four-s.bot.js — 4S (Multi-angle view of the 4H structure)
 * Strateji: 4H Yapı, Yüksek Boost Ani Sıçrama, HTF RSI/SRSI & Balina Pozisyonlanması
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class FourSBot extends BaseBot {
  constructor() {
    super({
      id: '4s',
      name: '4S',
      description: 'Multi-angle view of the 4H structure'
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
  parseRatioAndDot(val, threshold = 60.0, fallback = 55.0) {
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

    const dot = explicitDot || (rawNum >= threshold ? '🟢' : '🔴');
    const formatted = `${rawNum.toFixed(2)}%`;

    return { value: rawNum, formatted, dot };
  }

  /**
   * 4S Yapı & Sahte Pump (Bull Trap) Analiz Motoru (Trader Karar Algoritması)
   * Çıktı:
   * - '🔴': Sahte Pump / Aşırı Şişmiş Tepe / Boğa Tuzağı Uyarısı (FOMO ile alma, Short kolla!)
   * - '🟢': Sağlıklı Trend / Güçlü Balina Desteğiyle Sürdürülebilir Ralli
   */
  evaluate4HStructure({ rsi1d, rsi4h, srsi1d, srsi4h, srsi1h, traderRatio, exposureRatio, boostNum, explicitDot }) {
    // 1. Boost Filtresi: 4H Yapı için en az +5.00% sıçrama aranır
    if (boostNum < 5.00) {
      return { valid: false, reason: `Boost (${boostNum.toFixed(2)}%) 4H ana yapı için yetersiz (Min +%5.00 olmalı).` };
    }

    // Açıkça belirtilmiş bir yön varsa (örn: sinyal verisindeki dot)
    if (explicitDot && (explicitDot === '🔴' || explicitDot === '🟢')) {
      return { valid: true, dot: explicitDot };
    }

    // 2. 🔴 Sahte Pump / Aşırı Alım Tepe Tuzağı Koşulları:
    // A. Günlük veya 4H RSI aşırı alım bölgesinde mi? (>= 70)
    const isDailyOverbought = rsi1d >= 70;
    const is4HOverbought = rsi4h >= 68;

    // B. Stokastik RSI tavan yaptı mı? (>= 85)
    const isSrsiCeiling = srsi1d >= 85 || srsi4h >= 85 || srsi1h >= 95;

    // C. Perakende FOMO'su: Perakende alırken balina satıyor mu? (Market Exposure >= Trader Positioning)
    const isRetailFomo = exposureRatio >= traderRatio && boostNum >= 10.0;

    // Eğer aşırı alım veya perakende tuzağı varsa -> 🔴 Kırmızı Tepe Uyarısı
    if (isDailyOverbought || (is4HOverbought && isSrsiCeiling) || isRetailFomo) {
      return { valid: true, dot: '🔴' };
    }

    // 3. 🟢 Sağlıklı Trend Devamı Koşulları:
    // Balina oranı yüksek (>= 60%), günlük RSI henüz tepe yapmamış (< 70)
    if (traderRatio >= 60.0 && rsi1d < 70) {
      return { valid: true, dot: '🟢' };
    }

    // Varsayılan: Şüpheli yapı varsa temkinli olarak 🔴 uyarısı verilir
    return { valid: true, dot: traderRatio >= exposureRatio ? '🟢' : '🔴' };
  }

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

    // RSI Değerleri (Sayısal parse ve dinamik ❗ formatı)
    const rawRsi = parseInt(s.rsi, 10);
    const rsi1hNum = parseInt(s.rsi1h || (!isNaN(rawRsi) ? rawRsi : 50), 10);
    const rsi4hNum = parseInt(s.rsi4h || 55, 10);
    const rsi1dNum = parseInt(s.rsi1d || 60, 10);

    // SRSI Değerleri (Sayısal parse ve dinamik ❗ formatı)
    const srsi1hNum = parseInt(s.srsi1h || 50, 10);
    const srsi4hNum = parseInt(s.srsi4h || s.stochK || 50, 10);
    const srsi1dNum = parseInt(s.srsi1d || 50, 10);

    // Trader Positioning (%60+ için 🟢) ve Market Exposure (%55+ için 🟢)
    const tpData = this.parseRatioAndDot(s.traderPositioning, 60.0, 65.0);
    const meData = this.parseRatioAndDot(s.marketExposure, 55.0, 58.0);

    // 4H Yapı & Sahte Pump Analiz Motoru
    const explicitDot = s.dot || (s.position === 'Short' ? '🔴' : (s.position === 'Long' ? '🟢' : null));
    const analysis = this.evaluate4HStructure({
      rsi1d: rsi1dNum,
      rsi4h: rsi4hNum,
      srsi1d: srsi1dNum,
      srsi4h: srsi4hNum,
      srsi1h: srsi1hNum,
      traderRatio: tpData.value,
      exposureRatio: meData.value,
      boostNum,
      explicitDot
    });

    if (!analysis.valid) {
      console.warn(`[4S] ⚠️ #${symbol} sinyali elendi: ${analysis.reason}`);
      return null;
    }

    // Dinamik ❗ formatlama: RSI >= 70 veya <= 30; SRSI >= 85 veya <= 15
    const fmtRsi = (v) => `${v}${v >= 70 || v <= 30 ? ' ❗' : ''}`;
    const fmtSrsi = (v) => `${v}${v >= 85 || v <= 15 ? ' ❗' : ''}`;

    const card = {
      id: '4s_' + Date.now(),
      symbol: symbol,
      dot: analysis.dot,
      market: 'FUTURES',
      strategy: s.strategy || '4H STRUCTURE',
      boostValue: boostFormatted,
      currentPrice: formatCryptoPrice(s.price),
      prevPrice: prevPriceStr,
      rsi: {
        h1: fmtRsi(rsi1hNum),
        h4: fmtRsi(rsi4hNum),
        d1: fmtRsi(rsi1dNum)
      },
      srsi: {
        h1: fmtSrsi(srsi1hNum),
        h4: fmtSrsi(srsi4hNum),
        d1: fmtSrsi(srsi1dNum)
      },
      traderPositioning: tpData.formatted,
      traderDot: tpData.dot,
      marketExposure: meData.formatted,
      exposureDot: meData.dot,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal(card);
  }
}

module.exports = new FourSBot();
