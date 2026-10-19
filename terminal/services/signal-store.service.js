/**
 * signal-store.service.js — 60 Günlük Kalıcı Sinyal Arşiv Deposu (Persistence & Retention)
 * Alpha Terminal
 * 
 * Özellikler:
 * - 9 Botun tüm sinyallerini kalıcı olarak `data/signals_history.json` dosyasında saklar.
 * - 60 günden (60 gün * 24s * 3600sn * 1000ms) eski sinyalleri otomatik temizler (retention).
 * - Sembol bazlı anlık arama (örn: SUIUSDT için son 60 günün tüm bot sinyalleri).
 * - Bellekte indeksleme ile mikrosaniye (<1ms) yanıt süresi.
 * - Fiyatların tick hassasiyetini korur.
 */

const fs   = require('fs');
const path = require('path');
const { formatCryptoPrice } = require('./price-formatter');

const DATA_DIR     = process.env.TERMINAL_DATA_DIR || path.join(__dirname, '..', 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'signals_history.json');
const RETENTION_MS = 60 * 24 * 60 * 60 * 1000; // 60 Gün

class SignalStoreService {
  constructor() {
    this.signals = []; // Tüm sinyaller (En yeni ilk)
    this.symbolMap = new Map(); // Symbol -> Array<Signal>
    this.botMap = new Map();    // BotId -> Array<Signal>
    this.idMap = new Map();
    this.saveTimeout = null;
    this.initialized = false;

    this.ensureDataDir();
    this.load();
  }

  ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      } catch (err) {
        console.error('[SignalStore] Data dizini olusturulamadi:', err.message);
      }
    }
  }

  /**
   * Diskten 60 günlük sinyalleri yükler ve indeksler
   */
  load() {
    if (this.initialized) return;

    if (fs.existsSync(HISTORY_FILE)) {
      try {
        const raw = fs.readFileSync(HISTORY_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.signals)) throw new Error('Gecersiz sinyal arsivi');
        const list = parsed.signals;

        // 60 günlük retention filtresi uygula
        const now = Date.now();
        const cutoff = now - RETENTION_MS;
        this.signals = list.filter(s => s && Number.isFinite(Number(s.timestamp)) && Number(s.timestamp) >= cutoff)
          .map(s => ({ ...s, timestamp: Number(s.timestamp) }))
          .sort((a, b) => b.timestamp - a.timestamp);

        // Yeniden indeksle
        this.rebuildIndex();
        console.log(`[SignalStore] ✅ 60 günlük arsiv basariyla yuklendi (${this.signals.length} sinyal hazir).`);
      } catch (err) {
        console.error('[SignalStore] Arsiv okunamadi; mevcut dosya korunuyor:', err.message);
        this.signals = [];
        this.loadError = err;
        this.rebuildIndex();
      }
    } else {
      this.signals = [];
    }

    this.initialized = true;
  }

  /**
   * Sembol ve bot haritalarını bellekte yeniden oluşturur
   */
  rebuildIndex() {
    this.symbolMap.clear();
    this.botMap.clear();
    this.idMap.clear();

    for (const s of this.signals) {
      if (s.id) this.idMap.set(s.id, s);
      const sym = String(s.symbol || '').toUpperCase();
      if (sym) {
        if (!this.symbolMap.has(sym)) this.symbolMap.set(sym, []);
        this.symbolMap.get(sym).push(s);
      }

      const bot = String(s.botId || '').toLowerCase();
      if (bot) {
        if (!this.botMap.has(bot)) this.botMap.set(bot, []);
        this.botMap.get(bot).push(s);
      }
    }
  }

  /**
   * Diske atomik/debounced kaydeder
   */
  scheduleSave() {
    // Sürekli sinyal akışı kaydı sonsuza kadar ertelemesin.
    if (this.saveTimeout) return;
    this.saveTimeout = setTimeout(() => {
      this.saveTimeout = null;
      this.saveSync();
    }, 1000); // 1 saniye debounce
  }

  /**
   * Değişiklikleri anında diske senkron yazar (testler ve temizlik için)
   */
  saveSync() {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = null;
    try {
      if (this.loadError) throw new Error('Sinyal arsivi okunamadi; mevcut dosya korunuyor');
      this.ensureDataDir();
      const cutoff = Date.now() - RETENTION_MS;
      this.signals = this.signals.filter(s => (s.timestamp || 0) >= cutoff);
      this.rebuildIndex();
      const payload = {
        version: '1.0',
        updatedAt: new Date().toISOString(),
        totalSignals: this.signals.length,
        retentionDays: 60,
        signals: this.signals
      };
      const tempFile = `${HISTORY_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tempFile, HISTORY_FILE);
    } catch (err) {
      console.error('[SignalStore] saveSync hatasi:', err.message);
    }
  }

  /**
   * Belirtilen ID'ye sahip sinyali kalıcı depodan siler
   */
  removeSignal(id) {
    const idx = this.signals.findIndex(s => s.id === id);
    if (idx !== -1) {
      this.signals.splice(idx, 1);
      this.rebuildIndex();
      this.saveSync();
      return true;
    }
    return false;
  }

  /**
   * Belirtilen sembole (örn: TESTUSDT) sahip tüm sinyalleri depodan siler
   */
  removeSignalsBySymbol(symbol) {
    const sym = (symbol || '').toUpperCase();
    const before = this.signals.length;
    this.signals = this.signals.filter(s => (s.symbol || '').toUpperCase() !== sym);
    if (this.signals.length !== before) {
      this.rebuildIndex();
      this.saveSync();
      return before - this.signals.length;
    }
    return 0;
  }

  /**
   * Yeni sinyali kalıcı depoya ekler
   */
  recordSignal(botId, signalData, botName = '') {
    if (!signalData) return null;

    const now = Date.now();
    const symbol = (signalData.symbol || signalData.coin || 'UNKNOWN').toUpperCase();
    const cleanBotId = (botId || signalData.botId || 'bot').toLowerCase();

    const timestamp = Number(signalData.timestamp ?? now);
    if (!Number.isFinite(timestamp) || timestamp < now - RETENTION_MS || !Number.isFinite(new Date(timestamp).getTime())) return null;
    const dateObj = new Date(timestamp);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = signalData.time || dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // Fiyat hassasiyetini eksiksiz koru
    const curPriceFormatted = formatCryptoPrice(signalData.currentPrice ?? signalData.price);
    const prevPriceFormatted = formatCryptoPrice(signalData.prevPrice);

    const record = {
      id: signalData.id || `${cleanBotId}_${symbol}_${timestamp}`,
      botId: cleanBotId,
      botName: botName || signalData.botName || cleanBotId.toUpperCase(),
      symbol: symbol,
      timestamp: timestamp,
      isoDate: dateObj.toISOString(),
      dateStr: dateStr,
      dateLabel: signalData.dateLabel ?? dateStr,
      time: timeStr,
      dot: signalData.dot || '🟢',
      strategy: signalData.strategy || '',
      stars: signalData.stars || '',
      isFavorite: signalData.isFavorite ?? false,
      divergence: signalData.divergence ?? null,
      alertText: signalData.alertText ?? null,
      previousFunding: signalData.previousFunding ?? null,
      boostValue: signalData.boostValue ?? signalData.boost ?? '',
      currentPrice: curPriceFormatted,
      prevPrice: prevPriceFormatted,
      rsi: signalData.rsi ?? null,
      srsi: signalData.srsi ?? null,
      wt: signalData.wt ?? null,
      pivot: signalData.pivot ?? null,
      ema200: signalData.ema200 ?? null,
      traderPositioning: signalData.traderPositioning ?? null,
      marketExposure: signalData.marketExposure ?? null,
      stochastic: signalData.stochastic ?? null,
      fundingRate: signalData.fundingRate ?? null,
      difference: signalData.difference ?? null,
      timeRemaining: signalData.timeRemaining ?? null,
      hacimChange: signalData.hacimChange ?? null,
      hacim24s: signalData.hacim24s ?? null,
      btcStatus: signalData.btcStatus ?? null,
      dropValue: signalData.dropValue ?? null,
      volume: signalData.volume ?? null,
      timeframe: signalData.timeframe ?? '',
      candleOpenTime: signalData.candleOpenTime ?? null,
      rawId: signalData.rawId ?? null
    };

    // Aynı id veya 2 saniye içinde aynı bot+symbol sinyalini mükerrer kaydetme
    const duplicate = this.idMap.get(record.id) || (this.symbolMap.get(symbol) || []).find(s =>
      s.botId === cleanBotId && Math.abs(s.timestamp - timestamp) < 2000);
    if (duplicate) return duplicate;

    this.signals.unshift(record);
    this.idMap.set(record.id, record);

    // İndekslere ekle
    if (!this.symbolMap.has(symbol)) this.symbolMap.set(symbol, []);
    this.symbolMap.get(symbol).unshift(record);

    if (!this.botMap.has(cleanBotId)) this.botMap.set(cleanBotId, []);
    this.botMap.get(cleanBotId).unshift(record);

    this.scheduleSave();

    return record;
  }

  /**
   * Belirli bir coin'in (örn: SUIUSDT) son N günlük (varsayılan 60) tüm sinyallerini döner
   */
  getSignalsByCoin(symbol, days = 60) {
    if (!symbol) return [];
    const sym = String(symbol).toUpperCase().trim();
    const list = this.symbolMap.get(sym) || [];

    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return list.filter(s => (s.timestamp || 0) >= cutoff);
  }

  /**
   * Belirli bir coin için 60 günlük özet istatistik döner
   */
  getStatsByCoin(symbol, days = 60) {
    const list = this.getSignalsByCoin(symbol, days);
    if (!list.length) {
      return {
        symbol: symbol.toUpperCase(),
        count: 0,
        days: days,
        firstSignal: null,
        lastSignal: null,
        botDistribution: {}
      };
    }

    const botDistribution = {};
    list.forEach(s => {
      const b = s.botName || s.botId;
      botDistribution[b] = (botDistribution[b] || 0) + 1;
    });

    return {
      symbol: symbol.toUpperCase(),
      count: list.length,
      days: days,
      firstSignal: list[list.length - 1].dateStr,
      lastSignal: list[0].dateStr,
      botDistribution
    };
  }

  /**
   * Belirli bir botun en son N adet sinyalini döner (Açılışta belleği doldurmak için)
   */
  getRecentSignalsByBot(botId, limit = 50) {
    const cleanId = (botId || '').toLowerCase().trim();
    const list = this.botMap.get(cleanId) || [];
    return list.slice(0, limit);
  }

  /**
   * Tüm kayıtlı sinyallerin sayısını döner
   */
  getTotalCount() {
    return this.signals.length;
  }
}

module.exports = new SignalStoreService();
