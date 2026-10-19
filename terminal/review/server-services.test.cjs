'use strict';

// All persistence and Binance traffic are mocked. Never reads/writes user's data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'isolated-test-data');

function sandbox(initialFiles = {}, overrides = {}) {
  const files = new Map(Object.entries(initialFiles).map(([name, value]) => [path.join(dataDir, name), typeof value === 'string' ? value : JSON.stringify(value)]));
  const writes = [];
  const timers = new Set();
  const fakeFs = {
    existsSync: file => files.has(file),
    mkdirSync() {},
    readFileSync(file) { if (!files.has(file)) throw new Error('ENOENT'); return files.get(file); },
    writeFileSync(file, value) { files.set(file, value); writes.push(file); },
    renameSync(from, to) { files.set(to, files.get(from)); files.delete(from); }
  };
  const modules = new Map();
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    process: { env: { TERMINAL_DATA_DIR: dataDir } },
    URL, structuredClone,
    setTimeout(fn) { const timer = { fn, unref() {} }; timers.add(timer); return timer; },
    clearTimeout(timer) { timers.delete(timer); },
    setInterval(fn) { const timer = { fn, unref() {} }; timers.add(timer); return timer; },
    clearInterval(timer) { timers.delete(timer); }
  });
  function load(relativeFile) {
    const filename = path.resolve(root, relativeFile);
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    function requireMock(name) {
      if (Object.hasOwn(overrides, name)) return overrides[name];
      if (name === 'fs') return fakeFs;
      if (name === 'https') return { get() { throw new Error('Unmocked network use'); }, request() { throw new Error('Unmocked network use'); } };
      if (name.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename), name);
        return load(/\.(?:js|cjs|json)$/.test(resolved) ? resolved : resolved + '.js');
      }
      return require(name);
    }
    const code = fs.readFileSync(filename, 'utf8');
    vm.runInContext(`(function(require,module,exports,__dirname,__filename){\n${code}\n})`, context, { filename })(requireMock, module, module.exports, path.dirname(filename), filename);
    return module.exports;
  }
  return { files, writes, timers, load, fakeFs, context };
}

test('archive preserves zero metrics and candle identity across restart', () => {
  const e = sandbox();
  const store = e.load('services/signal-store.service.js');
  const timestamp = Date.now();
  store.recordSignal('m1a', { id: 'zero', symbol: 'BTCUSDT', timestamp, currentPrice: '100.000', prevPrice: '101.000', rsi: 0, volume: 0, fundingRate: 0, candleOpenTime: timestamp, timeframe: '1m', rawId: 'origin' });
  store.saveSync();
  const saved = JSON.parse(e.files.get(path.join(dataDir, 'signals_history.json'))).signals[0];
  assert.equal(saved.rsi, 0);
  assert.equal(saved.volume, 0);
  assert.equal(saved.fundingRate, 0);
  assert.equal(saved.currentPrice, '100.000');
  assert.equal(saved.candleOpenTime, timestamp);
  assert.equal(saved.rawId, 'origin');
});

test('archive detects duplicate ids beyond the ten most recent records', () => {
  const e = sandbox();
  const store = e.load('services/signal-store.service.js');
  const timestamp = Date.now();
  for (let i = 0; i < 25; i++) store.recordSignal('m1a', { id: `id-${i}`, symbol: `COIN${i}USDT`, timestamp });
  store.recordSignal('m1a', { id: 'id-0', symbol: 'COIN0USDT', timestamp });
  assert.equal(store.getTotalCount(), 25);
});

test('archive persistence is not postponed forever by continuous signals', () => {
  const e = sandbox();
  const store = e.load('services/signal-store.service.js');
  store.recordSignal('m1a', { id: 'first', symbol: 'BTCUSDT' });
  const timer = store.saveTimeout;
  store.recordSignal('m1a', { id: 'second', symbol: 'ETHUSDT' });
  assert.equal(store.saveTimeout, timer);
  timer.fn();
  assert.equal(JSON.parse(e.files.get(path.join(dataDir, 'signals_history.json'))).totalSignals, 2);
});

