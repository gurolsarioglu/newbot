/**
 * history.service.js — 200 Günlük Geçmiş Veri & Kantitatif Analiz Servisi
 * Alpha Terminal
 */

const fs    = require('fs');
const path  = require('path');
const https = require('https');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'daily_history.json');

// RAM Önbelleği
let memoryDb = null;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadDatabase() {
  if (memoryDb) return memoryDb;
  ensureDataDir();

  if (fs.existsSync(DATA_FILE)) {
    try {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      memoryDb = JSON.parse(raw);
      if (!memoryDb.coins) memoryDb.coins = {};
      return memoryDb;
    } catch (err) {
      console.error('[HistoryService] Veritabanı okuma hatası, sıfırlanıyor:', err.message);
    }
  }

  memoryDb = {
    updatedAt: new Date().toISOString(),
    coins: {}
  };
  return memoryDb;
}

function saveDatabase() {
  try {
    ensureDataDir();
    if (!memoryDb) memoryDb = { updatedAt: new Date().toISOString(), coins: {} };
    memoryDb.updatedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(memoryDb, null, 2), 'utf8');
  } catch (err) {
    console.error('[HistoryService] Veritabanı kayıt hatası:', err.message);
  }
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'AlphaTerminal-HistoryEngine/2.0',
        'Accept': 'application/json'
      },
      timeout: 10000
    };

    https.get(url, options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject).on('timeout', function() {
      this.destroy();
      reject(new Error('İstek zaman aşımına uğradı'));
    });
  });
}

/**
 * 200 günlük mum serisinden EMA hesaplar
 * k = 2 / (period + 1)
 */
function calculateEMA(prices, period = 200) {
  if (!prices || prices.length === 0) return 0;
  const k = 2 / (period + 1);

  // Başlangıç için ilk N günün SMA'sı veya ilk fiyat
  const initSlice = prices.slice(0, Math.min(period, prices.length));
  let ema = initSlice.reduce((a, b) => a + b, 0) / initSlice.length;

  for (let i = initSlice.length; i < prices.length; i++) {
    ema = (prices[i] - ema) * k + ema;
  }
  return parseFloat(ema.toFixed(6));
}

/**
 * 200 günlük mum dizisinden zengin finansal metrikler ve seriler üretir
 */
function calculate200dMetrics(rawCandles, symbol) {
  if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
    return null;
  }

  // Binance kline dizisi: [openTime, open, high, low, close, volume, closeTime, ...]
  const parsed = rawCandles.map(c => {
    const o = parseFloat(c[1]);
    const h = parseFloat(c[2]);
    const l = parseFloat(c[3]);
    const cl = parseFloat(c[4]);
    const vol = parseFloat(c[5]);
    const d = new Date(c[0]);
    const dateStr = d.toISOString().slice(0, 10);
    const dayChangePct = o > 0 ? parseFloat((((cl - o) / o) * 100).toFixed(2)) : 0;

    return {
      time: c[0],
      date: dateStr,
      open: o,
      high: h,
      low: l,
      close: cl,
      volume: vol,
      changePct: dayChangePct
    };
  });

  const count = parsed.length;
  const latest = parsed[count - 1];
  const latestClose = latest.close;

  const closes = parsed.map(c => c.close);
  const highs  = parsed.map(c => c.high);
  const lows   = parsed.map(c => c.low);

  // 1. EMA 200
  const ema200 = calculateEMA(closes, 200);
  const ema200DiffPct = ema200 > 0 ? parseFloat((((latestClose - ema200) / ema200) * 100).toFixed(2)) : 0;
  const ema200Status = ema200DiffPct >= 0 ? 'ABOVE' : 'BELOW';

  // 2. 200 Günlük Zirve (ATH) ve Dip (ATL)
  const ath200d = Math.max(...highs);
  const atl200d = Math.min(...lows);
  const athDistancePct = ath200d > 0 ? parseFloat((((latestClose - ath200d) / ath200d) * 100).toFixed(2)) : 0;
  const atlBouncePct   = atl200d > 0 ? parseFloat((((latestClose - atl200d) / atl200d) * 100).toFixed(2)) : 0;

  // 3. Kazanma Oranı (Win Rate / Yeşil Gün Oranı)
  let greenDays = 0;
  let redDays = 0;
  parsed.forEach(c => {
    if (c.close >= c.open) greenDays++;
    else redDays++;
  });
  const winRatePct = count > 0 ? parseFloat(((greenDays / count) * 100).toFixed(1)) : 50;

  // 4. Mevcut Seri (Current Streak - Üst üste yeşil / kırmızı gün sayısı)
  let streakCount = 0;
  let streakType = null; // 'UP' veya 'DOWN'
  for (let i = count - 1; i >= 0; i--) {
    const isUp = parsed[i].close >= parsed[i].open;
    const type = isUp ? 'UP' : 'DOWN';
    if (streakType === null) {
      streakType = type;
      streakCount = 1;
    } else if (streakType === type) {
      streakCount++;
    } else {
      break;
    }
  }

  // 5. Ortalama Günlük Dalgalanma Marjı (Volatilite / Average Daily Range %)
  let totalDailyRange = 0;
  parsed.forEach(c => {
    if (c.low > 0) {
      totalDailyRange += ((c.high - c.low) / c.low) * 100;
    }
  });
  const avgDailyRangePct = count > 0 ? parseFloat((totalDailyRange / count).toFixed(2)) : 0;

  // 6. 7 Günlük ve 30 Günlük Kümülatif Getiri
  let perf7d = 0;
  if (count >= 8) {
    const c7 = parsed[count - 8].close;
    perf7d = c7 > 0 ? parseFloat((((latestClose - c7) / c7) * 100).toFixed(2)) : 0;
  }
  let perf30d = 0;
  if (count >= 31) {
    const c30 = parsed[count - 31].close;
    perf30d = c30 > 0 ? parseFloat((((latestClose - c30) / c30) * 100).toFixed(2)) : 0;
  }

  return {
    symbol,
    latestPrice: latestClose,
    candleCount: count,
    metrics: {
      ema200,
      ema200DiffPct,
      ema200Status,
      ath200d,
      athDistancePct,
      atl200d,
      atlBouncePct,
      greenDays,
      redDays,
      winRatePct,
      currentStreak: {
        count: streakCount,
        type: streakType
      },
      avgDailyRangePct,
      perf7d,
      perf30d
    },
    dailyReturns: parsed.slice(-30) // Son 30 günün detayını hafif JSON için sakla
  };
}

