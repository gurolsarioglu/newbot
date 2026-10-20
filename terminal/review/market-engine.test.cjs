// Deterministic replay: no Binance connections, no persisted user data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const EventEmitter = require('node:events');
const quant = require('../services/quant-indicators.service');
const root = path.resolve(__dirname, '..');
const minute = Math.floor(Date.now() / 60000) * 60000;
const clockNow = minute + 30000;
class ReplayDate extends Date { static now() { return clockNow; } }
class FakeSocket extends EventEmitter {
  static OPEN = 1;
  constructor(url) { super(); this.url = url; this.readyState = 0; }
  send(msg) { this.sent = msg; }
  terminate() { this.readyState = 3; setImmediate(() => this.emit('close')); }
}
function load(file, requires, extras = {}) {
  const box = { module: { exports: {} }, require: id => requires[id] || require(id), console, Date, process: { env: {} }, setTimeout, clearTimeout, setInterval, clearInterval, ...extras };
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), box, { filename: file });
  return box.module.exports;
}
function engine() { return load('services/market-data-engine.service.js', { ws: FakeSocket }, { Date: ReplayDate }); }
function rawBars(count = 251, interval = 60000) {
  return Array.from({ length: count }, (_, i) => {
    const start = minute - (count - 1 - i) * interval;
    const price = 100 + Math.sin(i / 5);
    return [start, String(price), String(price + 1), String(price - 1), String(price), '10', start + interval - 1, '100'];
  });
}
function bars(count = 251) {
  return rawBars(count).map(k => ({ openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6], quoteVolume: +k[7] }));
}
function kline(overrides = {}) {
  return { e: 'kline', E: minute + 45000, s: 'TESTUSDT', k: { t: minute, T: minute + 59999, i: '1m', o: '100', h: '102', l: '99', c: '101', v: '2', q: '250', x: false, ...overrides } };
}
function manager(e = engine()) {
  const bots = new Map();
  const files = ['hammer-pro-plus', 'hammer-pro', 'four-s-sniper', 'four-s', 'v3-volume', 'divergence', 'funding-rate', 'm1a-drop', 'm1-premium'];
  const ids = ['hammerproplus', 'hammerpro', '4ssniper', '4s', 'v3', 'div', 'fr', 'm1a', 'm1premium'];
  const deps = { '../services/market-data-engine.service': e, '../services/quant-indicators.service': quant, '../services/price-formatter': { formatCryptoPrice: p => String(p) }, '../services/derivatives-enricher.service': { enrich: async () => ({ oiDeltaPct: 1, topTraderLongRatio: 65, globalLongRatio: 48 }) } };
  files.forEach((file, i) => {
    const bot = { id: ids[i], signals: [], canEmitSignal: () => true, addSignal(s) { this.signals.push(s); return s; }, ingest(s) { return this.addSignal(s); } };
    bots.set(ids[i], bot); deps[`./strategies/${file}.bot`] = bot;
  });
  // Lifecycle tests must not start scheduled scans or real sockets.
  const m = load('bots/index.js', deps, { setTimeout: () => 1, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} });
  return { m, bots, deps };
}
test('24h rolling volume changes never masquerade as 1m candle alerts', () => {
  const e = engine(), alerts = [];
  e.on('radarAlert', a => alerts.push(a));
  for (let i = 0; i < 100; i++) e._handleMiniTickers([{ s: 'TESTUSDT', c: String(100 + i), o: '100', q: String(10000000 + i * 100000), E: minute + i }]);
  assert.equal(alerts.length, 0);
  assert.ok(e.subscriptions.has('testusdt@kline_1m'));
});
test('M1 captures exact same-message price/quote volume and emits once per candle', () => {
  const e = engine(), alerts = [];
  e._handleMiniTickers([{ s: 'TESTUSDT', c: '100', q: '11000000', E: minute }]);
  e.on('radarAlert', a => alerts.push(a));
  e._handleKline(kline()); e._handleKline(kline({ c: '102', q: '9999' }));
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].price, 101); assert.equal(alerts[0].candle.quoteVolume, 250);
});
test('out-of-order ticks and updates cannot reopen finalized candles', () => {
  const e = engine();
  e._handleKline(kline({ x: true, q: '300' }));
  e._handleKline({ ...kline({ q: '200' }), E: minute + 40000 });
  e._handleKline(kline({ q: '400' }));
  assert.equal(e.liveCandles.get('TESTUSDT_1m').quoteVolume, 300);
});
test('minute reference preserves previous close across early updates and opening price gaps', () => {
  const e = engine(), alerts = [];
  e._handleMiniTickers([{ s: 'TESTUSDT', c: '100', q: '11000000', E: minute }]);
  e.on('radarAlert', a => alerts.push(a));
  e._handleKline({ ...kline({ t: minute - 60000, T: minute - 1, c: '100', x: true }), E: minute });
  alerts.length = 0;
  e._handleKline({ ...kline({ o: '101', c: '101' }), E: minute + 1000 });
  e._handleKline(kline({ o: '101', c: '101' }));
  assert.equal(alerts.length, 1); assert.equal(alerts[0].type, 'm1premium');
});
test('warmup coalesces simultaneous requests, respects limit and refreshes stale history', async () => {
  const e = engine(); let calls = 0;
  e.safeFetch = async () => { calls++; await Promise.resolve(); return rawBars(); };
  const [a, b] = await Promise.all([e.getKlines('TESTUSDT', '1m', 250), e.getKlines('TESTUSDT', '1m', 20)]);
  assert.equal(calls, 1); assert.equal(a.length, 250); assert.equal(b.length, 20);
  e.klineFetchedAt.set('TESTUSDT_1m', clockNow - 31000);
  await e.getKlines('TESTUSDT', '1m', 250); assert.equal(calls, 2);
});
test('live WS candle wins over a REST response started before it', async () => {
  const e = engine(); let resolve;
  e.safeFetch = () => new Promise(r => { resolve = r; });
  const pending = e.getKlines('TESTUSDT', '1m', 251);
  e._handleKline(kline({ q: '456' }));
  resolve(rawBars());
  const result = await pending;
  assert.equal(result.at(-1).quoteVolume, 456);
});
test('gaps after reconnect force backfill despite fresh latest WS data', async () => {
  const e = engine(); let calls = 0;
  e.safeFetch = async () => { calls++; return rawBars(); };
  await e.getKlines('TESTUSDT', '1m', 251);
  e.klineBuffers.get('TESTUSDT_1m').buffer.splice(100, 1);
  e._handleKline(kline());
  await e.getKlines('TESTUSDT', '1m', 250); assert.equal(calls, 2);
});
test('snapshot volume ignores later REST volume and matches correct previous minute', async () => {
  const e = engine(), history = bars();
  history.at(-2).close = 100; history.at(-2).quoteVolume = 100;
  history.at(-1).quoteVolume = 99999;
  e.getKlines = async () => history;
  const { m } = manager(e);
  const metric = await m._computeM1Metrics({ symbol: 'TESTUSDT', timestamp: minute + 45000, candle: { openTime: minute, close: 101, quoteVolume: 250 } });
  assert.equal(metric.volDelta, 150); assert.ok(Math.abs(metric.pct - 1) < 1e-9);
});
test('M1 skips missing snapshots, zero previous volume and insufficient history', async () => {
  const e = engine(), history = bars(); e.getKlines = async () => history;
  const { m } = manager(e), alert = { symbol: 'TESTUSDT', timestamp: minute + 45000, candle: { openTime: minute, close: 101, quoteVolume: 250 } };
  assert.equal(await m._computeM1Metrics({ ...alert, candle: null }), null);
  history.at(-2).quoteVolume = 0; assert.equal(await m._computeM1Metrics(alert), null);
  e.getKlines = async () => history.slice(-20); assert.equal(await m._computeM1Metrics(alert), null);
});
test('final candle message delivered just after minute rollover retains its own minute', async () => {
  const e = engine(), history = bars(); history.at(-2).quoteVolume = 100;
  e.getKlines = async () => history;
  const { m } = manager(e);
  const metric = await m._computeM1Metrics({ symbol: 'TESTUSDT', timestamp: minute + 60001, candle: { openTime: minute, close: 101, quoteVolume: 250 } });
  assert.equal(metric.volDelta, 150);
});
test('undefined StochRSI cannot become a fabricated zero in an M1 card', async () => {
  const e = engine(), data = bars();
  data.forEach((k, i) => { k.close = 100 + i; });
  e.getKlines = async () => data;
  const { m } = manager(e);
  const result = await m._computeM1Metrics({ symbol: 'TESTUSDT', timestamp: minute + 45000, candle: { openTime: minute, close: 351, quoteVolume: 250 } });
  assert.equal(result, null);
});
test('ring history remains bounded to 250 closed bars plus the live bar', async () => {
  const e = engine(); e.safeFetch = async () => rawBars();
  await e.getKlines('TESTUSDT', '1m', 251);
  const buffer = e.klineBuffers.get('TESTUSDT_1m');
  for (let i = 1; i <= 500; i++) buffer.push({ ...buffer.latest, openTime: minute + i * 60000, closeTime: minute + (i + 1) * 60000 - 1 });
  assert.equal(buffer.length, 251); assert.equal(buffer.latest.openTime, minute + 500 * 60000);
});
test('V3 computes quote volume surge from the prior 20 closed candles, never fallback 18.5', async () => {
  const e = engine(); e.getKlines = async () => bars();
  const { m, bots } = manager(e);
  await m._handleRadarAlert({ type: 'v3', symbol: 'TESTUSDT', volUsd: 11000000, timestamp: minute + 59999, candle: { openTime: minute, isClosed: true, quoteVolume: 150 } });
  assert.equal(bots.get('v3').signals[0].hacimChange, '+50.00%');
  await m._handleRadarAlert({ type: 'v3', symbol: 'BADUSDT', volUsd: 11000000, timestamp: minute + 59999 });
  assert.equal(bots.get('v3').signals.length, 1);
});
test('funding uses percentage points and actual funding countdown', async () => {
  const { m, bots } = manager();
  await m._handleRadarAlert({ type: 'fr', symbol: 'TESTUSDT', timestamp: minute, fundingRate: -0.001, prevFundingRate: 0.0001, nextFundingTime: minute + 1800000 });
  const signal = bots.get('fr').signals[0];
  assert.equal(signal.difference, '-0.1100%'); assert.equal(signal.timeRemaining, '00:30:00');
});
test('closed metrics exclude forming candle and reject gaps', async () => {
  const e = engine(), data = bars(); e.getKlines = async () => data;
  const { m } = manager(e);
  const result = await m._closedMetrics('TESTUSDT', '1m', minute + 45000);
  assert.equal(result.last.openTime, minute - 60000);
  data[150].openTime += 5;
  assert.equal(await m._closedMetrics('TESTUSDT', '1m', minute + 45000), null);
});
test('DIV uses valid hourly history without requiring 250 days or unrelated 5m history', async () => {
  const e = engine(); e.getKlines = async () => [];
  const { m, bots } = manager(e);
  m._closedMetrics = async (symbol, tf) => tf !== '1h' ? null : {
    rsi: 30, srsiK: 15, divergence: { hasBullDiv: true },
    last: { openTime: minute - 3600000, closeTime: minute - 1, close: 101 }, previous: { close: 100 }
  };
  await m._scanSymbol('TESTUSDT', minute);
  const signal = bots.get('div').signals[0];
  assert.equal(signal.boostValue, '+1.00%'); assert.equal(signal.prevPrice, '100');
  assert.equal(signal.rsi.d1, '—'); assert.equal(signal.srsi.h4, '—');
});
test('missing StochRSI is not coerced into an oversold 4S Sniper entry', async () => {
  const e = engine(); e.getKlines = async () => [];
  const { m, bots } = manager(e);
  m._closedMetrics = async () => ({ rsi: 20, srsiK: null, divergence: {}, last: { openTime: minute - 60000, closeTime: minute - 1, close: 100 }, previous: { close: 100 } });
  await m._scanSymbol('TESTUSDT', minute);
  assert.equal(bots.get('4ssniper').signals.length, 0);
});
test('a stopped warmup cannot overwrite the restarted engine history', async () => {
  const e = engine(); let resolve; e.safeFetch = () => new Promise(r => { resolve = r; });
  const request = e.getKlines('TESTUSDT', '1m', 250); e.stop();
  e.primeTickersFromRest = async () => {}; e.start(); resolve(rawBars());
  const result = await request;
  assert.equal(result.length, 0); assert.equal(e.klineBuffers.size, 0); e.stop();
});
test('unknown bots are rejected and explicit M1 imports do not fan out into Hammer', () => {
  const { m, bots } = manager();
  assert.equal(m.getBot('nonsense'), null);
  assert.throws(() => m.emitSignal({ botType: 'nonsense', coin: 'TESTUSDT' }));
  const r = m.emitSignal({ botType: 'm1a', coin: 'TESTUSDT' });
  assert.deepEqual(Array.from(r.affectedBots), ['m1a']); assert.equal(bots.get('hammerpro').signals.length, 0);
});
test('stopping during M1 computation cannot persist a later completed signal', async () => {
  const e = engine(), { m, bots } = manager(e); let resolve;
  m._computeM1Metrics = () => new Promise(r => { resolve = r; });
  const work = m._handleRadarAlert({ type: 'm1a', symbol: 'TESTUSDT', timestamp: minute + 45000, candle: { openTime: minute, close: 99, quoteVolume: 250 } });
  m.stopBackgroundEngine();
  resolve({ pct: -1, volDelta: 150, prevClose: 100, rsi: 20, stochK: 10, stochD: 15 }); await work;
  assert.equal(bots.get('m1a').signals.length, 0);
});
test('late old-socket close after stop/start cannot schedule extra reconnects', async () => {
  const e = engine(); e.primeTickersFromRest = async () => {};
  e.start(); e.stop(); e.start(); await new Promise(setImmediate);
  assert.equal(e.reconnectTimers.size, 0); e.stop();
});
test('manager restart removes its own listeners instead of duplicating radar processing', () => {
  const e = engine(); e.start = () => {}; e.stop = () => {};
  const { m } = manager(e);
  m.startBackgroundEngine(); m.stopBackgroundEngine(); m.startBackgroundEngine();
  assert.equal(e.listenerCount('radarAlert'), 1); assert.equal(e.listenerCount('candleClosed'), 1); m.stopBackgroundEngine();
});
test('stopped REST queue rejects new work and rejects impossible request weights', async () => {
  const e = engine(); await assert.rejects(e.safeFetch('x', 1201)); e.stop(); await assert.rejects(e.safeFetch('x'));
});
test('745-symbol radar load remains bounded and does not synthesize signals', () => {
  const e = engine(); let alerts = 0; e.on('radarAlert', () => alerts++);
  const batch = Array.from({ length: 745 }, (_, i) => ({ s: `T${i}USDT`, c: '100', q: '10000000', E: minute }));
  const start = performance.now();
  for (let i = 0; i < 20; i++) e._handleMiniTickers(batch);
  assert.equal(e.tickerMap.size, 745); assert.equal(e.subscriptions.size, 745); assert.equal(alerts, 0);
  assert.ok(performance.now() - start < 2000);
});
test('kline socket subscriptions respect Binance 180-stream group and 40-stream payload limits', () => {
  const sentPayloads = [];
  class RecordingSocket extends FakeSocket {
    constructor(url) { super(url); this.readyState = FakeSocket.OPEN; }
    send(msg) { super.send(msg); sentPayloads.push(JSON.parse(msg)); }
  }
  const timers = [];
  const e = load('services/market-data-engine.service.js', { ws: RecordingSocket }, {
    Date: ReplayDate,
    setTimeout: fn => { timers.push(fn); return timers.length; },
    clearTimeout() {}
  });
  e.isRunning = true;
  for (let i = 0; i < 420; i++) e._subscribeKline(`SYM${i}USDT`, '1m');
  while (timers.length) timers.shift()();
  assert.equal(e.klineSockets.length, 3);
  assert.ok(e.klineSockets.every(g => g.streams.size <= 180));
  assert.ok(sentPayloads.length >= 11);
  assert.ok(sentPayloads.every(p => p.method === 'SUBSCRIBE' && p.params.length <= 40));
  e.stop();
});
