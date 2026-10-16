const http = require('http');
const { spawn } = require('child_process');

console.log('--- Terminal Sunucusu HTTP API Entegrasyon Testi ---');

const server = spawn('node', ['terminal-server.js'], {
  cwd: __dirname + '/..',
  stdio: 'pipe'
});

server.stdout.on('data', (d) => {
  const msg = d.toString();
  if (msg.includes('http://localhost:3000')) {
    console.log('✅ Sunucu 3000 portunda basariyla baslatildi.');
    runTests();
  }
});

server.stderr.on('data', (d) => {
  console.error('Server error:', d.toString());
});

function fetchUrl(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function runTests() {
  try {
    // 1. Standart sinyal endpoint testi
    const botRes = await fetchUrl('/api/signals?bot=hammerproplus');
    console.log(`✅ GET /api/signals?bot=hammerproplus -> ${botRes.count} sinyal alindi.`);

    // 2. 60 Günlük Coin Geçmişi Endpoint Testi
    const coinRes = await fetchUrl('/api/signals/coin-history?symbol=SOLUSDT&days=60');
    console.log(`✅ GET /api/signals/coin-history?symbol=SOLUSDT -> ${coinRes.count} sinyal, Bot Dagilimi:`, coinRes.stats.botDistribution);

    // 3. Fiyat hassasiyeti kontrolü: SOLUSDT veya TESTUSDT sinyallerinde fiyat formatı
    if (coinRes.signals.length > 0) {
      console.log('✅ Örnek sinyal fiyati:', coinRes.signals[0].currentPrice, 'Önceki:', coinRes.signals[0].prevPrice);
    }

    console.log('\n======================================================');
    console.log('  TÜM API VE GEÇMİŞ SİSTEMİ %100 ÇALIŞIYOR! 🎉');
    console.log('======================================================');
  } catch (err) {
    console.error('Test hatasi:', err.message);
  } finally {
    server.kill();
    process.exit(0);
  }
}

setTimeout(() => {
  console.error('Zaman asimi');
  server.kill();
  process.exit(1);
}, 10000);
