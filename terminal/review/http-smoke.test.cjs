'use strict';

// Real Express + HTTP requests, isolated filesystem, zero Binance connections.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');

test('real HTTP application smoke with isolated data and stopped market engine', async t => {
  const tempRoot = path.resolve(os.tmpdir());
  const fixtureDir = fs.mkdtempSync(path.join(tempRoot, 'alpha-terminal-http-'));
  const previousDataDir = process.env.TERMINAL_DATA_DIR;
  const originalGet = https.get;
  const originalRequest = https.request;
  let networkAttempts = 0;
  let server;
  https.get = https.request = () => { networkAttempts++; throw new Error('Binance network use is forbidden in this smoke test'); };
  process.env.TERMINAL_DATA_DIR = fixtureDir;
  fs.writeFileSync(path.join(fixtureDir, 'signals_history.json'), JSON.stringify({ signals: [] }));
  fs.writeFileSync(path.join(fixtureDir, 'treasury_ledger.json'), JSON.stringify({ initialCapital: 25, trades: [] }));

  function cleanup() {
    https.get = originalGet;
    https.request = originalRequest;
    if (previousDataDir === undefined) delete process.env.TERMINAL_DATA_DIR;
    else process.env.TERMINAL_DATA_DIR = previousDataDir;
    const resolvedFixture = path.resolve(fixtureDir);
    if (path.dirname(resolvedFixture) !== tempRoot || !path.basename(resolvedFixture).startsWith('alpha-terminal-http-')) {
      throw new Error('Unexpected smoke fixture cleanup path');
    }
    fs.rmSync(resolvedFixture, { recursive: true, force: true });
  }

  try {
    const app = require('../terminal-server');
    const manager = require('../bots');
    const engine = require('../services/market-data-engine.service');
    assert.equal(manager.isEngineRunning, false);
    assert.equal(engine.isRunning, false);
    server = await new Promise((resolve, reject) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      listener.once('error', reject);
    });
    const port = server.address().port;
    const request = (url, { method = 'GET', body, headers = {} } = {}) => new Promise((resolve, reject) => {
      const payload = body === undefined ? undefined : JSON.stringify(body);
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers: { ...(payload ? { 'Content-Type': 'application/json' } : {}), ...headers }, timeout: 5000 }, res => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { text += chunk; });
        res.on('error', reject);
        res.on('end', () => {
          let data = null;
          if (res.headers['content-type']?.includes('application/json')) data = JSON.parse(text);
          resolve({ status: res.statusCode, text, data });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('Local smoke request timeout')));
      req.end(payload);
    });

    await t.test('homepage and official-metadata endpoint are served', async () => {
      const home = await request('/');
      assert.equal(home.status, 200);
      assert.match(home.text, /ALPHA|Alpha|alpha/);
      const info = await request('/api/exchange-info');
      assert.equal(info.status, 200);
      assert.equal(info.data.BTCUSDT.tickSize, '0.10');
    });

    await t.test('known bot has no fabricated initial cards; unknown bot is 404', async () => {
      const known = await request('/api/signals?bot=m1a');
      assert.equal(known.status, 200);
      assert.equal(known.data.count, 0);
      assert.deepEqual(known.data.signals, []);
      assert.equal((await request('/api/signals?bot=unknown-bot')).status, 404);
    });

    await t.test('archive route validates symbol and lookback and serves empty history', async () => {
      assert.equal((await request('/api/signals/coin-history?symbol=BTCUSDT&days=-1')).status, 400);
      assert.equal((await request('/api/signals/coin-history?symbol=INVALID')).status, 400);
      const history = await request('/api/signals/coin-history?symbol=BTCUSDT&days=60');
      assert.equal(history.status, 200);
      assert.equal(history.data.count, 0);
    });

    await t.test('ledger route returns the fixture and rejects invalid numeric writes', async () => {
      const ledger = await request('/api/ledger/trades');
      assert.equal(ledger.status, 200);
      assert.equal(ledger.data.stats.currentBalance, 25);
      assert.deepEqual(ledger.data.trades, []);
      const invalid = await request('/api/ledger/trades', { method: 'POST', body: { coin: 'BTC', profitUsd: 'NaN' } });
      assert.equal(invalid.status, 400);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixtureDir, 'treasury_ledger.json'), 'utf8')).trades, []);
    });

    await t.test('unconfigured Binance account performs no signed network requests', async () => {
      const status = await request('/api/binance-read/status');
      assert.equal(status.status, 200);
      assert.equal(status.data.configured, false);
      assert.equal(status.data.apiKeyMasked, null);
      const positions = await request('/api/binance-read/positions');
      assert.equal(positions.status, 200);
      assert.deepEqual(positions.data.positions, []);
    });

    await t.test('ingestion rejects malformed/unknown targets and reports filtered signals', async () => {
      const missing = await request('/api/signals/emit', { method: 'POST', body: {} });
      assert.equal(missing.status, 400);
      const unknown = await request('/api/signals/emit', { method: 'POST', body: { symbol: 'BTCUSDT', botId: 'unknown-bot', price: '100' } });
      assert.equal(unknown.status, 400);
      const filtered = await request('/api/signals/emit', { method: 'POST', body: { symbol: 'BTCUSDT', botId: 'm1a', price: '100' } });
      assert.equal(filtered.status, 422);
      assert.equal(filtered.data.success, false);
      assert.equal(filtered.data.rejected, true);
      assert.deepEqual(filtered.data.affectedBots, []);
    });

    await t.test('foreign Origin and rebinding Host cannot read or modify local APIs', async () => {
      const foreign = await request('/api/ledger/trades', { headers: { Origin: 'https://evil.example' } });
      assert.equal(foreign.status, 403);
      const rebinding = await request('/api/ledger/trades', { headers: { Host: `evil.example:${port}` } });
      assert.equal(rebinding.status, 403);
      const sameOrigin = await request('/api/ledger/trades', { headers: { Origin: `http://127.0.0.1:${port}` } });
      assert.equal(sameOrigin.status, 200);
    });

    assert.equal(manager.isEngineRunning, false);
    assert.equal(engine.isRunning, false);
    assert.equal(networkAttempts, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(fixtureDir, 'signals_history.json'), 'utf8')).signals, []);
  } finally {
    if (server) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    cleanup();
  }
});
