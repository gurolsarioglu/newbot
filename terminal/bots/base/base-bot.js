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
const { randomUUID } = require('node:crypto');

class BaseBot {
  constructor(options = {}) {
    this.id = (options.id || 'base_bot').toLowerCase();
    this.name = options.name || 'Base Bot';
    this.description = options.description || '';
    this.maxSignals = Number.isInteger(options.maxSignals) && options.maxSignals > 0 ? options.maxSignals : 100;

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
    // Yeniden başlatma aynı arşivlenmiş mumun tekrar yayınlanmasına izin vermemeli.
    for (const signal of this.signals) {
      for (const key of this.signalKeys(signal)) this.seenCandles.add(key);
      const symbol = String(signal.symbol || signal.coin || '').trim().toUpperCase();
      const timestamp = Number(signal.timestamp);
      if (symbol && Number.isFinite(timestamp)) {
        this.lastEmitMap.set(symbol, Math.max(this.lastEmitMap.get(symbol) || 0, Math.min(Date.now(), timestamp)));
      }
    }
  }

  signalKeys(signal) {
    const symbol = String(signal.symbol || signal.coin || '').trim().toUpperCase();
    const keys = [];
    if (signal.id) keys.push(`${this.id}_id_${signal.id}`);
    if (signal.rawId !== undefined && signal.rawId !== null && signal.rawId !== '') keys.push(`${this.id}_raw_${signal.rawId}`);
    if (signal.candleOpenTime !== undefined && signal.candleOpenTime !== null) {
      keys.push(`${this.id}_${symbol}_${signal.timeframe || ''}_${signal.candleOpenTime}`);
    }
    return keys;
  }

  parseMetric(value, min = -Infinity, max = Infinity) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.').replace(/[%\s]/g, ''));
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
  }

  formatMetric(value, alarm = false) {
    return value === null || !Number.isFinite(value) ? '—' : `${value}${alarm ? ' ❗' : ''}`;
  }

  signalMetadata(source) {
    const metadata = {};
    for (const key of ['id', 'rawId', 'timeframe', 'candleOpenTime', 'timestamp', 'isoDate', 'dateStr', 'dateLabel', 'time']) {
      if (source[key] !== undefined && source[key] !== null) metadata[key] = source[key];
    }
    return metadata;
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
    if (candleOpenTime !== undefined && candleOpenTime !== null) {
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
    if (!signal || typeof signal !== 'object') return null;

    const sym = String(signal.symbol || signal.coin || '').trim().toUpperCase();
    if (!sym) return null;
    const now = Date.now();
    const timestamp = signal.timestamp === undefined || signal.timestamp === null ? now : Number(signal.timestamp);
    if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) return null;

    // Mum Bazlı veya Mesaj Kimliği Bazlı Tekilleştirme Kontrolü
    const signalKeys = this.signalKeys({ ...signal, symbol: sym });
    if (signalKeys.some(key => this.seenCandles.has(key))) return null;
    for (const signalKey of signalKeys) {
      this.seenCandles.add(signalKey);

      // Bellek koruması (Maksimum 5000 anahtar)
      if (this.seenCandles.size > 5000) {
        const first = this.seenCandles.values().next().value;
        this.seenCandles.delete(first);
      }
    }

    // Cooldown zamanını kaydet
    this.lastEmitMap.set(sym, now);

    const dateObj = new Date(timestamp);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
    const formatted = {
      ...signal,
      id: signal.id || `${this.id}_${randomUUID()}`,
      dateLabel: signal.dateLabel || dateStr,
      symbol: sym,
      timestamp,
      isoDate: dateObj.toISOString(),
      dateStr,
      time: nowTime
    };

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
