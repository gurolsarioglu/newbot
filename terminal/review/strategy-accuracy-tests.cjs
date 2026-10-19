// Deterministic offline checks. All persistence is replaced before any bot is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const modules = new Map();
let archive = [];
const records = [];
const store = {
  getRecentSignalsByBot: id => archive.filter(signal => signal.botId === id),
  recordSignal: (botId, signal) => records.push({ ...signal, botId })
};
function load(relative) {
  const file = path.join(root, relative);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} };
  modules.set(file, module);
  const nativeRequire = createRequire(file);
  const isolatedRequire = name => {
    if (name.endsWith('signal-store.service')) return store;
    if (name.includes('base-bot')) return load('bots/base/base-bot.js');
    if (name.includes('market-data-engine.service')) throw new Error('Network must not be used by offline checks');
    return nativeRequire(name);
  };
  const wrapper = vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, { filename: file });
  wrapper(isolatedRequire, module, module.exports);
  return module.exports;
}
const quant = load('services/quant-indicators.service.js');
const BaseBot = load('bots/base/base-bot.js');
const checks = [];
async function test(name, run) {
  try { await run(); checks.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, passed: false }); console.error(`FAIL ${name}: ${error.stack}`); }
}
function close(actual, expected, tolerance = 1e-10) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`); }

(async () => {
  await test('Wilder RSI retains exact precision through smoothing', () => {
    const closes = [44.34,44.09,44.15,43.61,44.33,44.83,45.10,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
    close(quant.calculateRSI(closes).rsi, 70.46413502109705);
    assert.equal(quant.calculateRSI(Array.from({ length: 30 }, (_, i) => i + 1)).rsi, 100);
    assert.equal(quant.calculateRSI(Array.from({ length: 30 }, (_, i) => 30 - i)).rsi, 0);
  });
  await test('StochRSI smoothing matches independently calculated moving averages', () => {
    const rsi = Array.from({ length: 50 }, (_, i) => 50 + 25 * Math.sin(i / 3.7));
    const raw = rsi.slice(13).map((value, offset) => {
      const window = rsi.slice(offset, offset + 14);
      return (value - Math.min(...window)) / (Math.max(...window) - Math.min(...window)) * 100;
    });
    const sma = (values, period) => values.slice(period - 1).map((_, i) => values.slice(i, i + period).reduce((a, b) => a + b, 0) / period);
    const k = sma(raw, 3);
    const d = sma(k, 3);
    const actual = quant.calculateStochRSI(rsi);
    close(actual.k, k.at(-1));
    close(actual.d, d.at(-1));
  });
  await test('Flat RSI has unknown StochRSI instead of an invented neutral 50 or zero', () => {
    const flat = quant.calculateStochRSI(Array(40).fill(50));
    assert.equal(flat.k, null);
    assert.equal(flat.d, null);
    assert.ok(flat.kSeries.every(value => value === null));
    assert.ok(flat.dSeries.every(value => value === null));
    const actualZero = quant.calculateStochRSI(Array.from({ length: 40 }, (_, i) => 80 - i));
    assert.equal(actualZero.k, 0);
    assert.equal(actualZero.d, 0);
    const bot = load('bots/strategies/m1-premium.bot.js');
    assert.equal(bot.ingest({ symbol: 'BTCUSDT', price: '100.00', boost: 2, rsi: 70, stochK: flat.k }), null);
  });
  await test('Unknown Stoch inputs do not enter K/D sums as zero and recover only after valid windows', () => {
    const prefix = Array(30).fill(50);
    const notEnoughK = quant.calculateStochRSI(prefix.concat(51, 52));
    assert.equal(notEnoughK.k, null);
    assert.equal(notEnoughK.d, null);
    const kOnly = quant.calculateStochRSI(prefix.concat(51, 52, 53));
    assert.equal(kOnly.k, 100);
    assert.equal(kOnly.d, null);
    const recovered = quant.calculateStochRSI(prefix.concat(51, 52, 53, 54, 55));
    assert.equal(recovered.k, 100);
    assert.equal(recovered.d, 100);
  });
  await test('Insufficient indicator histories remain unknown rather than fallback observations', () => {
    assert.equal(quant.calculateRSI([1, 2, 3]).rsi, null);
    assert.equal(quant.calculateRSI(Array.from({ length: 15 }, (_, i) => i + 1)).rsiSma, null);
    assert.equal(quant.calculateStochRSI([20, 30]).k, null);
    assert.equal(quant.calculateWaveTrend([]).wt1, null);
    assert.equal(quant.calculateEMA([1, 2], 20), null);
    assert.equal(quant.calculatePivots(null, 100).p, null);
    assert.equal(quant.calculateDeltaVolume([10, 20]), null);
    assert.equal(quant.calculateDeltaVolume([...Array(20).fill(0), 100]), null);
    assert.equal(quant.calculateRSI([1, 2, NaN], 2).rsi, null);
    assert.equal(quant.calculateStochRSI(Array(20).fill(50), 0).d, null);
  });
  await test('All-metrics preserves valid RSI/EMA while flat StochRSI and WaveTrend remain unavailable', () => {
    const bars = Array.from({ length: 250 }, () => ({ open: 100, high: 101, low: 99, close: 100, volume: 1000 }));
    const result = quant.calculateAllMetrics(bars);
    assert.ok(result);
    assert.equal(result.rsi, 100);
    close(result.ema200, 100);
    assert.equal(result.srsiK, null);
    assert.equal(result.srsiD, null);
    assert.equal(result.wt1, null);
    assert.equal(result.wt2, null);
    assert.equal(result.wtCrossUp, false);
    assert.equal(result.wtOversold, false);
  });
  await test('EMA and pivots retain micro-coin price precision', () => {
    const prices = Array.from({ length: 250 }, (_, i) => 0.000001 + i * 0.000000001);
    let expected = prices[0];
    for (const price of prices.slice(1)) expected = 2 / 21 * price + 19 / 21 * expected;
    close(quant.calculateEMA(prices, 20), expected, 1e-18);
    const pivots = quant.calculatePivots({ high: 0.0000013, low: 0.0000011, close: 0.0000012 }, 0.0000012);
    close(pivots.p, 0.0000012, 1e-18);
    assert.ok(pivots.s1 > 0 && pivots.s2 > 0);
  });
  await test('20-bar volume baseline excludes the current candle', () => {
    assert.equal(quant.calculateDeltaVolume([...Array(20).fill(100), 250]), 150);
    assert.equal(quant.calculateDeltaVolume([...Array(20).fill(100), 0]), -100);
  });
  await test('Pivot distance and volume thresholds are evaluated before display rounding', () => {
    const result = quant.calculatePivots({ high: 101, low: 99, close: 100 }, 100.504);
    close(result.pivotDistancePct, 0.504);
    assert.ok(result.pivotDistancePct > 0.5);
    const volume = quant.calculateDeltaVolume([...Array(20).fill(100), 124.999]);
    close(volume, 24.999);
    assert.ok(volume < 25);
  });
  await test('All-metrics refuses incomplete warm-up and invalid candle inputs', () => {
    const bars = Array.from({ length: 250 }, (_, i) => ({ open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i, volume: 1000 }));
    assert.equal(quant.calculateAllMetrics(bars.slice(0, 249)), null);
    assert.ok(quant.calculateAllMetrics(bars));
    bars[249].close = NaN;
    assert.equal(quant.calculateAllMetrics(bars), null);
  });
  await test('Pivot divergence emits only on its first confirmation, not every later candle', () => {
    const bars = Array.from({ length: 40 }, (_, i) => ({ low: 10, high: 20, close: 15, openTime: i * 60000 }));
    bars[32].low = 9;
    bars[37].low = 8;
    const rsi = Array(26).fill(50);
    rsi[32 - 14] = 20;
    rsi[37 - 14] = 25;
    const first = quant.detectPivotDivergence(bars, rsi);
    assert.equal(first.hasBullDiv, true);
    assert.equal(first.pivotOpenTime, 37 * 60000);
    assert.equal(first.confirmedAt, 39 * 60000);
    bars.push({ low: 10, high: 20, close: 15, openTime: 40 * 60000 });
    rsi.push(50);
    assert.equal(quant.detectPivotDivergence(bars, rsi).hasBullDiv, false);
  });
  await test('Bot preserves both raw-id and candle deduplication after a restart', () => {
    const timestamp = Date.now() - 1000;
    const signal = { symbol: 'BTCUSDT', timestamp, rawId: 'event-1', timeframe: '1m', candleOpenTime: 1790000000000 };
    const first = new BaseBot({ id: 'restart-test' });
    assert.ok(first.addSignal(signal));
    assert.equal(first.addSignal({ ...signal, rawId: 'event-2' }), null);
    assert.equal(first.canEmitSignal(' btcusdt ', '1m', signal.candleOpenTime, 0), false);
    archive = [{ ...signal, botId: 'restart-test' }];
    const restarted = new BaseBot({ id: 'restart-test' });
    assert.equal(restarted.addSignal({ ...signal, candleOpenTime: signal.candleOpenTime + 60000 }), null);
    assert.equal(restarted.canEmitSignal('BTCUSDT', '1m', signal.candleOpenTime + 60000, 60000), false);
    archive = [];
  });
  await test('Bot validates timestamps without poisoning dedup state and normalizes Istanbul time', () => {
    const bot = new BaseBot({ id: 'timestamp-test' });
    const signal = { symbol: ' btcusdt ', candleOpenTime: 0, timeframe: '1m', timestamp: NaN };
    assert.equal(bot.addSignal(signal), null);
    const result = bot.addSignal({ ...signal, timestamp: Date.UTC(2026, 9, 19, 23, 30), time: 'wrong', dateStr: 'wrong' });
    assert.equal(result.symbol, 'BTCUSDT');
    assert.equal(result.time, '02:30');
    assert.equal(result.dateStr, '20.10.2026');
    assert.equal(bot.canEmitSignal('BTCUSDT', '1m', 0), false);
    assert.equal(bot.addSignal({}), null);
  });
  const m1a = load('bots/strategies/m1a-drop.bot.js');
  await test('M1-A keeps zero volume/Stoch and source identity; absent metrics cannot create a signal', () => {
    assert.equal(m1a.ingest({ symbol: 'BTCUSDT', price: '100.00', position: 'Short' }), null);
    const source = { symbol: 'BTCUSDT', price: '100.00', boost: '1%', volume: 0, rsi: 0, stochK: 0, stochD: 0, rawId: 'm1-1', candleOpenTime: 1, timeframe: '1m' };
    const result = m1a.ingest(source);
    assert.ok(result);
    assert.equal(result.volume, '+0.00%');
    assert.equal(result.stochastic, '0/0 ⚠️');
    assert.equal(result.rsi, '0 ⚠️');
    assert.equal(result.rawId, 'm1-1');
    assert.equal(m1a.ingest(source), null);
    assert.equal(m1a.ingest({ ...source, rawId: 'different' }), null);
  });
  await test('All strategy ingesters handle absent data without synthetic signals', () => {
    for (const name of fs.readdirSync(path.join(root, 'bots/strategies')).filter(name => name.endsWith('.bot.js'))) {
      const bot = load(`bots/strategies/${name}`);
      assert.equal(bot.ingest(null), null, name);
      assert.equal(bot.ingest({}), null, name);
      assert.equal(bot.ingest({ symbol: 'BTCUSDT', price: '100', boost: '4%' }), null, name);
    }
  });
  await test('V3 uses the same numeric volume for validation and Turkish display', () => {
    const bot = load('bots/strategies/v3-volume.bot.js');
    const result = bot.ingest({ symbol: 'PEPEUSDT', volumeChange: 20, volume24h: '42.158.400' });
    assert.ok(result);
    assert.equal(result.hacim24s, '42.158.400 PEPE');
    assert.equal(bot.formatVolume24h(0, 'PEPE'), '0 PEPE');
    assert.equal(bot.formatVolume24h(undefined, 'PEPE'), '—');
    assert.equal(bot.ingest({ symbol: 'PEPEUSDT', volumeChange: Infinity, volume24h: 100000 }), null);
  });
  await test('Missing optional premium timeframes remain unavailable and 1m %D is not relabelled 5m SRSI', () => {
    const bot = load('bots/strategies/m1-premium.bot.js');
    const result = bot.ingest({ symbol: 'ETHUSDT', price: '100.00', boost: '2%', rsi: 70, stochK: 90, stochD: 40 });
    assert.ok(result);
    assert.equal(result.rsi.m5, '—');
    assert.equal(result.srsi.m5, '—');
    assert.equal(result.srsi.h1, '—');
  });
  await test('Oversold RSI alone is not divergence, and bearish previous price obeys signed return', () => {
    const bot = load('bots/strategies/divergence.bot.js');
    assert.equal(bot.ingest({ symbol: 'ETHUSDT', price: '100.0000', boost: '-2%', rsi1h: 28 }), null);
    const result = bot.ingest({ symbol: 'ETHUSDT', price: '100.0000', boost: '-2%', rsi1h: 65, divergence: { hasBearDiv: true } });
    assert.ok(result);
    assert.equal(result.dot, '🔴');
    close(Number(result.prevPrice), 102.0408, 1e-8);
    assert.equal(result.pivot, '—');
  });
  await test('Hammer does not invent WaveTrend, pivot, high-timeframe RSI or Stoch', () => {
    const bot = load('bots/strategies/hammer-pro-plus.bot.js');
    const result = bot.ingest({ symbol: 'ETHUSDT', price: '100.00', boost: 2, rsi1m: 20, rsi5m: 25, stochK: 0 });
    assert.ok(result);
    assert.equal(result.wt, '—');
    assert.equal(result.pivot, '—');
    assert.equal(result.rsi.h1, '—');
    assert.equal(result.srsi.m1, '0');
    assert.equal(result.srsi.m5, '—');
    assert.equal(bot.parsePivotDistance(0), 0);
  });
  await test('Bearish WaveTrend crosses cannot confirm a bullish Hammer reversal', () => {
    const bot = load('bots/strategies/hammer-pro.bot.js');
    const source = { symbol: 'ETHUSDT', price: '100.00', boost: 2, rsi1m: 40, rsi5m: 25, wt: '1m 🔴 Cross' };
    assert.equal(bot.ingest(source), null);
    assert.ok(bot.ingest({ ...source, wt: '1m 🟢 Cross' }));
  });
  await test('Unknown higher-timeframe RSI cannot award extra Hammer confluence stars', () => {
    const bot = load('bots/strategies/hammer-pro-plus.bot.js');
    const result = bot.ingest({ symbol: 'SOLUSDT', price: '100.00', boost: 3, rsi1m: 20, rsi1h: 35, wtCrossUp: true, pivot: 0.1 });
    assert.ok(result);
    assert.equal(result.rsi.m5, '—');
    assert.equal(result.stars, '⭐⭐');
  });
  await test('Premium divergence keeps its observed timeframe', () => {
    const bot = load('bots/strategies/m1-premium.bot.js');
    const result = bot.ingest({ symbol: 'SOLUSDT', price: '100.00', boost: 2, rsi: 70, stochK: 90, rsi1hDiv: true });
    assert.ok(result);
    assert.equal(result.divergence, '1h ✅');
  });
  await test('Funding never invents a previous rate, sign flip or funding schedule', () => {
    const bot = load('bots/strategies/funding-rate.bot.js');
    const result = bot.ingest({ symbol: 'BTCUSDT', fundingRate: '-0.01%' });
    assert.ok(result);
    assert.equal(result.previousFunding, '—');
    assert.equal(result.difference, '—');
    assert.equal(result.timeRemaining, '—');
    assert.equal(result.alertText, 'Negative Funding Alert');
    const zero = bot.ingest({ symbol: 'ETHUSDT', fundingRate: 0, previousFunding: '-0.3%' });
    assert.ok(zero);
    assert.equal(zero.fundingRate, '+0.0000%');
    const countdown = bot.calculateFundingCountdown(Date.now() + 3600000);
    assert.match(countdown, /^(01:00:00|00:59:59)$/);
  });
  const derivatives = load('services/derivatives-enricher.service.js');
  await test('Failed derivatives endpoints return unavailable metrics and do not cache fabricated data', async () => {
    derivatives._fetchJson = async () => { throw new Error('offline fixture'); };
    const result = await derivatives.enrich('BTCUSDT');
    for (const field of ['topTraderLongRatio', 'topTraderChange', 'globalLongRatio', 'oiDeltaPct', 'currentOi', 'fundingRate', 'nextFundingTime']) assert.equal(result[field], null, field);
    assert.equal(result.isWhaleAccumulating, false);
    assert.equal(derivatives.cache.size, 0);
  });
  await test('Derivatives preserve zero values, compute contract OI change and reuse concurrent/cache requests', async () => {
    let calls = 0;
    derivatives._fetchJson = async url => {
      calls++;
      await new Promise(resolve => setImmediate(resolve));
      if (url.includes('topLong')) return [{ longAccount: '0.60' }, { longAccount: '0.65', shortAccount: '0.35', longShortRatio: '1.857' }];
      if (url.includes('globalLong')) return [{ longAccount: '0', shortAccount: '1', longShortRatio: '0' }];
      return [{ sumOpenInterest: '100' }, { sumOpenInterest: '110' }];
    };
    const [first, second] = await Promise.all([
      derivatives.enrich('BTCUSDT', { fundingRate: 0, nextFundingTime: 1000 }),
      derivatives.enrich('BTCUSDT', { fundingRate: -0.0002, nextFundingTime: 2000 })
    ]);
    assert.equal(calls, 3);
    assert.equal(first.fundingRate, 0);
    assert.equal(second.fundingRate, -0.0002);
    assert.equal(second.globalLongRatio, 0);
    close(second.oiDeltaPct, 10);
    close(second.topTraderChange, 5);
    const cached = await derivatives.enrich('BTCUSDT', { fundingRate: 0.0003, nextFundingTime: 3000 });
    assert.equal(cached.fundingRate, 0.0003);
    assert.equal(calls, 3);
    assert.equal(await derivatives.enrich('BTCUSDT&bad=1'), null);
  });
  const passed = checks.filter(check => check.passed).length;
  console.log(`\n${passed}/${checks.length} offline strategy/indicator checks passed; persistence calls captured in memory: ${records.length}.`);
  if (passed !== checks.length) process.exitCode = 1;
})();