test('archive retention prunes memory indexes and ids as well as disk', () => {
  const e = sandbox();
  const store = e.load('services/signal-store.service.js');
  store.recordSignal('m1a', { id: 'expired', symbol: 'BTCUSDT' });
  store.signals[0].timestamp = Date.now() - 61 * 86400000;
  store.saveSync();
  assert.equal(store.getTotalCount(), 0);
  assert.equal(store.getRecentSignalsByBot('m1a').length, 0);
  assert.equal(store.idMap.size, 0);
  assert.equal(store.symbolMap.size, 0);
});

test('archive rejects invalid timestamps and keeps newest loaded records first', () => {
  const now = Date.now();
  const e = sandbox({ 'signals_history.json': { signals: [
    { id: 'old', botId: 'm1a', symbol: 'BTCUSDT', timestamp: String(now - 5000) },
    { id: 'new', botId: 'm1a', symbol: 'BTCUSDT', timestamp: now }
  ] } });
  const store = e.load('services/signal-store.service.js');
  assert.equal(store.getRecentSignalsByBot('m1a')[0].id, 'new');
  assert.equal(store.recordSignal('m1a', { symbol: 'BTCUSDT', timestamp: 'bad' }), null);
});

test('archive preserves unreadable existing data on subsequent signals', () => {
  const e = sandbox({ 'signals_history.json': '{damaged' });
  const store = e.load('services/signal-store.service.js');
  store.recordSignal('m1a', { symbol: 'BTCUSDT' });
  store.saveSync();
  assert.equal(e.files.get(path.join(dataDir, 'signals_history.json')), '{damaged');
});

test('ledger respects a deliberately empty saved ledger', () => {
  const e = sandbox({ 'treasury_ledger.json': { initialCapital: 25, trades: [] } });
  const ledger = e.load('services/treasury-ledger.service.js');
  assert.equal(ledger.trades.length, 0);
  assert.equal(ledger.getStats().currentBalance, 25);
});

test('ledger rejects invalid money and keeps the starting row consistent', () => {
  const e = sandbox();
  const ledger = e.load('services/treasury-ledger.service.js');
  const before = ledger.trades.length;
  for (const value of ['NaN', '12junk', Infinity, '', null]) {
    assert.throws(() => ledger.addTrade({ coin: 'BTC', profitUsd: value }), /tutari/);
  }
  assert.equal(ledger.trades.length, before);
  assert.equal(ledger.setInitialCapital(Infinity), false);
  assert.throws(() => ledger.updateTrade('t_00', { profitUsd: 100 }), /Baslangic/);
});

test('ledger updates coin and symbol together and writes atomically', () => {
  const e = sandbox({ 'treasury_ledger.json': { initialCapital: 10, trades: [] } });
  const ledger = e.load('services/treasury-ledger.service.js');
  const trade = ledger.addTrade({ coin: 'BTC', profitUsd: 2, side: 'LONG' });
  ledger.updateTrade(trade.id, { coin: 'ETHUSDT' });
  assert.equal(ledger.trades[0].coin, 'ETH');
  assert.equal(ledger.trades[0].symbol, 'ETHUSDT');
  assert.equal(ledger.getStats().currentBalance, 12);
  assert.ok(e.writes.every(filename => filename.endsWith('.tmp')));
});

test('unreadable ledger is preserved on a subsequent attempted write', () => {
  const e = sandbox({ 'treasury_ledger.json': '{corrupted' });
  const ledger = e.load('services/treasury-ledger.service.js');
  assert.throws(() => ledger.addTrade({ coin: 'BTC', profitUsd: 1 }), /korunuyor/);
  assert.equal(e.files.get(path.join(dataDir, 'treasury_ledger.json')), '{corrupted');
});

