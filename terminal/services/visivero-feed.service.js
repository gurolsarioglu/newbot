/**
 * visivero-feed.service.js — Visivero Canlı Bot WebSocket ve Arşiv Köprüsü
 * 
 * Visivero'nun wss://bots.visivero.com/ws canlı bot soketine ve
 * https://terminal.visivero.com/api/bot-messages arşiv endpoint'ine bağlanır.
 * 
 * Özellikler:
 * - 700+ Coin için anlık M1-A, M1-Premium, Hammer Pro, Hammer Pro+, 4S, Div, V3, FR sinyallerini yakalar.
 * - Başlangıçta son 50 sinyali REST ile tohumlar (Cold-start zero latency).
 * - Canlı soket üzerinden milisaniye gecikmeyle kesintisiz sinyal akışı sağlar.
 * - Otomatik yeniden bağlanma (Exponential Backoff) ve Heartbeat koruması.
 */

const WebSocket = require('ws');
const https = require('https');

class VisiveroFeedService {
  constructor() {
    this.wsUrl = 'wss://bots.visivero.com/ws';
    this.apiUrl = 'https://terminal.visivero.com/api/bot-messages';
    this.ws = null;
    this.isRunning = false;
    this.reconnectAttempts = 0;
    this.onSignalCallback = null;
    this.lastReceivedTs = 0;
    this.receivedCount = 0;
    this.pingInterval = null;
  }

  start(onSignal) {
    if (this.isRunning) return;
    this.isRunning = true;
    this.onSignalCallback = onSignal;

    console.log('[VisiveroFeed] Canli Visivero Akis Servisi baslatiliyor...');

    // 1. Başlangıçta en son sinyalleri tohumla (Warm-up)
    this.seedRecentSignals();

    // 2. Canlı WebSocket akışını aç
    this._connect();
  }

  async seedRecentSignals() {
    const targetBots = [
      'm1',
      'm1-premium',
      'hammer-pro',
      'hammer-pro-plus',
      'divergence',
      'v3',
      '4s',
      'funding-rate'
    ];

    console.log('[VisiveroFeed] Gecmis canli sinyal tohumlamasi baslatiliyor (8 bot)...');

    for (const botId of targetBots) {
      try {
        const data = await this._fetchBotMessages(botId, 30);
        if (data && Array.isArray(data.messages)) {
          // Kronolojik sıraya koy (en eski ilk, en yeni son)
          const sorted = [...data.messages].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          let count = 0;
          for (const raw of sorted) {
            const parsed = this.parseMessage(raw);
            if (parsed && this.onSignalCallback) {
              this.onSignalCallback(parsed);
              count++;
            }
          }
          if (count > 0) {
            console.log(`[VisiveroFeed] ✅ [${botId}] icin ${count} canli sinyal onceden yuklendi.`);
          }
        }
      } catch (err) {
        console.warn(`[VisiveroFeed] ${botId} tohumlama hatasi:`, err.message);
      }
    }
  }

