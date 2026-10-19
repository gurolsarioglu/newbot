// Isolated browser simulations: no live server, network, archive or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;
const flush = () => new Promise(resolve => setImmediate(resolve));
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
function environment() {
  const elements = new Map(), listeners = {}, sockets = [], charts = [];
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, innerHTML: '', textContent: '', value: '', style: {}, dataset: {},
      clientWidth: 800, clientHeight: 400, scrollTop: 0,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {}, appendChild() {},
      querySelector(selector) { return selector.startsWith('#') ? element(selector.slice(1)) : null; },
      querySelectorAll() { return []; }
    });
    return elements.get(id);
  }
  function series() {
    return { sets: [], updates: [], options: [],
      setData(data) { this.sets.push(data); }, update(data) { this.updates.push(data); },
      applyOptions(options) { this.options.push(options); }, createPriceLine() { return {}; },
      removePriceLine() {}, priceScale() { return { applyOptions() {} }; }
    };
  }
  const ctx = vm.createContext({ console, URLSearchParams, AbortController,
    setInterval() { return 1; }, clearInterval() {}, setTimeout() { return 1; }, clearTimeout() {},
    document: { getElementById: element, createElement: () => element(`created-${elements.size}`), querySelectorAll: () => [], addEventListener() {} },
    window: { addEventListener() {} },
    localStorage: { getItem: () => '[]', setItem() {} },
    ResizeObserver: class { observe() {} },
    EventBus: { on(key, cb) { (listeners[key] ??= []).push(cb); }, emit(key, data) { for (const cb of listeners[key] || []) cb(data); } },
    WebSocket: class {
      static OPEN = 1;
      constructor(url) { this.url = url; this.readyState = 1; this.closed = false; sockets.push(this); }
      close() { this.closed = true; }
    },
    LightweightCharts: { CrosshairMode: { Normal: 0 }, LineStyle: {}, createChart() {
      const instance = { series: [], options: [],
        addCandlestickSeries() { const item = series(); this.series.push(item); return item; },
        addHistogramSeries() { const item = series(); this.series.push(item); return item; },
        addLineSeries() { const item = series(); this.series.push(item); return item; },
        subscribeCrosshairMove() {}, applyOptions(options) { this.options.push(options); },
        timeScale() { return { fitContent() {}, subscribeVisibleLogicalRangeChange() {}, setVisibleLogicalRange() {} }; }
      };
      charts.push(instance); return instance;
    } },
    fetch: async () => ({ ok: true, json: async () => ({}) })
  });
  const load = (file, expression) => vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + `\n;globalThis.api = ${expression};`, ctx);
  return { ctx, element, sockets, charts, load, emit: ctx.EventBus.emit };
}
const bars = (price, increasing = false) => Array.from({ length: 40 }, (_, i) => {
  const p = price + (increasing ? i * price / 100 : 0);
  return [i * 60000, String(p), String(p * 1.01), String(p * .99), String(p), '10'];
});