test('ledger imports batches in one write and rolls back memory when disk fails', () => {
  const e = sandbox({ 'treasury_ledger.json': { initialCapital: 10, trades: [] } });
  const ledger = e.load('services/treasury-ledger.service.js');
  ledger.addTrades([{ coin: 'BTC', profitUsd: 1 }, { coin: 'ETH', profitUsd: 2 }]);
  assert.equal(e.writes.length, 1);
  const before = JSON.stringify(ledger.getAll());
  e.fakeFs.renameSync = () => { throw new Error('disk failure'); };
  assert.throws(() => ledger.addTrade({ coin: 'SOL', profitUsd: 3 }), /disk failure/);
  assert.equal(JSON.stringify(ledger.getAll()), before);
  assert.throws(() => ledger.updateTrade(ledger.trades[0].id, { profitUsd: 100 }), /disk failure/);
  assert.equal(JSON.stringify(ledger.getAll()), before);
  assert.throws(() => ledger.setInitialCapital(100), /disk failure/);
  assert.equal(JSON.stringify(ledger.getAll()), before);
});

function accountEnv() {
  const added = [];
  const ledger = { trades: [], addTrades(trades) { added.push(...trades); this.trades.push(...trades); return trades.length; } };
  const e = sandbox({}, { './treasury-ledger.service': ledger });
  const account = e.load('services/binance-account.service.js');
  account.apiKey = '123456789abcdefgh';
  account.apiSecret = 'secret';
  return { ...e, account, ledger, added };
}

test('Binance import does not infer position direction from profitability', async () => {
  const { account, added } = accountEnv();
  account.getRealizedPnlHistory = async () => [
    { tranId: '1', time: Date.now(), income: '2.30', asset: 'USDT', symbol: 'BTCUSDT' },
    { tranId: '2', time: Date.now(), income: '-1.20', asset: 'USDT', symbol: 'ETHUSDT' },
    { tranId: '3', time: Date.now(), income: '6', asset: 'USDC', symbol: 'ETHUSDC' },
    { tranId: '4', time: Date.now(), income: 'NaN', asset: 'USDT', symbol: 'ETHUSDT' }
  ];
  const result = await account.syncClosedTradesToLedger();
  assert.equal(result.success, true);
  assert.equal(result.syncedCount, 2);
  assert.ok(added.every(trade => trade.side === '—'));
  assert.equal((await account.syncClosedTradesToLedger()).syncedCount, 0);
});

test('Binance import pages through more than 1000 income rows', async () => {
  const { account, added } = accountEnv();
  const calls = [];
  account.getRealizedPnlHistory = async (limit, params, strict) => {
    calls.push({ limit, ...params, strict });
    return Array.from({ length: params.page === 1 ? 1000 : 2 }, (_, i) => ({ tranId: `${params.page}-${i}`, time: Date.now(), income: '1', asset: 'USDT', symbol: 'BTCUSDT' }));
  };
  const result = await account.syncClosedTradesToLedger();
  assert.equal(result.syncedCount, 1002);
  assert.equal(added.length, 1002);
  assert.equal(calls[0].endTime, calls[1].endTime);
  assert.equal(calls[1].page, 2);
  assert.equal(calls[1].strict, true);
});

test('failed Binance page never reports success or advances sync cursor', async () => {
  const { account, added } = accountEnv();
  account.getRealizedPnlHistory = async () => { throw new Error('upstream unavailable'); };
  const result = await account.syncClosedTradesToLedger();
  assert.equal(result.success, false);
  assert.equal(account.lastSyncTime, null);
  assert.equal(added.length, 0);
  assert.equal(account.isSyncing, false);
});

test('Binance connection reports actual key trading permission', async () => {
  const { account } = accountEnv();
  account._signedRequest = async () => ({ canTrade: true, totalWalletBalance: '10' });
  const result = await account.testConnection();
  assert.equal(result.canTrade, true);
  assert.equal(result.usesTradingEndpoints, false);
});

