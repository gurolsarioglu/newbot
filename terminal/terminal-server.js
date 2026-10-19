/**
 * terminal-server.js — Alpha Terminal Node.js Sunucusu
 */

const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const { spawn } = require('child_process');

const app  = express();
const PORT = process.env.TERMINAL_PORT || 3000;
const HOST = process.env.TERMINAL_HOST || '127.0.0.1';

// ─── Middleware & Static Files ──────────────────────────────────
app.use('/api', (req, res, next) => {
  const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', HOST]);
  try {
    const requestUrl = new URL(`http://${req.headers.host}`);
    if (!allowedHosts.has(requestUrl.hostname)) return res.status(403).json({ error: 'Yerel erisim gerekli' });
    if (req.headers.origin && new URL(req.headers.origin).host !== requestUrl.host) {
      return res.status(403).json({ error: 'Farkli kaynaktan API erisimi engellendi' });
    }
    if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Farkli kaynaktan API erisimi engellendi' });
  } catch {
    return res.status(403).json({ error: 'Gecersiz istek kaynagi' });
  }
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

// ─── Binance CORS Proxy ──────────────────────────────────────
function proxyRequest(targetUrl, res) {
  const options = { timeout: 10000, headers: { 'User-Agent': 'AlphaTerminal/2.0', 'Accept': 'application/json' } };
  const request = https.get(targetUrl, options, (apiRes) => {
    res.status(apiRes.statusCode).set('Content-Type', 'application/json');
    apiRes.on('error', () => res.destroy());
    apiRes.pipe(res);
  }).on('error', (err) => {
    console.error('[Proxy] Hata:', err.message);
    if (res.headersSent) return res.destroy();
    res.status(502).json({ error: 'Upstream baglanti hatasi' });
  });
  request.on('timeout', () => request.destroy(new Error('Binance timeout')));
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = { timeout: 10000, headers: { 'User-Agent': 'AlphaTerminal/2.0', 'Accept': 'application/json' } };
    const request = https.get(url, options, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`Binance HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('error', reject);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Binance timeout')));
  });
}

const symbolRegistryService = require('./services/symbol-registry.service');
const ledgerService = require('./services/treasury-ledger.service');
const binanceAccountService = require('./services/binance-account.service');

// SymbolRegistry Başlat

// ─── /api/exchange-info (Official tickSize, decimals, minMove) ──
app.get('/api/exchange-info', (req, res) => {
  res.json(symbolRegistryService.getAllRegistryData());
});

// ─── Cache Containers ─────────────────────────────────────────
let watchlistCache = { data: null, ts: 0 };
let watchlistPending = null;
const sentimentCache = new Map();

// ─── /api/watchlist (700+ Coin Tickers + Funding Rates) ─────────
async function fetchWatchlistSnapshot() {
    const [tickers, premium] = await Promise.all([
      fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
      fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex')
    ]);

    if (!Array.isArray(tickers) || !Array.isArray(premium)) throw new Error('Gecersiz Binance watchlist yaniti');
    const premiumMap = new Map();
    if (Array.isArray(premium)) {
      premium.forEach(p => {
        premiumMap.set(p.symbol, {
          fundingRate: Number.isFinite(Number(p.lastFundingRate)) && p.lastFundingRate != null ? Number(p.lastFundingRate) : null,
          nextFundingTime: p.nextFundingTime
        });
      });
    }

    const result = [];
    if (Array.isArray(tickers)) {
      tickers.forEach(t => {
        if (!t.symbol.endsWith('USDT')) return;
        const prem = premiumMap.get(t.symbol) || { fundingRate: null, nextFundingTime: null };
        const price = parseFloat(t.lastPrice || 0);
        const chg = parseFloat(t.priceChange || 0);
        const chgPct = parseFloat(t.priceChangePercent || 0);
        const volUsd = parseFloat(t.quoteVolume || 0);

        result.push({
          symbol: t.symbol,
          price: t.lastPrice ? String(t.lastPrice) : price,
          priceNum: price,
          decimals: symbolRegistryService.getPrecision(t.symbol),
          minMove: symbolRegistryService.getMinMove(t.symbol),
          chg,
          chgPct,
          volUsd,
          fr: prem.fundingRate,
          frInterval: null,
          nextFundingTime: prem.nextFundingTime,
          high: t.highPrice ? String(t.highPrice) : (t.highPrice || 0),
          low: t.lowPrice ? String(t.lowPrice) : (t.lowPrice || 0)
        });
      });
    }

    result.sort((a, b) => b.volUsd - a.volUsd);
    return result;
}

app.get('/api/watchlist', async (req, res) => {
  if (watchlistCache.data && Date.now() - watchlistCache.ts < 15000) {
    return res.json(watchlistCache.data);
  }
  try {
    if (!watchlistPending) {
      // Çoklu pencere aynı ağır all-ticker isteğini paylaşır; canlı fiyatlar WS'den gelir.
      watchlistPending = fetchWatchlistSnapshot()
        .then(data => {
          watchlistCache = { data, ts: Date.now() };
          return data;
        })
        .finally(() => { watchlistPending = null; });
    }
    res.json(await watchlistPending);
  } catch (err) {
    console.error('[Watchlist Error]:', err.message);
    if (watchlistCache.data) return res.json(watchlistCache.data);
    res.status(500).json({ error: 'Watchlist alinamadi' });
  }
});

// ─── /api/sentiment (Order Book, Top Position, Top Account, Market Exposure) ─
app.get('/api/sentiment', async (req, res) => {
  const symbol = String(req.query.symbol || 'BTCUSDT').trim().toUpperCase();
  if (!/^[A-Z0-9]{1,30}USDT$/.test(symbol)) return res.status(400).json({ error: 'Gecersiz sembol' });
  const now = Date.now();
  const cached = sentimentCache.get(symbol);
  if (cached && (now - cached.ts < 4000)) {
    return res.json(cached.data);
  }

  try {
    const [depth, posRatio, accRatio, globRatio] = await Promise.allSettled([
      fetchJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${symbol}&limit=50`),
      fetchJson(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=1`),
      fetchJson(`https://fapi.binance.com/futures/data/topLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`),
      fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=1`)
    ]);

    // 1. Order book
    let orderBook = { bidPct: null, askPct: null };
    if (depth.status === 'fulfilled' && depth.value && depth.value.bids && depth.value.asks) {
      const bidVol = depth.value.bids.reduce((a, b) => a + parseFloat(b[1]), 0);
      const askVol = depth.value.asks.reduce((a, b) => a + parseFloat(b[1]), 0);
      const total = bidVol + askVol;
      if (total > 0) {
        const bPct = parseFloat((bidVol / total * 100).toFixed(2));
        orderBook = { bidPct: bPct, askPct: parseFloat((100 - bPct).toFixed(2)) };
      }
    }

    // 2. Top Position
    let topPosition = { longPct: null, shortPct: null };
    if (posRatio.status === 'fulfilled' && Array.isArray(posRatio.value) && posRatio.value[0]) {
      const lp = parseFloat(posRatio.value[0].longAccount) * 100;
      topPosition = { longPct: parseFloat(lp.toFixed(2)), shortPct: parseFloat((100 - lp).toFixed(2)) };
    }

    // 3. Top Account
    let topAccount = { longPct: null, shortPct: null };
    if (accRatio.status === 'fulfilled' && Array.isArray(accRatio.value) && accRatio.value[0]) {
      const lp = parseFloat(accRatio.value[0].longAccount) * 100;
      topAccount = { longPct: parseFloat(lp.toFixed(2)), shortPct: parseFloat((100 - lp).toFixed(2)) };
    }

    // 4. Global Market Exposure
    let globalExposure = { longPct: null, shortPct: null };
    if (globRatio.status === 'fulfilled' && Array.isArray(globRatio.value) && globRatio.value[0]) {
      const lp = parseFloat(globRatio.value[0].longAccount) * 100;
      globalExposure = { longPct: parseFloat(lp.toFixed(2)), shortPct: parseFloat((100 - lp).toFixed(2)) };
    }

    const payload = {
      symbol,
      orderBook,
      topPosition,
      topAccount,
      globalExposure,
      updatedAt: now
    };

    if (sentimentCache.size >= 1000) sentimentCache.delete(sentimentCache.keys().next().value);
    sentimentCache.set(symbol, { data: payload, ts: now });
    res.json(payload);
  } catch (err) {
    console.error('[Sentiment Error]:', err.message);
    res.status(500).json({ error: 'Sentiment alinamadi' });
  }
});

// ─── Bot İstasyonu Rotaları & Motoru (MVC Micro-Architecture) ───────────
const botRoutes      = require('./bots/routes/bot.routes');
const botManager     = require('./bots/index');
const historyService = require('./services/history.service');

app.use('/api/signals', botRoutes);

// ─── 200 Günlük Geçmiş & Favori Analiz API'leri ──────────────────
app.get('/api/favorites/analytics', async (req, res) => {
  try {
    const { symbol, symbols, refresh } = req.query;
    const forceRefresh = refresh === 'true' || refresh === '1';

    if (symbol) {
      const data = await historyService.getCoinHistory(symbol, forceRefresh);
      if (!data) return res.status(404).json({ error: '200 gunluk veri alinamadi' });
      return res.json(data);
    }

    if (symbols) {
      const list = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const batch = await historyService.getBatchAnalytics(list);
      return res.json(batch);
    }

    const all = historyService.getAllStored();
    res.json(all);
  } catch (err) {
    console.error('[Favorites Analytics Error]:', err.message);
    res.status(500).json({ error: 'Analiz alinamadi' });
  }
});

app.post('/api/favorites/sync', async (req, res) => {
  try {
    const symbol = req.body.symbol || req.query.symbol;
    if (!symbol) return res.status(400).json({ error: 'symbol parametresi zorunludur' });

    const data = await historyService.getCoinHistory(symbol, true);
    res.json({ success: true, data });
  } catch (err) {
    console.error('[Favorites Sync Error]:', err.message);
    res.status(500).json({ error: 'Senkronizasyon hatasi' });
  }
});

// ─── Kasa Defteri (Trading Ledger & Journal) API ───────────────
app.get('/api/ledger/trades', (req, res) => {
  res.json(ledgerService.getAll());
});

app.post('/api/ledger/trades', (req, res) => {
  try {
    const trade = ledgerService.addTrade(req.body);
    res.json({ success: true, trade, stats: ledgerService.getStats() });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

app.put('/api/ledger/trades/:id', (req, res) => {
  try {
    const trade = ledgerService.updateTrade(req.params.id, req.body);
    if (!trade) return res.status(404).json({ success: false, error: 'Islem bulunamadi' });
    res.json({ success: true, trade, stats: ledgerService.getStats() });
  } catch (err) {
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

app.delete('/api/ledger/trades/:id', (req, res) => {
  try {
    const ok = ledgerService.deleteTrade(req.params.id);
    res.json({ success: ok, stats: ledgerService.getStats() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/ledger/initial-capital', (req, res) => {
  const { capital } = req.body;
  const ok = ledgerService.setInitialCapital(capital);
  res.json({ success: ok, stats: ledgerService.getStats() });
});

app.post('/api/ledger/reset-default', (req, res) => {
  res.json(ledgerService.resetToDefault());
});

// ─── Binance Sadece Okuma (Read-Only) API ───────────────────────
app.get('/api/binance-read/status', (req, res) => {
  res.json(binanceAccountService.getStatus());
});

app.post('/api/binance-read/config', async (req, res) => {
  try {
    const { apiKey, apiSecret, autoSync } = req.body;
    const testResult = await binanceAccountService.setCredentials(apiKey, apiSecret, autoSync);
    res.json({ success: testResult.success, testResult, status: binanceAccountService.getStatus() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/binance-read/sync', async (req, res) => {
  try {
    const syncRes = await binanceAccountService.syncClosedTradesToLedger();
    res.status(syncRes.success === false ? 502 : 200).json({ success: syncRes.success !== false, syncRes, ledger: ledgerService.getAll() });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/binance-read/positions', async (req, res) => {
  try {
    const positions = await binanceAccountService.getOpenPositions();
    res.json({ success: true, positions });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Ekranlar ve Pencereler Arası Canlı Sembol Senkronizasyonu ───
let sharedActiveSymbol = 'BTCUSDT';
let sharedActiveTs = Date.now();

app.get('/api/sync/active-symbol', (req, res) => {
  const sym = req.query.symbol;
  if (sym) {
    sharedActiveSymbol = String(sym).toUpperCase().trim();
    sharedActiveTs = Date.now();
  }
  res.json({ symbol: sharedActiveSymbol, ts: sharedActiveTs });
});

// ─── /api/open-app-window (Chrome Standalone App Modu - Adres Çubuğu Olmadan Açılış) ───
app.get('/api/open-app-window', (req, res) => {
  try {
    const botId = (req.query.bot || 'div').toLowerCase();
    const url = `http://localhost:${PORT}/bot-window.html?bot=${botId}`;

    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const chromeX86  = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
    const edgePath   = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

    let browserExe = '';
    if (fs.existsSync(chromePath)) {
      browserExe = chromePath;
    } else if (fs.existsSync(chromeX86)) {
      browserExe = chromeX86;
    } else if (fs.existsSync(edgePath)) {
      browserExe = edgePath;
    }

    if (!browserExe) {
      return res.status(404).json({ success: false, error: 'Tarayici bulunamadi' });
    }

    const userProfile = process.env.USERPROFILE || 'C:\\Users\\gurol.sarioglu';
    const appProfileDir = path.join(userProfile, '.alpha_terminal_chrome_profile');

    const args = [
      `--app=${url}`,
      `--window-size=460,820`,
      `--user-data-dir=${appProfileDir}`
    ];

    const child = spawn(browserExe, args, {
      detached: true,
      stdio: 'ignore'
    });
    child.unref();

    res.json({ success: true, bot: botId, mode: 'app' });
  } catch (err) {
    console.error('[Open App Window Error]:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});



// /api/fapi/** -> https://fapi.binance.com/fapi/**
app.use('/api/fapi', (req, res) => {
  const parts = req.url.split('?');
  const ep    = parts[0];
  const qs    = parts[1] || '';
  const url   = `https://fapi.binance.com/fapi${ep}${qs ? '?' + qs : ''}`;
  proxyRequest(url, res);
});

// /api/data/** -> https://fapi.binance.com/**
app.use('/api/data', (req, res) => {
  const parts = req.url.split('?');
  const ep    = parts[0];
  const qs    = parts[1] || '';
  const url   = `https://fapi.binance.com${ep}${qs ? '?' + qs : ''}`;
  proxyRequest(url, res);
});

// ─── Baslat ─────────────────────────────────────────────────
function start() {
  symbolRegistryService.init();
  botManager.startBackgroundEngine();
  return app.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ALPHA TERMINAL — HAMMER PRO & M1 PREMIUM');
  console.log('  ------------------------------------------');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Binance Futures Proxy & Watchlist Engine Aktif`);
  console.log('  ------------------------------------------');
  console.log('  Cikmak icin Ctrl+C');
  console.log('');
  });
}

app.start = start;
module.exports = app;
if (require.main === module) start();