  _fetchBotMessages(botId, limit = 30) {
    return new Promise((resolve, reject) => {
      const url = `${this.apiUrl}?bot_id=${botId}&page=1&limit=${limit}`;
      const options = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AlphaTerminal/2.0',
          'Accept': 'application/json'
        },
        timeout: 8000
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) {
          return resolve(null);
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            resolve(null);
          }
        });
      }).on('error', () => resolve(null)).on('timeout', () => resolve(null));
    });
  }

  _connect() {
    if (!this.isRunning) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        console.log('[VisiveroFeed] ✅ Canli bot WebSocket baglantisi kuruldu (wss://bots.visivero.com/ws)');
        this.reconnectAttempts = 0;

        // Heartbeat ping döngüsü
        if (this.pingInterval) clearInterval(this.pingInterval);
        this.pingInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.ping();
          }
        }, 25000);
      });

      this.ws.on('message', (data) => {
        try {
          const raw = JSON.parse(data.toString());
          this.lastReceivedTs = Date.now();
          this.receivedCount++;
          const parsed = this.parseMessage(raw);
          if (parsed && this.onSignalCallback) {
            this.onSignalCallback(parsed);
          }
        } catch (e) {}
      });

      this.ws.on('error', (err) => {
        console.warn('[VisiveroFeed] WS Hatasi:', err.message);
      });

      this.ws.on('close', () => {
        if (this.pingInterval) clearInterval(this.pingInterval);
        if (!this.isRunning) return;
        const delay = Math.min(20000, 1000 * Math.pow(1.5, this.reconnectAttempts++));
        console.log(`[VisiveroFeed] WS baglantisi kapandi. ${Math.round(delay)}ms sonra yeniden baglanilacak...`);
        setTimeout(() => this._connect(), delay);
      });
    } catch (err) {
      console.error('[VisiveroFeed] Baglanti acilamadi:', err.message);
      setTimeout(() => this._connect(), 5000);
    }
  }

  parseMessage(raw) {
    if (!raw || !raw.message) return null;
    const text = raw.message;
    const botId = (raw.botId || '').toLowerCase();

    const symMatch = text.match(/#([A-Z0-9]+)/);
    const rawSym = symMatch ? symMatch[1] : (raw.symbol || '').toUpperCase();
    if (!rawSym) return null;

    // Normalleştirilmiş sembol (Örn: BTCUSDT)
    const symbol = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;

    const dropMatch = text.match(/Drop Value:\s*([+\-]?[0-9.]+%?)/i);
    const boostMatch = text.match(/Boost Value:\s*([+\-]?[0-9.]+%?)/i);
    const curMatch = text.match(/Current Price:\s*([0-9.]+)/i);
    const prevMatch = text.match(/Previous Price:\s*([0-9.]+)/i);
    const volMatch = text.match(/Volume:\s*([+\-]?[0-9.]+%?)/i);
    const rsiMatch = text.match(/RSI:\s*(?:<b>)?([^<\n]+)/i);
    const srsiMatch = text.match(/SRSI:\s*(?:<b>)?([^<\n]+)/i);
    const stochMatch = text.match(/Stochastic(?:\s*\(K\/D\))?:\s*(?:<b>)?([^<\n]+)/i);
    const wtMatch = text.match(/WT:\s*(?:<b>)?([^<\n]+)/i);
    const pivotMatch = text.match(/Pivot:\s*([^\n]+)/i);
    const stratMatch = text.match(/Strategy:\s*([^\n]+)/i);
    const tpMatch = text.match(/Trader Positioning:\s*([^\n]+)/i);
    const meMatch = text.match(/Market Exposure:\s*([^\n]+)/i);
    const btcMatch = text.match(/BTC Status:\s*([^\n]+)/i);
    const hacimMatch = text.match(/Hacim:\s*([+\-]?[0-9.,]+%?)/i);
    const hacim24Match = text.match(/24s Hacim:\s*([^\n]+)/i);
    const frMatch = text.match(/Funding Rate:\s*([+\-]?[0-9.]+%?)/i);

    const ts = raw.createdAt ? new Date(raw.createdAt).getTime() : Date.now();
    const dateObj = new Date(isNaN(ts) ? Date.now() : ts);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // RSI format ayrıştırma (Örn: "1m.24❗️ | 5m.15❗️ | 1h.24❗️")
    let rsi1m = null, rsi5m = null, rsi1h = null;
    if (rsiMatch) {
      const rText = rsiMatch[1];
      const m1R = rText.match(/1m\.(\d+)/);
      const m5R = rText.match(/5m\.(\d+)/);
      const h1R = rText.match(/1h\.(\d+)/);
      if (m1R) rsi1m = parseInt(m1R[1], 10);
      if (m5R) rsi5m = parseInt(m5R[1], 10);
      if (h1R) rsi1h = parseInt(h1R[1], 10);
    }

    // SRSI format ayrıştırma (Örn: "1m.15 | 5m.1❗️ | 1h.0❗️")
    let srsi1m = null, srsi5m = null, srsi1h = null;
    if (srsiMatch) {
      const sText = srsiMatch[1];
      const m1S = sText.match(/1m\.(\d+)/);
      const m5S = sText.match(/5m\.(\d+)/);
      const h1S = sText.match(/1h\.(\d+)/);
      if (m1S) srsi1m = parseInt(m1S[1], 10);
      if (m5S) srsi5m = parseInt(m5S[1], 10);
      if (h1S) srsi1h = parseInt(h1S[1], 10);
    }

    const hasDrop = Boolean(dropMatch || text.includes('Drop Value:') || (text.includes('🔴') && !boostMatch));
    const hasBoost = Boolean(boostMatch || text.includes('Boost Value:') || text.includes('🟢'));

    return {
      rawId: raw.id || `ext_${ts}_${Math.floor(Math.random()*1000)}`,
      botId,
      symbol,
      coin: symbol,
      exchange: raw.exchange || 'binance',
      marketType: raw.marketType || 'futures',
      price: curMatch ? curMatch[1] : (raw.price || ''),
      prevPrice: prevMatch ? prevMatch[1] : '',
      dropValue: dropMatch ? dropMatch[1] : '',
      boostValue: boostMatch ? boostMatch[1] : '',
      drop: dropMatch ? dropMatch[1] : '',
      boost: boostMatch ? boostMatch[1] : '',
      volume: volMatch ? volMatch[1] : '',
      rsi: rsiMatch ? rsiMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      srsi: srsiMatch ? srsiMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      rsi1m,
      rsi5m,
      rsi1h,
      srsi1m,
      srsi5m,
      srsi1h,
      stochastic: stochMatch ? stochMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      wt: wtMatch ? wtMatch[1].replace(/<[^>]+>/g, '').trim() : '',
      pivot: pivotMatch ? pivotMatch[1].trim() : '',
      strategy: stratMatch ? stratMatch[1].trim() : '',
      traderPositioning: tpMatch ? tpMatch[1].trim() : '',
      marketExposure: meMatch ? meMatch[1].trim() : '',
      btcStatus: btcMatch ? btcMatch[1].trim() : 'Normal',
      hacimChange: hacimMatch ? hacimMatch[1].trim() : '',
      hacim24s: hacim24Match ? hacim24Match[1].trim() : '',
      fundingRate: frMatch ? frMatch[1] : '',
      hasDrop,
      hasBoost,
      dot: text.includes('🔴') ? '🔴' : (text.includes('🟢') ? '🟢' : '⚪'),
      time: timeStr,
      dateLabel: dateStr,
      dateStr,
      timestamp: isNaN(ts) ? Date.now() : ts,
      isoDate: dateObj.toISOString()
    };
  }

  stop() {
    this.isRunning = false;
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.ws) {
      try { this.ws.close(); } catch (e) {}
    }
  }
}

module.exports = new VisiveroFeedService();
