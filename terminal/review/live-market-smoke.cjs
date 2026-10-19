// Optional public Binance integration. No account keys, bot manager or archive writes.
const assert = require('node:assert/strict');
const registry = require('../services/symbol-registry.service');
const engine = require('../services/market-data-engine.service');
const quant = require('../services/quant-indicators.service');
const { setTimeout: delay } = require('node:timers/promises');
(async () => {
  try {
    await registry.init();
    assert.ok(registry.isInitialized, 'Live exchangeInfo must load; fallback metadata is not a successful live test');
    const bars = await engine.getKlines('BTCUSDT', '1m', 251);
    assert.equal(bars.length, 251);
    const closed = bars.filter(k => k.closeTime < Date.now()).slice(-250);
    const metrics = quant.calculateAllMetrics(closed);
    assert.ok(metrics && Number.isFinite(metrics.rsi) && Number.isFinite(metrics.ema200));
    engine.isRunning = true;
    // Subscribe only BTC for this test; do not start the all-market/bot engine.
    for (const stream of engine.subscriptions) engine._assignStream(stream);
    const deadline = Date.now() + 15000;
    while (!engine.liveCandles.has('BTCUSDT_1m') && Date.now() < deadline) await delay(250);
    const candle = engine.liveCandles.get('BTCUSDT_1m');
    assert.ok(candle, 'Live kline WebSocket must deliver a real message');
    assert.ok(candle.quoteVolume >= 0 && candle.close > 0);
    assert.ok(Math.abs(Date.now() - candle.eventTime) < 15000);
    let closedQuoteVolumeMatch;
    if (process.argv.includes('--closed-candle')) {
      console.log('Waiting for one real BTC 1m candle to close, then comparing WS quote volume with REST...');
      const final = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { engine.off('candleClosed', listener); reject(new Error('No closed candle within 65 seconds')); }, 65000);
        const listener = event => { if (event.symbol === 'BTCUSDT' && event.interval === '1m') { clearTimeout(timer); engine.off('candleClosed', listener); resolve(event.candle); } };
        engine.on('candleClosed', listener);
      });
      const raw = await engine.safeFetch(`https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval=1m&startTime=${final.openTime}&endTime=${final.closeTime}&limit=1`, 1);
      assert.equal(Number(raw[0][0]), final.openTime);
      const difference = Math.abs(Number(raw[0][7]) - final.quoteVolume);
      assert.ok(difference <= Math.max(1e-8, final.quoteVolume * 1e-12), 'Same closed WS and REST candle must have matching quote volume');
      closedQuoteVolumeMatch = true;
    }
    console.log(JSON.stringify({ success: true, symbols: registry.getAllSymbols().length, warmupCandles: bars.length, rsi: metrics.rsi, liveCandleOpenTime: candle.openTime, liveQuoteVolume: candle.quoteVolume, volumeSource: 'Binance kline q (USDT)', closedQuoteVolumeMatch }, null, 2));
  } finally { engine.stop(); clearInterval(registry.refreshTimer); }
})().catch(err => { console.error('Live Binance smoke failed:', err.message); process.exitCode = 1; });
