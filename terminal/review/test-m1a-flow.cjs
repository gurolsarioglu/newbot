const botManager = require('../bots/index');
const m1aBot = botManager.getBot('m1a');
const m1pBot = botManager.getBot('m1premium');
const https = require('https');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'AlphaTerminalTest' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function run() {
  console.log('--- TEST: M1-A Sinyal Motoru ve Canlı Tarama Doğrulaması ---');
  console.log('Başlangıç M1-A Sinyal Sayısı:', m1aBot.getCount());
  console.log('Başlangıç M1P Sinyal Sayısı:', m1pBot.getCount());

  // Arka plan motorunu başlat
  botManager.startBackgroundEngine(fetchJson);

  console.log('Bekleniyor (2.5 saniye - seed tohumlama kontrolü)...');
  await new Promise(r => setTimeout(r, 2500));

  console.log('Seed sonrası M1-A Sinyal Sayısı:', m1aBot.getCount());
  console.log('Seed sonrası M1P Sinyal Sayısı:', m1pBot.getCount());

  const m1aSignals = m1aBot.getSignals();
  console.log('\nSon 3 M1-A Sinyali:');
  m1aSignals.slice(0, 3).forEach((s, idx) => {
    console.log(`[#${idx+1}] ${s.symbol} | ${s.dot} ${s.type} | Value: ${s.dropValue} | Price: ${s.currentPrice} | Prev: ${s.prevPrice} | Vol: ${s.volume} | RSI: ${s.rsi} | Date: ${s.dateStr} ${s.time}`);
  });

  if (m1aSignals.length > 4 && m1aSignals[0].dateStr) {
    console.log('\n✅ M1-A CANLI MOTORU BAŞARIYLA ÇALIŞIYOR! Sinyaller taze ve tarihli.');
    process.exit(0);
  } else {
    console.error('\n❌ M1-A Sinyalleri beklenen sayıya ulaşamadı.');
    process.exit(1);
  }
}

run().catch(err => {
  console.error('Test hatası:', err);
  process.exit(1);
});
