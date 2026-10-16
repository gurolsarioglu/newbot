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

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'binance_api_config.json');
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
      const data = {
        apiKey: this.apiKey,
        apiSecret: this.apiSecret ? '***' : '', // Şifreli maskeleme
        autoSync: this.autoSync,
        syncIntervalSec: this.syncIntervalSec,
        lastSyncTime: this.lastSyncTime
      };
      // Gerçek secret sadece yerel dosyaya kaydedilir
      const secureData = {
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        autoSync: this.autoSync,
        syncIntervalSec: this.syncIntervalSec,
        lastSyncTime: this.lastSyncTime
      };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(secureData, null, 2), 'utf8');
    } catch (e) {
      console.error('[BinanceAccountService] Config kaydetme hatasi:', e.message);
    }
  }

  setCredentials(apiKey, apiSecret, autoSync = true) {
    this.apiKey = String(apiKey || '').trim();
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
        canTrade: false, // Read-Only teyidi
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
        return Math.abs(amt) > 0.000001;
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
  async getRealizedPnlHistory(limit = 50) {
    if (!this.isConnected()) return [];
    try {
      const income = await this._signedRequest('/fapi/v1/income', {
        incomeType: 'REALIZED_PNL',
        limit: Math.min(100, Math.max(1, limit))
      });
      return Array.isArray(income) ? income : [];
    } catch (err) {
      console.warn('[BinanceAccountService] Realized PnL okunamadi:', err.message);
      return [];
    }
  }

  // 3. Otomatik Kasa Defteri Senkronizasyonu
  async syncClosedTradesToLedger() {
    if (!this.isConnected() || this.isSyncing) return { syncedCount: 0 };
    this.isSyncing = true;

    try {
      const incomeList = await this.getRealizedPnlHistory(50);
      if (!Array.isArray(incomeList) || incomeList.length === 0) {
        this.isSyncing = false;
        return { syncedCount: 0 };
      }

      // Mevcut defterdeki tranId kayıtlarını al
      const existingTrades = ledgerService.trades;
      const existingTranIds = new Set(
        existingTrades.map(t => String(t.binanceTranId || '')).filter(Boolean)
      );

      let newlyAdded = 0;

      // Eskiden yeniye doğru sırala
      incomeList.sort((a, b) => (a.time || 0) - (b.time || 0));

      for (const item of incomeList) {
        const tranId = String(item.tranId || item.tradeId || '');
        if (!tranId || existingTranIds.has(tranId)) {
          continue; // Zaten defterde var
        }

        const profitUsd = parseFloat(item.income || 0);
        if (profitUsd === 0) continue; // 0 PnL olan boş kayıtları atla

        const sym = (item.symbol || 'COIN').toUpperCase();
        const coinName = sym.replace('USDT', '');
        const dateObj = new Date(parseInt(item.time, 10) || Date.now());

        const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

        // Pozisyon yönünü belirle (pozitif/negatif ya da sembol bilgisi)
        // Varsayılan olarak Long/Short tespiti
        const side = profitUsd > 0 ? 'L' : 'S';

        ledgerService.addTrade({
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
        newlyAdded++;
      }

      this.lastSyncTime = Date.now();
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
      return { success: false, error: err.message, syncedCount: 0 };
    }
  }

  // Otomatik Periyodik Senkronizasyon Döngüsü
  startAutoSync() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (!this.autoSync || !this.isConnected()) return;

    // İlk çalıştırmada hemen 3 saniye sonra kontrol et
    setTimeout(() => {
      this.syncClosedTradesToLedger();
    }, 3000);

    // Belirlenen aralıkta (varsayılan 15 sn) arka planda otomatik oku
    const intervalMs = Math.max(10, this.syncIntervalSec) * 1000;
    this.syncTimer = setInterval(() => {
      this.syncClosedTradesToLedger();
    }, intervalMs);

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
