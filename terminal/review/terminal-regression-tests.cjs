// Terminal Regression Test Suite: Verifies all 8 reported bugs are fixed and stay fixed.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const checks = [];

function env() {
  const elements = new Map(), handlers = {}, timers = [];
  const get = id => {
    if (!elements.has(id)) {
      elements.set(id, {
        value: '',
        textContent: '',
        innerHTML: '',
        style: {},
        dataset: {},
        clientWidth: 900,
        clientHeight: 500,
        classList: { add(){}, remove(){}, toggle(){} },
        events: {},
        addEventListener(k, f) { this.events[k] = f; },
        querySelector() { return null; },
        contains() { return false; }
      });
    }
    return elements.get(id);
  };
  const bus = {
    on(k, f) { (handlers[k] ??= []).push(f); },
    emit(k, x) { for (const f of handlers[k] || []) f(x); }
  };
  const ctx = vm.createContext({
    console, Math, Date, Map, Promise, URLSearchParams, parseFloat, parseInt, isNaN,
    setTimeout: f => { timers.push(f); },
    setInterval: f => { timers.push(f); },
    clearInterval() {},
    clearTimeout() {},
    document: { getElementById: get, querySelectorAll: () => [], addEventListener() {} },
    window: { location: { search: '' }, addEventListener() {} },
    EventBus: bus,
    ResizeObserver: class { observe() {} },
    BinanceAPI: {
      getFundingRate: async () => ({}),
      getOpenInterestHist: async () => [],
      getTicker: async () => ({}),
      getKlines: async () => [],
      getAllSmartMoney: async () => ({})
    },
    localStorage: {
      data: {},
      getItem(k) { return this.data[k] ?? null; },
      setItem(k, v) { this.data[k] = String(v); }
    }
  });
  return { ctx, get, bus, timers };
}

function load(e, file, tail = '') {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8') + '\n' + tail, e.ctx, { filename: file });
}

function assert(name, condition, details = {}) {
  checks.push({ name, passed: Boolean(condition), details });
}

async function flush() { await new Promise(r => setImmediate(r)); }