test('Binance credentials keep masked current key but clear old secret for a new key', async () => {
  const { account } = accountEnv();
  account.testConnection = async () => ({});
  await account.setCredentials(account.getStatus().apiKeyMasked, '', false);
  assert.equal(account.apiKey, '123456789abcdefgh');
  assert.equal(account.apiSecret, 'secret');
  account.openPositionsCache = [{ symbol: 'BTCUSDT' }];
  await account.setCredentials('a-different-key', '', false);
  assert.equal(account.isConnected(), false);
  assert.equal(account.openPositionsCache.length, 0);
});

test('Binance disabling automatic sync cancels the pending initial import', () => {
  const { account, timers } = accountEnv();
  account.startAutoSync();
  const initial = account.initialSyncTimer;
  assert.ok(timers.has(initial));
  account.autoSync = false;
  account.startAutoSync();
  assert.equal(timers.has(initial), false);
  assert.equal(account.syncTimer, null);
});

test('symbol metadata refresh removes delisted contracts and respects non-unit ticks', () => {
  const registry = sandbox().load('services/symbol-registry.service.js');
  registry._processExchangeInfo({ symbols: [{ symbol: 'TESTUSDT', contractType: 'PERPETUAL', status: 'TRADING', quoteAsset: 'USDT', filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.05000000' },
    { filterType: 'LOT_SIZE', stepSize: '0.001' }
  ] }] });
  assert.equal(registry.getMinMove('TESTUSDT'), 0.05);
  assert.equal(registry.getPrecision('TESTUSDT'), 2);
  assert.equal(registry.getSymbol('BTCUSDT'), null);
  assert.throws(() => registry._processExchangeInfo({}), /Gecersiz/);
});

test('price formatting preserves tiny scientific prices and handles zero change', () => {
  const formatter = sandbox().load('services/price-formatter.js');
  assert.equal(formatter.formatCryptoPrice(1.23e-9), '0.00000000123');
  assert.equal(formatter.formatCryptoPrice('0.001230', 'NEWUSDT'), '0.001230');
  assert.equal(formatter.formatCryptoPrice(Infinity), '0.00');
  assert.equal(formatter.computePrevPrice(100, 0, 'BTCUSDT'), '100.0');
  assert.equal(formatter.computePrevPrice(100, -100, 'BTCUSDT'), '0.00');
});

function httpsMock(answer) {
  return { get(url, options, callback) {
    const request = new EventEmitter();
    request.destroy = error => request.emit('error', error || new Error('destroyed'));
    queueMicrotask(() => {
      const result = answer(String(url));
      const response = new EventEmitter();
      response.statusCode = result.status ?? 200;
      response.resume = () => {};
      callback(response);
      if (response.statusCode >= 200 && response.statusCode < 300) {
        response.emit('data', JSON.stringify(result.body));
        response.emit('end');
      }
    });
    return request;
  } };
}

test('concurrent daily-history requests share the in-flight result and preserve tiny EMA', async () => {
  let requests = 0;
  const https = httpsMock(() => {
    requests++;
    return { body: Array.from({ length: 200 }, (_, i) => [Date.now() - (200 - i) * 86400000, '0.00000010', '0.00000012', '0.00000008', '0.00000010', '100']) };
  });
  const history = sandbox({}, { https }).load('services/history.service.js');
  const results = await Promise.all([history.getCoinHistory('TINYUSDT'), history.getCoinHistory('TINYUSDT')]);
  assert.equal(requests, 1);
  assert.ok(results[0]);
  assert.equal(results[0], results[1]);
  assert.ok(Math.abs(results[0].metrics.ema200 - 1e-7) < 1e-20);
  assert.equal(await history.getCoinHistory('BTCUSDT&limit=1000'), null);
});

