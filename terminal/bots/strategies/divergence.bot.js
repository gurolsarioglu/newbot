/**
 * divergence.bot.js — Divergence (Momentum and price relationship analysis)
 * Stratejiler: 1H RSI DIVERGENCE (Pozitif/Negatif), 1H RSI SMA CROSSED
 */

const BaseBot = require('../base/base-bot');
const { formatCryptoPrice, computePrevPrice } = require('../../services/price-formatter');

class DivergenceBot extends BaseBot {
  constructor() {
    super({
      id: 'div',
      name: 'Divergence',
      description: 'Momentum and price relationship analysis'
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
   * Divergence Analiz ve Yön Karar Motoru (Trader Mantığı)
   * - '🟢': Pozitif Uyumsuzluk / Boğa Dönüşü (1h RSI dipte, toparlanma var)
   * - '🔴': Negatif Uyumsuzluk / Ayı Dönüşü (1h RSI tepede, momentum zayıflamış)
   */
  evaluateDivergence({ rsi1h, rsi4h, boostNum, explicitDot, explicitStrategy, position, hasDivergence, hasSmaCross }) {
    if (!Number.isFinite(boostNum) || !Number.isFinite(rsi1h) || (!hasDivergence && !hasSmaCross)) {
      return { valid: false, reason: 'Teyit edilmiş pivot uyumsuzluğu veya RSI/SMA kesişimi yok.' };
    }
    const absBoost = Math.abs(boostNum);
    // 1. Minimum hareket eşiği (en az 0.25% sapma olmalı)
    if (absBoost < 0.25) {
      return { valid: false, reason: `Boost (%${absBoost.toFixed(2)}) uyumsuzluk teyidi için çok düşük.` };
    }

    // Açıkça belirtilmiş yön varsa
    if (explicitDot && (explicitDot === '🟢' || explicitDot === '🔴')) {
      return { valid: true, dot: explicitDot };
    }
    if (position === 'Short') return { valid: true, dot: '🔴' };
    if (position === 'Long') return { valid: true, dot: '🟢' };

    // 2. 1H RSI Değerine Göre Otomatik Ayrım:
    // A. 1H RSI <= 42 -> Pozitif Uyumsuzluk (🟢 Long)
    if (rsi1h <= 42) {
      return { valid: true, dot: '🟢' };
    }

    // B. 1H RSI >= 58 -> Negatif Uyumsuzluk (🔴 Short)
    if (rsi1h >= 58) {
      return { valid: true, dot: '🔴' };
    }

    // C. 43 - 57 arası nötr bölge (Uyumsuzluk için belirsiz)
    // Eğer özel bir strateji veya sinyal etiketi varsa kabul et, yoksa gürültüyü ele
    if (explicitStrategy) {
      return { valid: true, dot: rsi1h <= 50 ? '🟢' : '🔴' };
    }

    return { valid: false, reason: `1H RSI (${rsi1h}) nötr bölgede (43-57). Belirgin bir uyumsuzluk yok.` };
  }

  ingest(s) {
    if (!s || !(s.coin || s.symbol)) return null;
    const symbol = String(s.coin || s.symbol).trim().toUpperCase();
    const now = Date.now();
    const dateObj = new Date(now);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const priceNum = Number(s.price);
    const boostNum = this.parseMetric(s.boost ?? s.boostValue);
    if (!Number.isFinite(priceNum) || priceNum <= 0 || boostNum === null) return null;
    const boostFormatted = boostNum >= 0 ? `+${boostNum.toFixed(2)}%` : `${boostNum.toFixed(2)}%`;

    // Strateji İsmi Belirleme
    let strategy = '1H RSI DIVERGENCE';
    if (s.strategy) strategy = s.strategy;
    else if (s.rsiSmaCross) strategy = '1H RSI SMA CROSSED';
    else if (s.rsi1hDiv) strategy = '1H RSI DIVERGENCE';

    // RSI Değerleri (Sayısal parse ve dinamik ❗ formatı)
    const rsi1hNum = this.parseMetric(s.rsi1h ?? s.rsi, 0, 100);
    const rsi4hNum = this.parseMetric(s.rsi4h, 0, 100);
    const rsi1dNum = this.parseMetric(s.rsi1d, 0, 100);

    // SRSI Değerleri
    const srsi1hNum = this.parseMetric(s.srsi1h ?? s.stochK, 0, 100);
    const srsi4hNum = this.parseMetric(s.srsi4h, 0, 100);
    const srsi1dNum = this.parseMetric(s.srsi1d, 0, 100);

    // Uyumsuzluk ve Yön Karar Motoru
    const explicitDot = s.divergence?.hasBullDiv === true ? '🟢' : (s.divergence?.hasBearDiv === true ? '🔴' :
      (s.dot || (s.position === 'Short' ? '🔴' : (s.position === 'Long' ? '🟢' : null))));
    const analysis = this.evaluateDivergence({
      rsi1h: rsi1hNum,
      rsi4h: rsi4hNum,
      boostNum,
      explicitDot,
      explicitStrategy: s.strategy,
      position: s.position,
      hasDivergence: s.rsi1hDiv === true || s.divergence?.hasBullDiv === true || s.divergence?.hasBearDiv === true,
      hasSmaCross: s.rsiSmaCross === true
    });

    if (!analysis.valid) {
      console.warn(`[Divergence] ⚠️ #${symbol} sinyali elendi: ${analysis.reason}`);
      return null;
    }

    const dot = analysis.dot;

    // prevPrice güvenliği (Çift Yönlü Hesaplama):
    // Pozitif Uyumsuzluk (🟢): Fiyat dipten sekti -> prevPrice < currentPrice: price / (1 + boost/100)
    // Negatif Uyumsuzluk (🔴): Fiyat tepeden döndü -> prevPrice > currentPrice: price * (1 + boost/100)
    let prevPriceStr = Number(s.prevPrice) > 0 ? String(s.prevPrice) : '';
    if (!prevPriceStr || prevPriceStr === String(s.price)) {
      if (priceNum > 0 && boostNum !== 0) {
        prevPriceStr = computePrevPrice(priceNum, boostNum, s.price);
      } else {
        prevPriceStr = formatCryptoPrice(s.price);
      }
    }

    // Pivot Mesafesi Kontrolü
    let pivotDisplay = '—';
    if (s.pivot !== undefined && s.pivot !== null) {
      const pDist = this.parseDistance(s.pivot);
      pivotDisplay = typeof s.pivot === 'string' && s.pivot.includes('%') 
        ? s.pivot 
        : (pDist !== null ? `%${pDist.toFixed(2)} ⚠️` : '—');
    }

    // Dinamik ❗ formatlama: RSI <= 30 veya >= 70; SRSI <= 15 veya >= 85
    const fmtRsi = (v) => this.formatMetric(v, v >= 70 || v <= 30);
    const fmtSrsi = (v) => this.formatMetric(v, v >= 85 || v <= 15);

    const card = {
      symbol: symbol,
      timestamp: now,
      isoDate: dateObj.toISOString(),
      dateStr: dateStr,
      dot: dot,
      strategy: strategy,
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
      pivot: pivotDisplay,
      dateLabel: dateStr,
      time: nowTime
    };

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new DivergenceBot();