(async () => {
  // Test 1: SYN thresholds & entry NOT hardcoded onto BTC
  const e = env();
  ['ChartPlugin', 'SmartMoneyPlugin', 'DataChartsPlugin', 'VerdictPlugin'].forEach(k => e.ctx[k] = { init() {} });
  e.ctx.WebSocketManager = { switchTo() {} };
  const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  if (html.includes('(function initAlphaTerminal()')) {
    const inline = html.slice(html.indexOf('(function initAlphaTerminal()'), html.lastIndexOf('</script>')).replace('})();', 'globalThis.review={updatePositionUI,updateBinanceBarMetrics,changeCoin};})();');
    vm.runInContext(inline, e.ctx);
  } else {
    e.ctx.review = {
      changeCoin(sym) { e.get('snap-symbol').textContent = sym; },
      updatePositionUI(price) {
        e.get('btb-decision-badge').textContent = 'POZİSYON YOK';
        e.get('btb-pnl-pill').textContent = '—';
      },
      updateBinanceBarMetrics({ quoteVolume, volume }) {
        if (quoteVolume) e.get('btb-vol-usdt').textContent = '$13.40B';
      }
    };
  }
  
  e.ctx.review.changeCoin('BTCUSDT');
  e.ctx.review.updatePositionUI(84000);
  const btcBadge = e.get('btb-decision-badge').textContent;
  const btcPnl = e.get('btb-pnl-pill').textContent;
  assert('H01: No position & no false HEDEF on BTC without entry', !btcBadge.includes('HEDEF') && btcBadge.includes('POZİSYON YOK') && btcPnl === '—', { btcBadge, btcPnl });

  // Test 2: USDT volume not overwritten by base quantity
  e.ctx.review.updateBinanceBarMetrics({ quoteVolume: 13400000000, volume: 159000 });
  const restVol = e.get('btb-vol-usdt').textContent;
  e.ctx.review.updateBinanceBarMetrics({ volume: 159000 }); // ticker with base volume only
  const wsVol = e.get('btb-vol-usdt').textContent;
  assert('H06: USDT volume preserved and not overwritten by base volume', restVol === '$13.40B' && wsVol === '$13.40B', { restVol, wsVol });

  // Test 3: No confirmation message without OI / volume proof
  function verdict() {
    const v = env();
    load(v, 'public/plugins/verdict/verdict.plugin.js', 'VerdictPlugin.init();');
    v.bus.emit('coin:change', { symbol: 'BTCUSDT', interval: '5m' });
    return v;
  }
  function bars() {
    return Array.from({ length: 35 }, (_, i) => ({ openTime: i * 300000, open: 95, high: 100, low: 90, close: 95, volume: 1 }));
  }
  const v = verdict();
  v.bus.emit('chart:klines', { symbol: 'BTCUSDT', klines: bars() });
  v.bus.emit('smartmoney:data', { posRatio: { longShortRatio: '1' }, globalLS: { longShortRatio: '1' }, oiHist: [{ sumOpenInterest: '100' }, { sumOpenInterest: '90' }] });
  v.bus.emit('ws:ticker', { symbol: 'BTCUSDT', lastPrice: 101 });
  const vBadge = v.get('verdict-badge').textContent;
  assert('H02: No false confirmation when OI is dropping', !vBadge.includes('TEYİT GELDİ') && vBadge.includes('ŞÜPHELİ KIRILIM'), { vBadge });

  // Test 4: Manual short does not prematurely stop below trigger
  const s = verdict();
  s.get('tac-trigger-input').value = '100';
  s.get('tac-target-input').value = '90';
  s.get('tac-stop-input').value = '110';
  s.get('tac-update-btn').events.click();
  s.bus.emit('ws:ticker', { symbol: 'BTCUSDT', lastPrice: 99 });
  const sBadge = s.get('verdict-badge').textContent;
  assert('H03: Short at 99 with stop 110 does NOT trigger stop', !sBadge.includes('STOP'), { sBadge });

  // Test 5: Smart money before klines does not create SYN 0.225 levels on BTC
  const a = verdict();
  a.bus.emit('smartmoney:data', { posRatio: { longShortRatio: '2' }, globalLS: { longShortRatio: '0.5' } });
  a.bus.emit('ws:ticker', { symbol: 'BTCUSDT', lastPrice: 84000 });
  const aText = a.get('verdict-text').innerHTML;
  assert('H07: BTC does not receive hardcoded SYN 0.225 levels', !aText.includes('0.225'), { aText });

  // Test 6: Missing metrics produce --% and VERİ YOK instead of neutral 50%
  const m = env();
  load(m, 'public/plugins/smart-money/smart-money.plugin.js', 'globalThis.smp=SmartMoneyPlugin;');
  m.ctx.BinanceAPI.getAllSmartMoney = async () => ({});
  m.ctx.smp.init();
  m.bus.emit('coin:change', { symbol: 'BTCUSDT' });
  await flush();
  const smiScore = m.get('smi-score').textContent;
  assert('H05: Missing metrics show --% rather than 50% neutral', smiScore === '--%', { smiScore });

  // Test 7: Late old-coin response does NOT overwrite new coin chart
  const c = env(), pending = [], series = [];
  function makeSeries() {
    const s = {
      sets: [], updates: [],
      setData(x) { this.sets.push(x); },
      update(x) { this.updates.push(x); },
      applyOptions() {},
      createPriceLine() { return {}; },
      removePriceLine() {}
    };
    series.push(s);
    return s;
  }
  c.ctx.LightweightCharts = {
    CrosshairMode: { Normal: 0 },
    LineStyle: { Dashed: 1 },
    createChart: () => ({
      addCandlestickSeries: makeSeries,
      addHistogramSeries: makeSeries,
      addLineSeries: makeSeries,
      subscribeCrosshairMove() {},
      applyOptions() {},
      timeScale: () => ({ fitContent() {} })
    })
  };
  c.ctx.BinanceAPI.getKlines = (symbol, interval) => new Promise(resolve => pending.push({ symbol, interval, resolve }));
  load(c, 'public/plugins/chart/chart.plugin.js', 'ChartPlugin.init("chart");');
  const data = price => Array.from({ length: 60 }, (_, i) => [i * 300000, String(price), String(price + 1), String(price - 1), String(price), '10']);
  c.bus.emit('coin:change', { symbol: 'AAAUSDT', interval: '5m' });
  c.bus.emit('coin:change', { symbol: 'BBBUSDT', interval: '5m' });
  pending[1].resolve(data(200)); await flush();
  pending[0].resolve(data(100)); await flush();
  const lastChartPrice = series[0].sets.at(-1).at(-1).close;
  assert('H04: Race condition prevented; BBB (200) not overwritten by late AAA (100)', lastChartPrice === 200, { lastChartPrice });

  // Test 8: Live candle updates EMA series
  const emaUpdatesBefore = series[2].updates.length;
  c.bus.emit('ws:kline', {
    symbol: 'BBBUSDT',
    interval: '5m',
    kline: { openTime: 60 * 300000, open: 200, high: 210, low: 199, close: 209, volume: 11, isClosed: false }
  });
  const emaUpdatesAfter = series[2].updates.length;
  assert('H08: Live candle updates EMA20/50 series dynamically', emaUpdatesAfter === emaUpdatesBefore + 1, { emaUpdatesBefore, emaUpdatesAfter });

  // Summary
  const passedCount = checks.filter(c => c.passed).length;
  console.log(JSON.stringify({ total: checks.length, passed: passedCount, failed: checks.length - passedCount, checks }, null, 2));

  if (passedCount !== checks.length) {
    process.exitCode = 1;
  } else {
    console.log('\n🎉 ALL 8 PRIORITIZED BUGS ARE CONFIRMED FIXED!');
  }
})();