test('daily history preserves unreadable or invalid existing data after a fresh lookup', async () => {
  for (const original of ['{broken', '{"coins":[]}']) {
    const https = httpsMock(() => ({ body: [[Date.now(), '1', '2', '0.5', '1.5', '100']] }));
    const e = sandbox({ 'daily_history.json': original }, { https });
    const history = e.load('services/history.service.js');
    const result = await history.getCoinHistory('BTCUSDT');
    assert.equal(result.latestPrice, 1.5);
    assert.equal(e.files.get(path.join(dataDir, 'daily_history.json')), original);
    assert.equal(e.writes.length, 0);
  }
});

function serverEnv(answer) {
  const routes = new Map();
  const uses = [];
  let starts = 0;
  const app = {
    use(...args) { uses.push(args); },
    listen(port, host, callback) { this.listeningHost = host; callback(); return {}; }
  };
  for (const method of ['get', 'post', 'put', 'delete']) app[method] = (url, callback) => routes.set(`${method} ${url}`, callback);
  const express = () => app;
  express.json = express.urlencoded = express.static = () => () => {};
  const e = sandbox({}, {
    express, https: httpsMock(answer),
    './services/symbol-registry.service': { init() {}, getPrecision() { return 2; }, getMinMove() { return 0.01; }, getAllRegistryData() { return {}; } },
    './services/treasury-ledger.service': { getAll() { return {}; } },
    './services/binance-account.service': { async syncClosedTradesToLedger() { return { success: false, error: 'offline' }; } },
    './bots/routes/bot.routes': {},
    './bots/index': { startBackgroundEngine() { starts++; } },
    './services/history.service': {}
  });
  e.load('terminal-server.js');
  function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  }
  return { app, routes, uses, response, starts: () => starts, setNow(now) { vm.runInContext(`Date.now = () => ${Number(now)}`, e.context); } };
}

test('server missing sentiment data stays unavailable instead of invented percentages', async () => {
  const e = serverEnv(() => ({ status: 503, body: {} }));
  const res = e.response();
  await e.routes.get('get /api/sentiment')({ query: { symbol: 'BTCUSDT' } }, res);
  assert.equal(res.body.orderBook.bidPct, null);
  assert.equal(res.body.topPosition.longPct, null);
  assert.equal(res.body.topAccount.longPct, null);
  assert.equal(res.body.globalExposure.longPct, null);
});

test('server watchlist does not invent missing funding rates', async () => {
  const e = serverEnv(url => ({ body: url.includes('premiumIndex') ? [] : [{ symbol: 'BTCUSDT', lastPrice: '100', quoteVolume: '1000' }] }));
  const res = e.response();
  await e.routes.get('get /api/watchlist')({ query: {} }, res);
  assert.equal(res.body[0].fr, null);
  assert.equal(res.body[0].nextFundingTime, null);
  assert.equal(res.body[0].frInterval, null);
});

test('concurrent watchlist windows share one upstream pair and cache it for 15 seconds', async () => {
  let requests = 0;
  const e = serverEnv(url => {
    requests++;
    return { body: url.includes('premiumIndex') ? [] : [{ symbol: 'BTCUSDT', lastPrice: '100', quoteVolume: '1000' }] };
  });
  e.setNow(100000);
  const handler = e.routes.get('get /api/watchlist');
  const responses = Array.from({ length: 12 }, () => e.response());
  await Promise.all(responses.map(res => handler({ query: {} }, res)));
  assert.equal(requests, 2);
  assert.ok(responses.every(res => res.body[0].symbol === 'BTCUSDT'));
  e.setNow(114999);
  await handler({ query: {} }, e.response());
  assert.equal(requests, 2);
  e.setNow(115001);
  await handler({ query: {} }, e.response());
  assert.equal(requests, 4);
});