(async () => {
  const renderer = environment();
  renderer.load('public/plugins/bot-hub/bot-renderer.js', 'BotRenderer');
  const card = renderer.ctx.api.generateSignalsHtml('m1a', [{ symbol: 'AAAUSDT', type: 'drop', dropValue: '-1%',
    volume: { m1: 0 }, rsi: { m1: 19.5, h1: 60 }, stochastic: '19/31', dateStr: '19.10.2026', time: '21:49' }]);
  check('M1-A preserves decimal minute RSI and zero volume', () => {
    assert.match(card, />19\.5<span/); assert.match(card, /card-field-val">0<\/span>/); assert.doesNotMatch(card, />195</);
  });
  check('M1-A includes the signal date', () => assert.match(card, /19\.10\.2026 21:49/));
  check('archived yesterday signal cannot retain a static Today label', () => assert.equal(renderer.ctx.api.getSignalDateLabel({ dateLabel: 'Bugün', dateStr: '01.01.2020' }), '01.01.2020'));
  const fallingVolume = renderer.ctx.api.generateSignalsHtml('v3', [{ symbol: 'AAAUSDT', hacimChange: '-90%' }]);
  check('negative volume is not marked as a surge', () => assert.doesNotMatch(fallingVolume, /Ekstrem Hacim/));

  const socket = environment(); socket.load('public/core/websocket.js', 'WebSocketManager');
  socket.ctx.api.connect('AAAUSDT', '15m'); const old = socket.sockets[0], oldOpen = old.onopen;
  socket.ctx.api.connect('BBBUSDT', '1m'); oldOpen();
  check('WebSocket subscribes to the requested chart timeframe', () => assert.match(old.url, /aaausdt@kline_15m/));
  check('stale socket open cannot close the active socket', () => assert.equal(socket.sockets[1].closed, false));

  const multi = environment(), pending = [];
  multi.ctx.SymbolRegistry = { getSymbol: () => null, getPrecision: () => 2, getMinMove: () => .01 };
  multi.ctx.fetch = url => new Promise(resolve => pending.push({ url, resolve }));
  multi.load('public/plugins/chart/multi-chart.plugin.js', 'MultiChartPlugin');
  multi.ctx.api.init(); const newLoad = multi.ctx.api.loadSymbol('MICROUSDT');
  for (const p of pending.slice(4)) p.resolve({ ok: true, json: async () => bars(.00001234, true) });
  await newLoad;
  for (const p of pending.slice(0, 4)) p.resolve({ ok: true, json: async () => bars(200) });
  await flush();
  const candles = multi.charts[0].series[0], bb = multi.charts[0].series[2], rsi = multi.charts[1].series[0];
  check('late old-symbol responses cannot overwrite multicharts', () => assert.ok(candles.sets.at(-1).at(-1).close < .001));
  check('unknown micro symbol retains price precision before registry loads', () => assert.ok(candles.options.at(-1).priceFormat.precision >= 8));
  check('monotonic rising RSI equals 100', () => assert.equal(rsi.sets.at(-1).at(-1).value, 100));
  const bbCount = bb.sets.length;
  multi.emit('ws:kline', { symbol: 'MICROUSDT', interval: '1m', kline: { openTime: 40 * 60000, open: .000017, high: .000018, low: .000016, close: .000017, volume: 1500 } });
  check('live candles refresh BB, RSI and current volume labels', () => {
    assert.equal(bb.sets.length, bbCount + 1); assert.equal(rsi.sets.at(-1).at(-1).time, 2400);
    assert.equal(multi.element('cell-vol-0').textContent, 'Vol 1.5K');
  });
  const updateCount = candles.updates.length;
  multi.emit('ws:kline', { symbol: 'MICROUSDT', interval: '1m', kline: { openTime: 1, close: 200, volume: 99 } });
  check('old candles are ignored before chart library mutation', () => assert.equal(candles.updates.length, updateCount));
  const flatLoad = multi.ctx.api.loadSymbol('FLATUSDT');
  for (const p of pending.slice(8)) p.resolve({ ok: true, json: async () => bars(1) });
  await flatLoad;
  check('flat RSI is neutral 50', () => assert.equal(rsi.sets.at(-1).at(-1).value, 50));

  const single = environment(); single.ctx.BinanceAPI = { getKlines: async () => bars(20) };
  single.load('public/plugins/chart/chart.plugin.js', 'ChartPlugin'); single.ctx.api.init('single');
  single.emit('coin:change', { symbol: 'AAAUSDT', interval: '5m' }); await flush();
  single.emit('ws:kline', { symbol: 'AAAUSDT', interval: '1m', kline: { openTime: 40 * 60000, open: 21, high: 22, low: 20, close: 21, volume: 20 } });
  check('single chart excludes other timeframe candles', () => assert.equal(single.charts[0].series[0].updates.length, 0));

  const watch = environment(); watch.ctx.fetch = async url => ({ ok: true, json: async () => url === '/api/watchlist'
    ? [{ symbol: 'AAAUSDT', price: '0.1234500', chgPct: 0, volUsd: 1000, fr: null, frInterval: null }] : {} });
  watch.load('public/plugins/watchlist/watchlist.plugin.js', 'WatchlistPlugin'); watch.ctx.api.init(); await flush();
  check('empty saved favorites remain empty', () => assert.equal(watch.ctx.api.isFavorite('BTCUSDT'), false));
  watch.sockets[0].onmessage({ data: JSON.stringify([{ s: 'AAAUSDT', c: '0.1234600', o: '0.12', q: '2500000' }]) });
  watch.ctx.api.search('');
  check('watchlist rerenders preserve raw price and live quote volume', () => {
    assert.match(watch.element('wl-tbody').innerHTML, /0\.1234600/); assert.match(watch.element('wl-tbody').innerHTML, /2\.50M/);
  });
  check('missing funding is not represented as zero or eight hours', () => {
    assert.doesNotMatch(watch.element('wl-tbody').innerHTML, /0\.0000%/); assert.match(watch.element('wl-tbody').innerHTML, /wl-fr-badge">—/);
  });

  const snapshot = environment(), requests = [];
  snapshot.ctx.fetch = url => new Promise(resolve => requests.push({ url, resolve }));
  snapshot.load('public/plugins/sentiment-modal/sentiment-modal.plugin.js', 'TickerSnapshot');
  const a = snapshot.ctx.api.updateSymbol('AAAUSDT'), b = snapshot.ctx.api.updateSymbol('BBBUSDT');
  const respond = (p, price) => p.resolve({ ok: true, json: async () => ({ lastPrice: price, lastFundingRate: '.001', openInterest: '10' }) });
  for (const p of requests.slice(3)) respond(p, '2.000'); await b;
  for (const p of requests.slice(0, 3)) respond(p, '1.000'); await a;
  check('late ticker responses cannot overwrite the selected symbol', () => assert.equal(snapshot.element('snap-price').textContent, '2.000'));
  snapshot.ctx.api.openModal(); requests.at(-1).resolve({ ok: true, json: async () => ({ orderBook: { bidPct: null, askPct: null }, topPosition: null }) });
  await flush();
  check('missing sentiment shows no data and clears ratio bars', () => {
    assert.equal(snapshot.element('modal-val-ob-b').textContent, 'VERİ YOK'); assert.equal(snapshot.element('modal-bar-ob').style.width, '0%');
    assert.equal(snapshot.element('snap-ls-lbl-l').textContent, 'VERİ YOK');
  });

  const popup = environment(), popupRequests = [];
  popup.ctx.window.location = { search: '?bot=m1a', pathname: '/bot-window.html' };
  popup.ctx.window.history = { replaceState() {} };
  popup.ctx.BotRenderer = renderer.ctx.api;
  popup.ctx.fetch = url => new Promise(resolve => popupRequests.push({ url, resolve }));
  const html = fs.readFileSync(path.join(root, 'public/bot-window.html'), 'utf8');
  const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1]
    .replace(/\s+init\(\);\s*\}\)\(\);\s*$/, '\n globalThis.api={fetchSignals,switchBot,getSignals:()=>currentSignals};})();');
  vm.runInContext(inline, popup.ctx);
  const oldBot = popup.ctx.api.fetchSignals(); popup.ctx.api.switchBot('v3');
  popupRequests[1].resolve({ ok: true, json: async () => ({ signals: [{ symbol: 'NEWUSDT' }] }) }); await flush();
  popupRequests[0].resolve({ ok: true, json: async () => ({ signals: [{ symbol: 'OLDUSDT' }] }) }); await oldBot;
  check('late old-bot response cannot populate a different bot window', () => assert.equal(popup.ctx.api.getSignals()[0].symbol, 'NEWUSDT'));

  const hub = environment(); hub.ctx.BotRenderer = renderer.ctx.api;
  hub.ctx.fetch = async url => {
    if (url.endsWith('hammerpro')) throw new Error('isolated network failure');
    return { ok: true, json: async () => ({ signals: [{ symbol: 'LIVEUSDT', hacimChange: '+90%', hacim24s: '2M', rsi: {}, srsi: {} }] }) };
  };
  hub.load('public/plugins/bot-hub/bot-hub.plugin.js', 'BotHubPlugin'); hub.ctx.api.init(); await flush();
  hub.ctx.api.switchBot('v3');
  check('one bot fetch failure does not freeze successful bot feeds', () => assert.match(hub.element('bot-signals-scroll').innerHTML, /LIVEUSDT/));
  console.log(`\n${passed} frontend checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
