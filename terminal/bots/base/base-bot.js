/**
 * base-bot.js — Alpha Terminal Bot Taban Sınıfı (Model Layer)
 * 
 * Tüm botlar bu sınıftan türeyerek kendi bağımsız sinyal havuzunu, stratejisini
 * ve 60 günlük kalıcı arşiv deposunu yönetir.
 * 
 * Kesin Quant Standartları:
 * - Sahte tohumlama (initialSignals) tamamen kaldırılmıştır.
 * - Cooldown ve Mum Zamanı Tekilleştirme (Deduplication) ile mükerrer kart üretimi engellenir.
 */

const signalStoreService = require('../../services/signal-store.service');

class BaseBot {
  constructor(options = {}) {
    this.id = (options.id || 'base_bot').toLowerCase();
    this.name = options.name || 'Base Bot';
    this.description = options.description || '';
    this.maxSignals = options.maxSignals || 50;

    // Tekilleştirme ve Cooldown Takipçileri
    this.lastEmitMap = new Map(); // symbol -> timestamp
    this.seenCandles = new Set(); // "${symbol}_${timeframe}_${candleOpenTime}"

    // Kalıcı arşivden yalnızca gerçek sinyalleri çek (asla sahte tohumlama yapma)
    const savedSignals = signalStoreService.getRecentSignalsByBot(this.id, this.maxSignals);
    if (savedSignals && savedSignals.length > 0) {
      this.signals = [...savedSignals];
    } else {
      this.signals = [];
    }
  }

  /**
   * Cooldown ve Mum Bazlı Tekilleştirme Kontrolü
   * @param {string} symbol Sembol adı
   * @param {string} timeframe Zaman dilimi (1m, 5m, 1h vb.)
   * @param {number} candleOpenTime Mum açılış zaman damgası
   * @param {number} cooldownMs Bekleme süresi milisaniye (örn: 180000 -> 3 dk)
   * @returns {boolean} Sinyal üretilebilir mi?
   */
  canEmitSignal(symbol, timeframe = '', candleOpenTime = null, cooldownMs = 0) {
    if (!symbol) return false;
    const cleanSym = String(symbol).toUpperCase().trim();
    const now = Date.now();

    // 1. Aynı mum açılış zamanı kontrolü
    if (candleOpenTime) {
      const candleKey = `${this.id}_${cleanSym}_${timeframe}_${candleOpenTime}`;
      if (this.seenCandles.has(candleKey)) {
        return false;
      }
    }

    // 2. Cooldown kontrolü
    if (cooldownMs > 0) {
      const last = this.lastEmitMap.get(cleanSym) || 0;
      if (now - last < cooldownMs) {
        return false;
      }
    }

    return true;
  }

  /**
   * Botun tüm sinyallerini döner
   */
  getSignals() {
    return this.signals;
  }

  /**
   * Sinyal sayısını döner
   */
  getCount() {
    return this.signals.length;
  }

  /**
   * Yeni sinyali doğrular, tekilleştirir, listenin en başına ekler (LIFO)
   * ve anında 60 günlük kalıcı depoya (data/signals_history.json) kaydeder.
   */
  addSignal(signal) {
    if (!signal) return null;

    const sym = (signal.symbol || signal.coin || 'UNKNOWN').toUpperCase();
    const tf = signal.timeframe || '';
    const candleTime = signal.candleOpenTime || null;

    // Mum Bazlı Tekilleştirme Kontrolü
    if (candleTime) {
      const candleKey = `${this.id}_${sym}_${tf}_${candleTime}`;
      if (this.seenCandles.has(candleKey)) {
        return null; // Mükerrer sinyal reddedildi
      }
      this.seenCandles.add(candleKey);

      // Bellek koruması (Maksimum 5000 anahtar)
      if (this.seenCandles.size > 5000) {
        const first = this.seenCandles.values().next().value;
        this.seenCandles.delete(first);
      }
    }

    // Cooldown zamanını kaydet
    const now = Date.now();
    this.lastEmitMap.set(sym, now);

    const dateObj = new Date(signal.timestamp || now);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const formatted = {
      id: signal.id || `${this.id}_${now}_${Math.floor(Math.random() * 1000)}`,
      timestamp: signal.timestamp || now,
      isoDate: signal.isoDate || dateObj.toISOString(),
      dateStr: signal.dateStr || dateStr,
      symbol: sym,
      dateLabel: signal.dateLabel || dateStr,
      time: signal.time || nowTime,
      ...signal
    };

    if (!formatted.dateStr) formatted.dateStr = dateStr;
    if (!formatted.time) formatted.time = nowTime;
    if (!formatted.timestamp) formatted.timestamp = now;

    // 1. Bellek havuzuna ekle
    this.signals.unshift(formatted);
    if (this.signals.length > this.maxSignals) {
      this.signals.pop();
    }

    // 2. 60 Günlük kalıcı arşiv deposuna yaz
    signalStoreService.recordSignal(this.id, formatted, this.name);

    return formatted;
  }

  /**
   * Sinyalleri filtreler
   */
  filter(predicate) {
    return this.signals.filter(predicate);
  }

  /**
   * Sinyal listesini temizler
   */
  clear() {
    this.signals = [];
  }
}

module.exports = BaseBot;