test('watchlist in-flight state clears after failure and stale cache survives a failed refresh', async () => {
  let requests = 0;
  let failed = true;
  let price = '100';
  const e = serverEnv(url => {
    requests++;
    return failed ? { status: 503 } : { body: url.includes('premiumIndex') ? [] : [{ symbol: 'BTCUSDT', lastPrice: price, quoteVolume: '1000' }] };
  });
  e.setNow(100000);
  const handler = e.routes.get('get /api/watchlist');
  const responses = Array.from({ length: 8 }, () => e.response());
  await Promise.all(responses.map(res => handler({ query: {} }, res)));
  assert.equal(requests, 2);
  assert.ok(responses.every(res => res.statusCode === 500));
  failed = false;
  const recovered = e.response();
  await handler({ query: {} }, recovered);
  assert.equal(requests, 4);
  assert.equal(recovered.body[0].price, '100');
  e.setNow(115001);
  failed = true;
  const stale = e.response();
  await handler({ query: {} }, stale);
  assert.equal(requests, 6);
  assert.equal(stale.statusCode, 200);
  assert.equal(stale.body[0].price, '100');
  failed = false;
  price = '200';
  const refreshed = e.response();
  await handler({ query: {} }, refreshed);
  assert.equal(requests, 8);
  assert.equal(refreshed.body[0].price, '200');
});

test('server starts only explicitly, binds to loopback and propagates sync failure', async () => {
  const e = serverEnv(() => ({ body: [] }));
  assert.equal(e.starts(), 0);
  e.app.start();
  assert.equal(e.starts(), 1);
  assert.equal(e.app.listeningHost, '127.0.0.1');
  const res = e.response();
  await e.routes.get('post /api/binance-read/sync')({}, res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.success, false);
});

test('server blocks foreign origins and DNS-rebinding hosts before API access', () => {
  const e = serverEnv(() => ({ body: [] }));
  const middleware = e.uses.find(args => args[0] === '/api')[1];
  let called = false;
  const foreign = e.response();
  middleware({ headers: { host: 'localhost:3000', origin: 'https://evil.example' } }, foreign, () => { called = true; });
  assert.equal(foreign.statusCode, 403);
  assert.equal(called, false);
  const rebind = e.response();
  middleware({ headers: { host: 'evil.example:3000' } }, rebind, () => { called = true; });
  assert.equal(rebind.statusCode, 403);
  const local = e.response();
  middleware({ headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } }, local, () => { called = true; });
  assert.equal(called, true);
});

test('bot controller rejects unknown bots and invalid archive lookback queries', () => {
  const e = sandbox({}, { '../index': { getBot() { return null; } }, '../../services/signal-store.service': {} });
  const controller = e.load('bots/controllers/bot.controller.js');
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
  const unknown = response();
  controller.getSignals({ query: { bot: 'unknown-bot' } }, unknown);
  assert.equal(unknown.statusCode, 404);
  for (const days of ['0', '-1', 'NaN', '61', '1.5']) {
    const res = response();
    controller.getCoinHistory({ query: { symbol: 'BTCUSDT', days } }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('bot controller reports invalid ingestion as 400 and strategy rejection as 422', () => {
  let emitted = 0;
  const manager = {
    getBot(id) { return id === 'unknown' ? null : { id }; },
    emitSignal() { emitted++; return { symbol: 'BTCUSDT', affectedBots: [], time: '12:00' }; }
  };
  const e = sandbox({}, { '../index': manager, '../../services/signal-store.service': {} });
  const controller = e.load('bots/controllers/bot.controller.js');
  const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
  for (const body of [null, [], { symbol: {} }, { symbol: 'INVALID' }, { symbol: 'BTCUSDT', botId: 'unknown' }]) {
    const res = response();
    controller.emitSignal({ body }, res);
    assert.equal(res.statusCode, 400);
  }
  assert.equal(emitted, 0);
  const res = response();
  controller.emitSignal({ body: { symbol: 'BTCUSDT', botId: 'm1a' } }, res);
  assert.equal(res.statusCode, 422);
  assert.equal(res.body.success, false);
  assert.equal(res.body.rejected, true);
});
