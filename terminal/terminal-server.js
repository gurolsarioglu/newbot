/**
 * terminal-server.js — Alpha Terminal Node.js Sunucusu
 */

const express = require('express');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');
const { exec, spawn } = require('child_process');

const app  = express();
const PORT = process.env.TERMINAL_PORT || 3000;

// ─── Middleware & Static Files ──────────────────────────────────
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
  const options = { headers: { 'User-Agent': 'AlphaTerminal/2.0', 'Accept': 'application/json' } };
  https.get(targetUrl, options, (apiRes) => {
    res.status(apiRes.statusCode).set('Content-Type', 'application/json');
    apiRes.pipe(res);
  }).on('error', (err) => {
    console.error('[Proxy] Hata:', err.message);
    res.status(502).json({ error: 'Upstream baglanti hatasi' });
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const options = { headers: { 'User-Agent': 'AlphaTerminal/2.0', 'Accept': 'application/json' } };
    https.get(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (err) { reject(err); }
      });
    }).on('error', reject);
  });
}

const symbolRegistryService = require('./services/symbol-registry.service');

// SymbolRegistry Başlat
symbolRegistryService.init();

// ─── /api/exchange-info (Official tickSize, decimals, minMove) ──
app.get('/api/exchange-info', (req, res) => {
  res.json(symbolRegistryService.getAllRegistryData());
});

// ─── Cache Containers ─────────────────────────────────────────
let watchlistCache = { data: null, ts: 0 };
const sentimentCache = new Map();

// ─── /api/watchlist (700+ Coin Tickers + Funding Rates) ─────────
app.get('/api/watchlist', async (req, res) => {
  const now = Date.now();
  if (watchlistCache.data && (now - watchlistCache.ts < 1500)) {
    return res.json(watchlistCache.data);
  }

  try {
    const [tickers, premium] = await Promise.all([
      fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr'),
      fetchJson('https://fapi.binance.com/fapi/v1/premiumIndex')
    ]);

    const premiumMap = new Map();
    if (Array.isArray(premium)) {
      premium.forEach(p => {
        premiumMap.set(p.symbol, {
          fundingRate: parseFloat(p.lastFundingRate || 0),
          nextFundingTime: p.nextFundingTime
        });
      });
    }

    const result = [];
    if (Array.isArray(tickers)) {
      tickers.forEach(t => {
        if (!t.symbol.endsWith('USDT')) return;
        const prem = premiumMap.get(t.symbol) || { fundingRate: 0.0001, nextFundingTime: Date.now() + 14400000 };
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
          frInterval: '8h',
          nextFundingTime: prem.nextFundingTime,
          high: t.highPrice ? String(t.highPrice) : (t.highPrice || 0),
          low: t.lowPrice ? String(t.lowPrice) : (t.lowPrice || 0)
        });
      });
    }

    result.sort((a, b) => b.volUsd - a.volUsd);
    watchlistCache = { data: result, ts: now };
    res.json(result);
  } catch (err) {
    console.error('[Watchlist Error]:', err.message);
    if (watchlistCache.data) return res.json(watchlistCache.data);
    res.status(500).json({ error: 'Watchlist alinamadi' });
  }
});

// ─── /api/sentiment (Order Book, Top Position, Top Account, Market Exposure) ─
app.get('/api/sentiment', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
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
    let orderBook = { bidPct: 41.06, askPct: 58.94 };
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
    let topPosition = { longPct: 67.25, shortPct: 32.75 };
    if (posRatio.status === 'fulfilled' && Array.isArray(posRatio.value) && posRatio.value[0]) {
      const lp = parseFloat(posRatio.value[0].longAccount) * 100;
      topPosition = { longPct: parseFloat(lp.toFixed(2)), shortPct: parseFloat((100 - lp).toFixed(2)) };
    }

    // 3. Top Account
    let topAccount = { longPct: 34.05, shortPct: 65.95 };
    if (accRatio.status === 'fulfilled' && Array.isArray(accRatio.value) && accRatio.value[0]) {
      const lp = parseFloat(accRatio.value[0].longAccount) * 100;
      topAccount = { longPct: parseFloat(lp.toFixed(2)), shortPct: parseFloat((100 - lp).toFixed(2)) };
    }

    // 4. Global Market Exposure
    let globalExposure = { longPct: 37.88, shortPct: 62.12 };
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

// Arka plan Quant piyasa ve sinyal motorunu başlat
botManager.startBackgroundEngine();


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
app.listen(PORT, () => {
  console.log('');
  console.log('  ALPHA TERMINAL — HAMMER PRO & M1 PREMIUM');
  console.log('  ------------------------------------------');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  Binance Futures Proxy & Watchlist Engine Aktif`);
  console.log('  ------------------------------------------');
  console.log('  Cikmak icin Ctrl+C');
  console.log('');
});
