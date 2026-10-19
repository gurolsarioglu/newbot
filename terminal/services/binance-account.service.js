/**
 * binance-account.service.js — Binance Futures Sadece Okuma (Read-Only) Hesap Servisi
 * 
 * Güvenlik İlkesi:
 * - Yalnızca "Can Read" (Sadece Okuma) yetkisine sahip Binance API anahtarlarıyla çalışır.
 * - Alım-satım (Trading) veya Para Çekme (Withdrawal) yetkisi İSTEMEZ ve KULLANMAZ.
 * - Kullanıcının Binance Vadeli İşlemler (Futures) hesabındaki:
 *   1. Açık pozisyonları (Open Positions) anlık okur.
 *   2. Kapanan işlemlerin gerçekleşen kâr/zararını (REALIZED_PNL Income) tespit edip Kasa Defteri'ne otomatik işler.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ledgerService = require('./treasury-ledger.service');

const CONFIG_FILE = path.join(process.env.TERMINAL_DATA_DIR || path.join(__dirname, '..', 'data'), 'binance_api_config.json');
const BASE_URL = 'fapi.binance.com';

class BinanceAccountService {
  constructor() {
    this.apiKey = '';
    this.apiSecret = '';
    this.autoSync = true;
    this.syncIntervalSec = 15;
    this.lastSyncTime = null;
    this.lastSyncResult = null;
    this.syncTimer = null;
    this.initialSyncTimer = null;
    this.openPositionsCache = [];
    this.isSyncing = false;

    this._loadConfig();
    this.startAutoSync();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(CONFIG_FILE)) {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        const data = JSON.parse(raw);
        this.apiKey = (data.apiKey || '').trim();
        this.apiSecret = (data.apiSecret || '').trim();
        this.autoSync = data.autoSync !== false;
        this.syncIntervalSec = parseInt(data.syncIntervalSec, 10) || 15;
        this.lastSyncTime = data.lastSyncTime || null;
      }
    } catch (e) {
      console.warn('[BinanceAccountService] Config yuklenirken hata:', e.message);
    }
  }

  _saveConfig() {
    try {
      // Gerçek secret sadece yerel dosyaya kaydedilir
      const secureData = {
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        autoSync: this.autoSync,
        syncIntervalSec: this.syncIntervalSec,
        lastSyncTime: this.lastSyncTime
      };
      fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
      const tempFile = `${CONFIG_FILE}.tmp`;
      fs.writeFileSync(tempFile, JSON.stringify(secureData, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempFile, CONFIG_FILE);
    } catch (e) {
      console.error('[BinanceAccountService] Config kaydetme hatasi:', e.message);
      throw e;
    }
  }

  setCredentials(apiKey, apiSecret, autoSync = true) {
    const providedKey = String(apiKey || '').trim();
    const nextKey = providedKey === this.getStatus().apiKeyMasked ? this.apiKey : providedKey;
    if (nextKey !== this.apiKey) {
      this.apiSecret = '';
      this.lastSyncTime = null;
      this.openPositionsCache = [];
    }
    this.apiKey = nextKey;
    if (apiSecret && apiSecret !== '***') {
      this.apiSecret = String(apiSecret || '').trim();
    }
    this.autoSync = Boolean(autoSync);
    this._saveConfig();
    this.startAutoSync();
    return this.testConnection();
  }

  isConnected() {
    return Boolean(this.apiKey && this.apiSecret);
  }

  // Binance İmzalı İstek Yardımcısı (HMAC-SHA256)
  _signedRequest(endpoint, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        return reject(new Error('Binance API Key ve Secret tanimli degil'));
      }

      const timestamp = Date.now();
      const queryObj = { ...params, timestamp, recvWindow: 5000 };
      
      const queryString = Object.keys(queryObj)
        .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(queryObj[k])}`)
        .join('&');

      const signature = crypto
        .createHmac('sha256', this.apiSecret)
        .update(queryString)
        .digest('hex');

      const fullPath = `${endpoint}?${queryString}&signature=${signature}`;

      const options = {
        hostname: BASE_URL,
        port: 443,
        path: fullPath,
        method: 'GET',
        headers: {
          'X-MBX-APIKEY': this.apiKey,
          'User-Agent': 'AlphaTerminal/2.0-ReadOnly',
          'Content-Type': 'application/json'
        },
        timeout: 8000
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.msg || `Binance HTTP ${res.statusCode}`));
            }
          } catch (e) {
            reject(new Error('Gecersiz JSON yaniti'));
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Binance API istek zaman asimi (timeout)'));
      });

      req.end();
    });
  }

  // Bağlantıyı Test Etme
  async testConnection() {
    if (!this.isConnected()) {
      return { success: false, connected: false, message: 'API bilgileri girilmedi' };
    }

    try {
      const account = await this._signedRequest('/fapi/v2/account');
      const totalBalance = parseFloat(account.totalWalletBalance || 0);
      const availableBalance = parseFloat(account.availableBalance || 0);
      
      return {
        success: true,
        connected: true,
        canRead: true,
        canTrade: typeof account.canTrade === 'boolean' ? account.canTrade : null,
        usesTradingEndpoints: false,
        totalWalletBalance: totalBalance,
        availableBalance,
        message: 'Binance Vadeli Sadece Okuma (Read-Only) baglantisi basarili'
      };
    } catch (err) {
      console.warn('[BinanceAccountService] Test baglanti hatasi:', err.message);
      return {
        success: false,
        connected: false,
        error: err.message,
        message: 'Binance baglanti hatasi: ' + err.message
      };
    }
  }

  // 1. Gerçek Binance Vadeli Açık Pozisyonları Oku
  async getOpenPositions() {
    if (!this.isConnected()) return [];

    try {
      const positions = await this._signedRequest('/fapi/v2/positionRisk');
      if (!Array.isArray(positions)) return [];

      const active = positions.filter(p => {
        const amt = parseFloat(p.positionAmt || 0);
        return Number.isFinite(amt) && amt !== 0;
      }).map(p => {
        const amt = parseFloat(p.positionAmt);
        const side = amt > 0 ? 'LONG' : 'SHORT';
        const entryPrice = parseFloat(p.entryPrice || 0);
        const markPrice = parseFloat(p.markPrice || entryPrice);
        const uPnl = parseFloat(p.unRealizedProfit || 0);
        const notional = Math.abs(amt * markPrice);
        const leverage = parseInt(p.leverage || 5, 10);
        const margin = leverage > 0 ? notional / leverage : notional;
        const liqPrice = parseFloat(p.liquidationPrice || 0);
        
        let liqDistancePct = 0;
        if (liqPrice > 0 && markPrice > 0) {
          liqDistancePct = side === 'LONG' 
            ? ((markPrice - liqPrice) / markPrice) * 100 
            : ((liqPrice - markPrice) / markPrice) * 100;
        }

        return {
          symbol: p.symbol,
          coin: p.symbol.replace('USDT', ''),
          side,
          amount: Math.abs(amt),
          entryPrice,
          markPrice,
          unRealizedProfit: uPnl,
          margin: +margin.toFixed(2),
          leverage,
          liqPrice,
          liqDistancePct: +liqDistancePct.toFixed(1),
          source: 'binance_live'
        };
      });

      this.openPositionsCache = active;
      return active;
    } catch (err) {
      console.warn('[BinanceAccountService] Acik pozisyonlar okunamadi:', err.message);
      return this.openPositionsCache;
    }
  }

  // 2. Kapanan İşlemleri ve Gerçekleşen Kâr/Zararları Oku (REALIZED_PNL)
  async getRealizedPnlHistory(limit = 1000, params = {}, strict = false) {
    if (!this.isConnected()) return [];
    try {
      const income = await this._signedRequest('/fapi/v1/income', {
        incomeType: 'REALIZED_PNL',
        ...params,
        limit: Math.min(1000, Math.max(1, limit))
      });
      if (!Array.isArray(income)) throw new Error('Gecersiz Binance gelir gecmisi');
      return income;
    } catch (err) {
      console.warn('[BinanceAccountService] Realized PnL okunamadi:', err.message);
      if (strict) throw err;
      return [];
    }
  }

  // 3. Otomatik Kasa Defteri Senkronizasyonu
  async syncClosedTradesToLedger() {
    if (!this.isConnected()) return { success: false, error: 'API bilgileri girilmedi', syncedCount: 0 };
    if (this.isSyncing) return { success: true, syncing: true, syncedCount: 0 };
    this.isSyncing = true;

    try {
      const endTime = Date.now();
      const startTime = this.lastSyncTime ? Math.max(0, Number(this.lastSyncTime) - 60000) : endTime - 7 * 86400000;
      const incomeList = [];
      for (let page = 1; ; page++) {
        const batch = await this.getRealizedPnlHistory(1000, { startTime, endTime, page }, true);
        incomeList.push(...batch);
        if (batch.length < 1000) break;
        if (page >= 100) throw new Error('Binance gelir gecmisi sayfalama sinirina ulasti; senkronizasyon tamamlanmadi');
      }

      // Mevcut defterdeki tranId kayıtlarını al
      const existingTrades = ledgerService.trades;
      const existingTranIds = new Set(
        existingTrades.map(t => String(t.binanceTranId || '')).filter(Boolean)
      );

      const additions = [];

      // Eskiden yeniye doğru sırala
      incomeList.sort((a, b) => (a.time || 0) - (b.time || 0));

      for (const item of incomeList) {
        const tranId = String(item.tranId || item.tradeId || '');
        if (!tranId || existingTranIds.has(tranId)) {
          continue; // Zaten defterde var
        }

        // Kasa USDT cinsindedir; farklı varlığı dolar gibi toplama.
        if (item.asset !== 'USDT') continue;
        const profitUsd = Number(item.income);
        if (!Number.isFinite(profitUsd) || profitUsd === 0) continue;

        const sym = (item.symbol || 'COIN').toUpperCase();
        const coinName = sym.replace('USDT', '');
        const dateObj = new Date(parseInt(item.time, 10) || Date.now());

        const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        // REALIZED_PNL pozisyon yönünü içermez; kazanç/zarar yön kanıtı değildir.
        const side = '—';

        additions.push({
          id: `binance_${tranId}`,
          coin: coinName,
          symbol: sym,
          date: dateStr,
          time: timeStr,
          side,
          profitUsd: +profitUsd.toFixed(2),
          notes: 'Binance Otomatik Senkronizasyon',
          source: 'binance',
          binanceTranId: tranId,
          timestamp: item.time
        });

        existingTranIds.add(tranId);
      }

      const newlyAdded = ledgerService.addTrades(additions);
      this.lastSyncTime = endTime;
      this.lastSyncResult = { success: true, newlyAdded };
      this._saveConfig();

      if (newlyAdded > 0) {
        console.log(`[BinanceAccountService] Kasa Defterine ${newlyAdded} yeni Binance islemi eklendi!`);
      }

      this.isSyncing = false;
      return { success: true, syncedCount: newlyAdded };
    } catch (err) {
      this.isSyncing = false;
      console.error('[BinanceAccountService] Senkronizasyon hatasi:', err.message);
      this.lastSyncResult = { success: false, error: err.message };
      return { success: false, error: err.message, syncedCount: 0 };
    }
  }

  // Otomatik Periyodik Senkronizasyon Döngüsü
  startAutoSync() {
    if (this.initialSyncTimer) {
      clearTimeout(this.initialSyncTimer);
      this.initialSyncTimer = null;
    }
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (!this.autoSync || !this.isConnected()) return;

    // İlk çalıştırmada hemen 3 saniye sonra kontrol et
    this.initialSyncTimer = setTimeout(() => {
      this.initialSyncTimer = null;
      if (!this.autoSync || !this.isConnected()) return;
      this.syncClosedTradesToLedger();
    }, 3000);
    if (this.initialSyncTimer.unref) this.initialSyncTimer.unref();

    // Belirlenen aralıkta (varsayılan 15 sn) arka planda otomatik oku
    const intervalMs = Math.max(10, this.syncIntervalSec) * 1000;
    this.syncTimer = setInterval(() => {
      this.syncClosedTradesToLedger();
    }, intervalMs);
    if (this.syncTimer.unref) this.syncTimer.unref();

    console.log(`[BinanceAccountService] Otomatik okuma baslatildi (Her ${this.syncIntervalSec} saniyede bir).`);
  }

  getStatus() {
    return {
      configured: this.isConnected(),
      apiKeyMasked: this.apiKey ? `${this.apiKey.substring(0, 6)}...${this.apiKey.slice(-4)}` : null,
      autoSync: this.autoSync,
      syncIntervalSec: this.syncIntervalSec,
      lastSyncTime: this.lastSyncTime,
      lastSyncResult: this.lastSyncResult,
      readOnlySafe: true // Asla emir vermez veya çekim yapmaz
    };
  }
}

module.exports = new BinanceAccountService();
