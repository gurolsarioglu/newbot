/**
 * funding-rate.bot.js — FR (Funding Rate Perspective, Simulation & Arbitrage Alerts)
 * Strateji: Funding Flip (+ to -), Negatif Fonlama Derinleşmesi, Squeeze Uyarısı
 */

const BaseBot = require('../base/base-bot');

class FundingRateBot extends BaseBot {
  constructor() {
    super({
      id: 'fr',
      name: 'FR',
      description: 'Funding rate perspective, simulation & arbitrage alerts'
    });
  }

  /**
   * Fonlama oranını güvenli float yüzdesine çevirir
   */
  parseFundingRate(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * Binance 8 saatlik periyotlarına (UTC 00:00, 08:00, 16:00) göre kalan süreyi hesaplar
   */
  calculateFundingCountdown() {
    const now = new Date();
    const currentUtcHour = now.getUTCHours();
    const nextFundingUtcHour = Math.ceil((currentUtcHour + 0.001) / 8) * 8;
    
    const targetUtc = new Date(now);
    targetUtc.setUTCHours(nextFundingUtcHour, 0, 0, 0);

    let diffMs = targetUtc.getTime() - now.getTime();
    if (diffMs < 0) diffMs += 8 * 3600 * 1000;

    const diffSecTotal = Math.floor(diffMs / 1000);
    const hours = Math.floor(diffSecTotal / 3600);
    const minutes = Math.floor((diffSecTotal % 3600) / 60);
    const seconds = diffSecTotal % 60;

    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }

  /**
   * Fonlama Değişimi & Squeeze Karar Motoru (Trader Mantığı)
   * 1. + 'dan - 'ye geçiş -> 'Funding changed from + to -' (🟢 Short Squeeze Fırsatı)
   * 2. - 'den + 'ya geçiş -> 'Funding changed from - to +' (🟢 Normale Dönüş)
   * 3. Ekstrem Negatif (<= -0.25%) -> 'High Negative Funding Alert' (🔴 Yüksek Risk / Squeeze Alarmı)
   * 4. Negatif Derinleşme -> 'Negative Funding Deepening' (🔴)
   */
  evaluateFundingRate({ currNum, prevNum, explicitAlert, explicitDot }) {
    // Açıkça belirtilmiş bir durum varsa önceliklendir
    if (explicitAlert && explicitDot) {
      return { valid: true, alertText: explicitAlert, dot: explicitDot };
    }

    const isFlipPlusToMinus = prevNum >= 0 && currNum < 0;
    const isFlipMinusToPlus = prevNum <= 0 && currNum > 0;
    const isExtremeNegative = currNum <= -0.25;
    const isDeepeningNegative = currNum < prevNum && currNum < -0.10;

    if (isFlipPlusToMinus) {
      return {
        valid: true,
        alertText: 'Funding changed from + to -',
        dot: '🟢' // Short squeeze alım fırsatı
      };
    }

    if (isFlipMinusToPlus) {
      return {
        valid: true,
        alertText: 'Funding changed from - to +',
        dot: '🟢'
      };
    }

    if (isExtremeNegative) {
      return {
        valid: true,
        alertText: explicitAlert || 'High Negative Funding Alert',
        dot: '🔴'
      };
    }

    if (isDeepeningNegative) {
      return {
        valid: true,
        alertText: explicitAlert || 'Negative Funding Deepening',
        dot: '🔴'
      };
    }

    // Mikro dalgalanmaları filtrele
    const diff = Math.abs(currNum - prevNum);
    if (diff < 0.02 && Math.abs(currNum) < 0.15 && !explicitAlert) {
      return { valid: false, reason: `Fonlama değişimi (%${diff.toFixed(4)}) çok küçük; kayda değer bir arbitraj veya squeeze yok.` };
    }

    return {
      valid: true,
      alertText: explicitAlert || 'Funding Rate Alert',
      dot: currNum < 0 ? '🔴' : '🟢'
    };
  }

  ingest(s) {
    const symbol = (s.coin || s.symbol).toUpperCase();
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const currNum = this.parseFundingRate(s.fundingRate || s.funding);
    const prevNum = this.parseFundingRate(s.previousFunding || (currNum >= 0 ? currNum - 0.05 : currNum + 0.05));

    // Fonlama Değişimi & Squeeze Karar Motoru
    const explicitAlert = s.alertText ? String(s.alertText).replace(/^[⚠️\s]+/, '').trim() : null;
    const analysis = this.evaluateFundingRate({
      currNum,
      prevNum,
      explicitAlert,
      explicitDot: s.dot
    });

    if (!analysis.valid) {
      console.warn(`[FundingRate] ⚠️ #${symbol} sinyali elendi: ${analysis.reason}`);
      return null;
    }

    // Fark hesaplama: Current - Previous
    const diffNum = currNum - prevNum;
    const diffFormatted = diffNum >= 0 ? `+${diffNum.toFixed(4)}%` : `${diffNum.toFixed(4)}%`;

    const currFormatted = currNum >= 0 ? `+${currNum.toFixed(4)}%` : `${currNum.toFixed(4)}%`;
    const prevFormatted = prevNum >= 0 ? `+${prevNum.toFixed(4)}%` : `${prevNum.toFixed(4)}%`;

    const timeRemaining = s.timeRemaining || this.calculateFundingCountdown();

    const card = {
      id: 'fr_' + Date.now(),
      symbol: symbol,
      dot: analysis.dot,
      alertText: analysis.alertText,
      fundingRate: currFormatted,
      previousFunding: prevFormatted,
      difference: diffFormatted,
      timeRemaining: timeRemaining,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal(card);
  }
}

module.exports = new FundingRateBot();
