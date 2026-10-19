/**
 * v3-volume.bot.js — V3-A (Real-time volume monitoring)
 * Strateji: Anlık Hacim Patlaması & Taze Para Girişi Taraması
 */

const BaseBot = require('../base/base-bot');

class V3VolumeBot extends BaseBot {
  constructor() {
    super({
      id: 'v3',
      name: 'V3-A',
      description: 'Real-time volume monitoring & surge detector'
    });
  }

  /**
   * Hacim değişim yüzdesini güvenli float'a çevirir
   */
  parseVolumeChange(val) {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    const clean = String(val).replace(/[%+,\s]/g, '').trim();
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : parsed;
  }

  /**
   * 24 saatlik baz hacim değerini binlik basamaklarıyla ve coin birimiyle formatlar
   * Örn: 42158400, 'PEPE' -> '42.158.400 PEPE'
   */
  formatVolume24h(val, baseAsset) {
    if (val === undefined || val === null || val === '') return '—';
    const cleanNum = this.parseVolume24h(val);
    if (cleanNum === null) return '—';

    // Binlik basamak formatı (noktalı)
    const formattedNum = Math.round(cleanNum).toLocaleString('tr-TR');
    return `${formattedNum} ${baseAsset}`;
  }

  parseVolume24h(val) {
    if (val === undefined || val === null || val === '') return null;
    let number = val;
    if (typeof val !== 'number') {
      const match = String(val).match(/[+-]?(?:\d[\d.,]*|\.\d+)/);
      if (!match) return null;
      let raw = match[0];
      if (raw.includes(',')) raw = raw.replace(/\./g, '').replace(',', '.');
      else if ((raw.match(/\./g) || []).length > 1) raw = raw.replace(/\./g, '');
      number = Number(raw);
    }
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  /**
   * V3-A Hacim Patlama Doğrulama Filtresi (Trader Mantığı)
   * 1. Hacim artışı en az +8.00% olmalıdır (doküman aralığı: +9.48% ~ +173.44%)
   * 2. Negatif hacim veya hacim daralması bu bota giremez
   * 3. İllikit çöp coin filtresi: 24 saatlik baz hacim en az 500 birim olmalıdır
   */
  validateVolumeSurge({ volumeChangeNum, volume24hRaw }) {
    if (!Number.isFinite(volumeChangeNum) || volume24hRaw === undefined || volume24hRaw === null || volume24hRaw === '') {
      return { valid: false, reason: 'Gerçek hacim verisi eksik.' };
    }
    if (volumeChangeNum < 8.00) {
      return { valid: false, reason: `Hacim artışı (%${volumeChangeNum.toFixed(2)}) yetersiz (Min +%8.00 olmalı).` };
    }

    if (volume24hRaw !== undefined && volume24hRaw !== null) {
      const num24 = this.parseVolume24h(volume24hRaw);
      if (num24 === null || num24 < 500) {
        return { valid: false, reason: `24s baz hacim (${num24}) çok düşük; illikit yapay hareket riski.` };
      }
    }

    return { valid: true };
  }

  ingest(s) {
    if (!s || !(s.coin || s.symbol)) return null;
    const symbol = String(s.coin || s.symbol).trim().toUpperCase();
    const baseAsset = symbol.replace('USDT', '');
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Hacim artışını parse et
    const volChangeNum = this.parseMetric(s.hacimChange ?? s.volumeChange ?? s.volumeSurge ?? s.boost);
    
    // Doğrulama Filtresi
    const validation = this.validateVolumeSurge({
      volumeChangeNum: volChangeNum,
      volume24hRaw: s.hacim24s ?? s.volume24h ?? s.volume
    });

    if (!validation.valid) {
      console.warn(`[V3Volume] ⚠️ #${symbol} sinyali elendi: ${validation.reason}`);
      return null;
    }

    const volChangeFormatted = `+${volChangeNum.toFixed(2)}%`;
    const vol24sFormatted = this.formatVolume24h(s.hacim24s ?? s.volume24h ?? s.volume, baseAsset);

    const card = {
      symbol: symbol,
      hacimChange: volChangeFormatted,
      hacim24s: vol24sFormatted,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal({ ...card, ...this.signalMetadata(s) });
  }
}

module.exports = new V3VolumeBot();
