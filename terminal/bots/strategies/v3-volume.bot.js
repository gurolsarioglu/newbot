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
    if (!val) return `1.000.000 ${baseAsset}`;
    
    // Eğer string zaten coin birimi içeriyorsa doğrudan temizle ve dön
    if (typeof val === 'string' && val.includes(baseAsset)) {
      return val.trim();
    }

    // Sayısal değeri çıkar
    const cleanNum = typeof val === 'number' ? val : parseFloat(String(val).replace(/[^0-9.]/g, ''));
    if (isNaN(cleanNum) || cleanNum <= 0) {
      return `1.000.000 ${baseAsset}`;
    }

    // Binlik basamak formatı (noktalı)
    const formattedNum = Math.round(cleanNum).toLocaleString('tr-TR');
    return `${formattedNum} ${baseAsset}`;
  }

  /**
   * V3-A Hacim Patlama Doğrulama Filtresi (Trader Mantığı)
   * 1. Hacim artışı en az +8.00% olmalıdır (doküman aralığı: +9.48% ~ +173.44%)
   * 2. Negatif hacim veya hacim daralması bu bota giremez
   * 3. İllikit çöp coin filtresi: 24 saatlik baz hacim en az 500 birim olmalıdır
   */
  validateVolumeSurge({ volumeChangeNum, volume24hRaw }) {
    if (volumeChangeNum < 8.00) {
      return { valid: false, reason: `Hacim artışı (%${volumeChangeNum.toFixed(2)}) yetersiz (Min +%8.00 olmalı).` };
    }

    if (volume24hRaw !== undefined && volume24hRaw !== null) {
      let rawStr = String(volume24hRaw).trim();
      // '25.000.000' veya '42.158.400' gibi binlik noktalarını temizle
      if ((rawStr.match(/\./g) || []).length > 1) {
        rawStr = rawStr.replace(/\./g, '');
      } else if (rawStr.includes('.') && rawStr.includes(',')) {
        rawStr = rawStr.replace(/\./g, '').replace(',', '.');
      }
      const num24 = typeof volume24hRaw === 'number' ? volume24hRaw : parseFloat(rawStr.replace(/[^0-9.]/g, ''));
      if (!isNaN(num24) && num24 > 0 && num24 < 500) {
        return { valid: false, reason: `24s baz hacim (${num24}) çok düşük; illikit yapay hareket riski.` };
      }
    }

    return { valid: true };
  }

  ingest(s) {
    const symbol = (s.coin || s.symbol).toUpperCase();
    const baseAsset = symbol.replace('USDT', '');
    const nowTime = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Hacim artışını parse et
    const volChangeNum = this.parseVolumeChange(s.hacimChange || s.volumeChange || s.volumeSurge || s.boost);
    
    // Doğrulama Filtresi
    const validation = this.validateVolumeSurge({
      volumeChangeNum: volChangeNum,
      volume24hRaw: s.hacim24s || s.volume24h || s.volume
    });

    if (!validation.valid) {
      console.warn(`[V3Volume] ⚠️ #${symbol} sinyali elendi: ${validation.reason}`);
      return null;
    }

    const volChangeFormatted = `+${volChangeNum.toFixed(2)}%`;
    const vol24sFormatted = this.formatVolume24h(s.hacim24s || s.volume24h || s.volume, baseAsset);

    const card = {
      id: 'v3_' + Date.now(),
      symbol: symbol,
      hacimChange: volChangeFormatted,
      hacim24s: vol24sFormatted,
      dateLabel: 'Today',
      time: nowTime
    };

    return this.addSignal(card);
  }
}

module.exports = new V3VolumeBot();