class HistoryService {
  constructor() {
    this.syncLocks = new Set();
  }

  /**
   * Belirli bir coin için 200 günlük geçmişi getirir veya Binance'ten çeker
   * @param {string} symbol - Örn: 'BTCUSDT'
   * @param {boolean} forceRefresh - Önbelleği atlayıp doğrudan taze veri çeker
   */
  async getCoinHistory(symbol, forceRefresh = false) {
    const cleanSymbol = symbol.toUpperCase();
    const db = loadDatabase();
    const existing = db.coins[cleanSymbol];
    const now = Date.now();

    // 1 saatlik (3600000 ms) tazelik eşiği
    if (!forceRefresh && existing && (now - existing.lastSync < 3600000)) {
      return existing;
    }

    if (this.syncLocks.has(cleanSymbol)) {
      // Zaten bir istek devam ediyorsa var olanı dön
      return existing || null;
    }

    try {
      this.syncLocks.add(cleanSymbol);
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${cleanSymbol}&interval=1d&limit=200`;
      const rawCandles = await fetchJson(url);

      if (!Array.isArray(rawCandles) || rawCandles.length === 0) {
        return existing || null;
      }

      const analyzed = calculate200dMetrics(rawCandles, cleanSymbol);
      if (!analyzed) return existing || null;

      const record = {
        ...analyzed,
        lastSync: now
      };

      db.coins[cleanSymbol] = record;
      saveDatabase();
      return record;
    } catch (err) {
      console.warn(`[HistoryService] ${cleanSymbol} 200 günlük veri çekilemedi:`, err.message);
      return existing || null;
    } finally {
      this.syncLocks.delete(cleanSymbol);
    }
  }

  /**
   * Birden fazla favori coin için toplu özet analiz döner
   * @param {string[]} symbols
   */
  async getBatchAnalytics(symbols = []) {
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return {};
    }

    const results = {};
    const promises = symbols.map(async (sym) => {
      const data = await this.getCoinHistory(sym, false);
      if (data) {
        results[sym] = {
          latestPrice: data.latestPrice,
          metrics: data.metrics,
          lastSync: data.lastSync
        };
      }
    });

    await Promise.all(promises);
    return results;
  }

  /**
   * Tüm kayıtlı favori coin verilerini döner
   */
  getAllStored() {
    const db = loadDatabase();
    return db.coins || {};
  }
}

module.exports = new HistoryService();
