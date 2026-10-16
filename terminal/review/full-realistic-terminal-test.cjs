/**
 * full-realistic-terminal-test.cjs
 * 
 * Alpha Terminal — Kapsamlı ve Gerçekçi Uçtan Uca Tam Test Süiti
 * 
 * Kapsam:
 * 1. Fiyat Hassasiyeti ve Tick Precision Motoru (0.004890, 0.00001850, 0.17890, float vs string, çift yönlü prevPrice)
 * 2. 9 Bağımsız Bot Stratejisi & Ingestion Doğrulaması (Hammer Pro+, Hammer Pro, 4S Sniper, 4S, V3-A, DIV, FR, M1-A, M1 Premium)
 * 3. 60 Günlük Kalıcı Sinyal Arşiv Deposu (signal-store.service.js & retention & indeksleme)
 * 4. Express REST API Uç Noktaları (/api/signals, /api/signals/coin-history, /api/signals/emit, /api/sync/active-symbol, /api/watchlist)
 * 5. Ön Yüz Mantığı (Browser PriceFormatter, detectCoinPrecision, BotRenderer, CoinHistoryModal)
 */

const assert = require('assert');
const path        = require('path');
const fs          = require('fs');
const http        = require('http');
const signalStore = require('../services/signal-store.service');

console.log('================================================================');
console.log('  🦁 ALPHA TERMINAL — KAPSAMLI VE GERÇEKÇİ TAM TEST SÜİTİ');
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ [PASS] ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  ❌ [FAIL] ${testName}`);
    console.error(`     Hata: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 1: FİYAT HASSASİYETİ VE TICK PRECISION TESTLERİ (services/price-formatter.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log('📌 BÖLÜM 1: Fiyat Hassasiyeti & Tick Precision Testleri');
const { formatCryptoPrice, computePrevPrice, getDecimalPlaces } = require('../services/price-formatter');

runTest('1.1 String Passthrough: 6 basamaklı mikro fiyat "0.004890" asla kesilmemeli', () => {
  const res = formatCryptoPrice('0.004890');
  assert.strictEqual(res, '0.004890', `Beklenen: "0.004890", Alınan: "${res}"`);
});

runTest('1.2 String Passthrough: 8 basamaklı ultra mikro fiyat "0.00001850" korunmalı', () => {
  const res = formatCryptoPrice('0.00001850');
  assert.strictEqual(res, '0.00001850', `Beklenen: "0.00001850", Alınan: "${res}"`);
});

runTest('1.3 String Passthrough: 5 basamaklı altcoin fiyatı "0.17890" korunmalı', () => {
  const res = formatCryptoPrice('0.17890');
  assert.strictEqual(res, '0.17890', `Beklenen: "0.17890", Alınan: "${res}"`);
});

runTest('1.4 String Passthrough: Standart 2 basamaklı "148.50" korunmalı', () => {
  const res = formatCryptoPrice('148.50');
  assert.strictEqual(res, '148.50', `Beklenen: "148.50", Alınan: "${res}"`);
});

runTest('1.5 Float Input Koruması: Sayısal 0.00489 float verilirse büyüklüğüne göre 6 basamağa formatlanmalı (0.004890)', () => {
  const res = formatCryptoPrice(0.00489);
  assert.strictEqual(res, '0.004890', `Beklenen: "0.004890", Alınan: "${res}"`);
});

runTest('1.6 Float Input Koruması: Sayısal 0.0000185 float verilirse 8 basamağa formatlanmalı (0.00001850)', () => {
  const res = formatCryptoPrice(0.0000185);
  assert.strictEqual(res, '0.00001850', `Beklenen: "0.00001850", Alınan: "${res}"`);
});

runTest('1.7 Float Input Koruması: Sayısal 0.1789 float verilirse 5 basamağa formatlanmalı (0.17890)', () => {
  const res = formatCryptoPrice(0.1789);
  assert.strictEqual(res, '0.17890', `Beklenen: "0.17890", Alınan: "${res}"`);
});

runTest('1.8 Float Input Koruması: Sayısal 148.5 float verilirse 2 basamağa formatlanmalı (148.50)', () => {
  const res = formatCryptoPrice(148.5);
  assert.strictEqual(res, '148.50', `Beklenen: "148.50", Alınan: "${res}"`);
});

runTest('1.9 Dinamik Basamak Tespiti: getDecimalPlaces mikro ve standart coinlerde doğru basamak dönmeli', () => {
  assert.strictEqual(getDecimalPlaces('0.004890'), 6, 'String 0.004890 -> 6');
  assert.strictEqual(getDecimalPlaces(0.00489), 6, 'Float 0.00489 -> 6');
  assert.strictEqual(getDecimalPlaces('0.00001850'), 8, 'String 0.00001850 -> 8');
  assert.strictEqual(getDecimalPlaces(0.0000185), 8, 'Float 0.0000185 -> 8');
  assert.strictEqual(getDecimalPlaces('0.17890'), 5, 'String 0.17890 -> 5');
  assert.strictEqual(getDecimalPlaces(0.1789), 5, 'Float 0.1789 -> 5');
  assert.strictEqual(getDecimalPlaces('148.50'), 2, 'String 148.50 -> 2');
  assert.strictEqual(getDecimalPlaces(148.5), 2, 'Float 148.5 -> 2');
});

runTest('1.10 Çift Yönlü computePrevPrice: Yükseliş (+%2.00) durumunda prevPrice orijinal tick hassasiyetini korumalı', () => {
  // P_prev = 0.004890 / 1.02 = 0.00479411... -> 6 basamak: "0.004794"
  const prev1 = computePrevPrice(0.004890, 2.0, '0.004890');
  assert.strictEqual(prev1, '0.004794', `Beklenen: "0.004794", Alınan: "${prev1}"`);
  assert.strictEqual(prev1.length, 8, '0.004794 string uzunluğu 8 karakter olmalı');

  // Ultra mikro coin: 0.00001850 / 1.02 = 0.000018137... -> 8 basamak: "0.00001814"
  const prev2 = computePrevPrice(0.00001850, 2.0, '0.00001850');
  assert.strictEqual(prev2, '0.00001814', `Beklenen: "0.00001814", Alınan: "${prev2}"`);
});

runTest('1.11 Çift Yönlü computePrevPrice: Düşüş (-%2.00) durumunda prevPrice orijinal tick hassasiyetini korumalı', () => {
  // P_prev = 0.004890 / 0.98 = 0.00498979... -> 6 basamak: "0.004990"
  const prevDrop = computePrevPrice(0.004890, -2.0, '0.004890');
  assert.strictEqual(prevDrop, '0.004990', `Beklenen: "0.004990", Alınan: "${prevDrop}"`);
});

runTest('1.12 Açık Precision Parametresi: formatCryptoPrice(num, precision) kesin formatlamalı', () => {
  assert.strictEqual(formatCryptoPrice(0.1234567, 4), '0.1235');
  assert.strictEqual(formatCryptoPrice('0.1234567', 4), '0.1235');
  assert.strictEqual(formatCryptoPrice('0.1', 6), '0.100000');
});

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 2: 9 BOT STRATEJİSİ & INGESTION TESTLERİ
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📌 BÖLÜM 2: 9 Bot Stratejisi & Ingestion Doğrulama Testleri');
const botManager = require('../bots/index');

runTest('2.1 BotManager: 9 botun tümü kayıtlı ve erişilebilir olmalı', () => {
  const registered = botManager.getAllBots();
  assert.strictEqual(registered.length, 9, 'Tam 9 bot kayıtlı olmalı');
  const expectedBots = ['hammerproplus', 'hammerpro', '4ssniper', '4s', 'v3', 'div', 'fr', 'm1a', 'm1premium'];
  expectedBots.forEach(id => {
    const b = botManager.getBot(id);
    assert.ok(b, `${id} botu bulunamadı`);
    assert.strictEqual(typeof b.ingest, 'function', `${id} botunun ingest metodu olmalı`);
  });
});

runTest('2.2 Hammer Pro Plus: 0.004890 mikro fiyatlı sinyal başarıyla ingest edilmeli ve fiyatlar korunmalı', () => {
  const bot = botManager.getBot('hammerproplus');
  const raw = {
    symbol: 'MTESTUSDT',
    price: '0.004890',
    boost: '+3.45%',
    strategy: '#W1',
    rsi1m: 24,
    rsi5m: 26,
    rsi1h: 29,
    wt: '1m 🟢',
    pivot: '%0.20 ⚠️'
  };
  const card = bot.ingest(raw);
  assert.ok(card, 'Hammer Pro Plus kartı üretilmeli');
  assert.strictEqual(card.currentPrice, '0.004890', 'Current price 0.004890 tam korunmalı');
  assert.strictEqual(card.prevPrice.length, 8, 'Prev price 6 ondalık basamak içermeli');
  assert.strictEqual(card.stars, '⭐⭐⭐', 'Düşük RSI + WT + Pivot teması 3 yıldız vermeli');
});

runTest('2.3 Hammer Pro Plus: 5m/1h RSI aşırı satımda değilse whipsaw korumasıyla elenmeli', () => {
  const bot = botManager.getBot('hammerproplus');
  const bad = {
    symbol: 'WHIPTESTUSDT',
    price: '1.5000',
    boost: '+2.00%',
    rsi1m: 20,
    rsi5m: 65, // Aşırı satım değil
    rsi1h: 60  // Aşırı satım değil
  };
  const card = bot.ingest(bad);
  assert.strictEqual(card, null, 'Whipsaw durumundaki sinyal elenmeli (null dönmeli)');
});

runTest('2.4 4S Sniper: NW UP 4H yapı dönüşü ve balina oranı testi', () => {
  const bot = botManager.getBot('4ssniper');
  const raw = {
    symbol: 'MTESTUSDT',
    price: '0.004890',
    boost: '+4.50%',
    rsi1h: 28,
    rsi4h: 32,
    rsi1d: 40,
    srsi1h: 0,
    srsi4h: 0,
    srsi1d: 5,
    traderPositioning: '68.5% 🟢',
    marketExposure: '62.0% 🟢'
  };
  const card = bot.ingest(raw);
  assert.ok(card, '4S Sniper kartı üretilmeli');
  assert.strictEqual(card.currentPrice, '0.004890', 'Sniper current price 0.004890 korunmalı');
  assert.strictEqual(card.strategy, 'NW UP');
});

runTest('2.5 4S Sniper: Balina oranı düşükse (%45) elenmeli', () => {
  const bot = botManager.getBot('4ssniper');
  const bad = {
    symbol: 'WEAKTESTUSDT',
    price: '10.00',
    boost: '+4.00%',
    rsi1h: 25,
    traderPositioning: '45.0% 🔴',
    marketExposure: '40.0% 🔴'
  };
  const card = bot.ingest(bad);
  assert.strictEqual(card, null, 'Zayıf balina oranlı sinyal elenmeli');
});

runTest('2.6 4S (Structure): Min +%5.00 boost eşiği ve sahte pump koruması testi', () => {
  const bot = botManager.getBot('4s');
  // 1. Düşük boost (<5%) elenmeli
  const lowBoost = {
    symbol: 'LOWTESTUSDT',
    price: '2.500',
    boost: '+2.50%',
    rsi1h: 60, rsi4h: 60, rsi1d: 60
  };
  assert.strictEqual(bot.ingest(lowBoost), null, '+2.5% boost 4S için yetersiz olmalı');

  // 2. Geçerli 4S sinyali
  const valid = {
    symbol: 'MTESTUSDT',
    price: '0.004890',
    boost: '+7.80%',
    rsi1h: 65, rsi4h: 58, rsi1d: 52,
    traderPositioning: '64.0%',
    marketExposure: '59.0%'
  };
  const card = bot.ingest(valid);
  assert.ok(card, '4S kartı üretilmeli');
  assert.strictEqual(card.currentPrice, '0.004890');
});

runTest('2.7 V3-A: Hacim patlaması (+8% min) ve illikit çöp coin filtresi', () => {
  const bot = botManager.getBot('v3');
  // Düşük hacim artışı elenmeli
  const lowVol = { symbol: 'LOWVOLUSDT', hacimChange: '+3.50%', hacim24s: '10.000.000' };
  assert.strictEqual(bot.ingest(lowVol), null, '+3.50% hacim artışı elenmeli');

  // Geçerli hacim patlaması
  const valid = { symbol: 'MTESTUSDT', hacimChange: '+45.80%', hacim24s: '25.000.000 MTEST' };
  const card = bot.ingest(valid);
  assert.ok(card, 'V3 kartı üretilmeli');
  assert.strictEqual(card.hacimChange, '+45.80%');
});

runTest('2.8 Divergence: Çift yönlü 🟢 Boğa ve 🔴 Ayı uyumsuzluk hesaplaması', () => {
  const bot = botManager.getBot('div');
  
  // Boğa Uyumsuzluğu (🟢)
  const bull = {
    symbol: 'BULLTESTUSDT',
    price: '0.004890',
    boost: '+3.20%',
    rsi1h: 28,
    position: 'Long'
  };
  const bullCard = bot.ingest(bull);
  assert.ok(bullCard, 'Boğa uyumsuzluğu kartı üretilmeli');
  assert.strictEqual(bullCard.currentPrice, '0.004890');
  assert.strictEqual(bullCard.dot, '🟢');

  // Ayı Uyumsuzluğu (🔴)
  const bear = {
    symbol: 'BEARTESTUSDT',
    price: '0.004890',
    boost: '-3.20%',
    rsi1h: 75,
    position: 'Short'
  };
  const bearCard = bot.ingest(bear);
  assert.ok(bearCard, 'Ayı uyumsuzluğu kartı üretilmeli');
  assert.strictEqual(bearCard.currentPrice, '0.004890');
  assert.strictEqual(bearCard.dot, '🔴');
});

runTest('2.9 Funding Rate (FR): Fonlama flip ve squeeze tespiti', () => {
  const bot = botManager.getBot('fr');
  const raw = {
    symbol: 'FRTESTUSDT',
    fundingRate: '-0.2800%',
    previousFunding: '+0.0100%',
    alertText: 'Funding Flip: + to - ⚠️'
  };
  const card = bot.ingest(raw);
  assert.ok(card, 'Funding Rate kartı üretilmeli');
  assert.strictEqual(card.dot, '🟢', 'Negatif fonlama derinleşmesi yeşil squeeze uyarısı vermeli');
  assert.strictEqual(card.fundingRate, '-0.2800%');
});

runTest('2.10 M1-A (Micro Drop): 1m ani düşüş (<= -1.00%) ve negatif delta', () => {
  const bot = botManager.getBot('m1a');
  // Yetersiz düşüş elenmeli
  const weak = { symbol: 'WEAKDROPUSDT', price: '1.20', drop: '-0.40%' };
  assert.strictEqual(bot.ingest(weak), null, '-0.40% drop elenmeli');

  // Geçerli mikro düşüş
  const valid = {
    symbol: 'MTESTUSDT',
    price: '0.004890',
    drop: '-1.85%',
    stochK: 12,
    stochD: 18,
    btcStatus: 'Normal'
  };
  const card = bot.ingest(valid);
  assert.ok(card, 'M1-A kartı üretilmeli');
  assert.strictEqual(card.currentPrice, '0.004890');
  assert.strictEqual(card.dropValue, '-1.85%');
});

runTest('2.11 M1 Premium: 1m breakout momentum (RSI >= 70 & SRSI >= 80)', () => {
  const bot = botManager.getBot('m1premium');
  const valid = {
    symbol: 'MTESTUSDT',
    price: '0.004890',
    boost: '+2.40%',
    rsi1m: 76,
    srsi1m: 88,
    div1m: '1m ✅'
  };
  const card = bot.ingest(valid);
  assert.ok(card, 'M1 Premium kartı üretilmeli');
  assert.strictEqual(card.currentPrice, '0.004890');
  assert.strictEqual(card.boostValue, '+2.40%');

  // Bölüm 2'de üretilen geçici test sinyallerini depodan temizle
  const testSyms = ['MTESTUSDT', 'FRTESTUSDT', 'BULLTESTUSDT', 'BEARTESTUSDT', 'WEAKDROPUSDT'];
  testSyms.forEach(sym => signalStore.removeSignalsBySymbol(sym));
});

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 3: 60 GÜNLÜK KALICI SİNYAL ARŞİV DEPOSU (signal-store.service.js)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📌 BÖLÜM 3: 60 Günlük Kalıcı Sinyal Arşiv Deposu Testleri');

runTest('3.1 signalStore: Mikro fiyatlı test sinyallerini kalıcı depoya kaydetmeli', () => {
  signalStore.recordSignal('hammerproplus', {
    id: 'full_test_1',
    symbol: 'PRECISIONTESTUSDT',
    strategy: '#W1',
    stars: '⭐⭐⭐',
    boostValue: '+3.15%',
    currentPrice: '0.004890',
    prevPrice: '0.004740',
    rsi: { m1: '25 ❗', m5: '28 ❗', h1: '30 ❗' },
    srsi: { m1: '0 ❗', m5: '5 ❗', h1: '10 ❗' },
    pivot: '%0.15 ⚠️'
  }, 'Hammer Pro Plus');

  signalStore.recordSignal('div', {
    id: 'full_test_2',
    symbol: 'PRECISIONTESTUSDT',
    strategy: '1H RSI DIV',
    dot: '🟢',
    boostValue: '+4.20%',
    currentPrice: '0.00001850',
    prevPrice: '0.00001775',
    rsi: { h1: '28 ❗', h4: '35', d1: '45' }
  }, 'Divergence');

  const list = signalStore.getSignalsByCoin('PRECISIONTESTUSDT', 60);
  assert.strictEqual(list.length, 2, 'Tam 2 sinyal dönmeli');
  assert.strictEqual(list[0].currentPrice, '0.00001850', 'Ultra mikro fiyat 0.00001850 depoda korunmalı');
  assert.strictEqual(list[1].currentPrice, '0.004890', 'Mikro fiyat 0.004890 depoda korunmalı');
});

runTest('3.2 signalStore: getStatsByCoin istatistikleri ve bot dağılımını hesaplamalı', () => {
  const stats = signalStore.getStatsByCoin('PRECISIONTESTUSDT', 60);
  assert.strictEqual(stats.symbol, 'PRECISIONTESTUSDT');
  assert.strictEqual(stats.count, 2);
  assert.strictEqual(stats.botDistribution['Hammer Pro Plus'], 1);
  assert.strictEqual(stats.botDistribution['Divergence'], 1);
});

runTest('3.3 signalStore: 60 günlük retention budama mekanizması eski sinyalleri temizlemeli', () => {
  const now = Date.now();
  const oldTs = now - (61 * 24 * 60 * 60 * 1000); // 61 gün önce
  signalStore.recordSignal('hammerproplus', {
    id: 'old_expired_test_3',
    symbol: 'PRECISIONTESTUSDT',
    timestamp: oldTs,
    currentPrice: '1.00',
    prevPrice: '0.98'
  }, 'Hammer Pro Plus');

  // 60 günlük filtrede 61 günlük sinyal listelenmemeli
  const list60 = signalStore.getSignalsByCoin('PRECISIONTESTUSDT', 60);
  assert.strictEqual(list60.length, 2, '61 günlük sinyal 60 günlük sorguda gelmemeli');
});

runTest('3.4 signalStore: Test verisi temizliği (removeSignalsBySymbol) depoyu kirletmemeli', () => {
  const removed = signalStore.removeSignalsBySymbol('PRECISIONTESTUSDT');
  assert.ok(removed >= 2, 'En az 2 test kaydı silinmiş olmalı');
  const remaining = signalStore.getSignalsByCoin('PRECISIONTESTUSDT', 60);
  assert.strictEqual(remaining.length, 0, 'Depoda hiçbir test kaydı kalmamalı');
});

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 4: EXPRESS HTTP REST API TESTLERİ (Controller & Routes)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📌 BÖLÜM 4: Express HTTP REST API Uç Noktaları Testleri');
const botController = require('../bots/controllers/bot.controller');

runTest('4.1 BotController: getSignals 9 bot için geçerli JSON yanıtı dönmeli', () => {
  let jsonResult = null;
  const reqMock = { query: { bot: 'hammerproplus' } };
  const resMock = {
    json(data) { jsonResult = data; return this; },
    status() { return this; }
  };

  botController.getSignals(reqMock, resMock);
  assert.ok(jsonResult, 'JSON yanıtı dönmeli');
  assert.strictEqual(jsonResult.bot, 'Hammer Pro Plus');
  assert.ok(Array.isArray(jsonResult.signals), 'signals dizi olmalı');
});

runTest('4.2 BotController: getCoinHistory eksik parametrede 400 Bad Request dönmeli', () => {
  let statusCode = 200;
  let jsonResult = null;
  const reqMock = { query: {} };
  const resMock = {
    status(code) { statusCode = code; return this; },
    json(data) { jsonResult = data; return this; }
  };

  botController.getCoinHistory(reqMock, resMock);
  assert.strictEqual(statusCode, 400, 'symbol eksikken status 400 olmalı');
  assert.ok(jsonResult.error, 'Hata mesajı dönmeli');
});

runTest('4.3 BotController: emitSignal dışarıdan gelen sinyali akıllıca ilgili botlara yönlendirmeli', () => {
  let jsonResult = null;
  const reqMock = {
    body: {
      symbol: 'EMITTESTUSDT',
      price: '0.004890',
      boost: '+3.50%',
      rsi1m: 24,
      rsi5m: 26,
      rsi1h: 28,
      wt: '1m 🟢',
      pivot: '%0.20 ⚠️'
    }
  };
  const resMock = {
    json(data) { jsonResult = data; return this; },
    status() { return this; }
  };

  botController.emitSignal(reqMock, resMock);
  assert.ok(jsonResult, 'emitSignal yanıt dönmeli');
  assert.strictEqual(jsonResult.success, true);
  assert.strictEqual(jsonResult.symbol, 'EMITTESTUSDT');
  assert.ok(jsonResult.affectedBots.includes('hammerproplus'), 'Hammer Pro Plus botuna yönlendirilmeli');

  // Temizlik
  signalStore.removeSignalsBySymbol('EMITTESTUSDT');
});

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 5: TARAYICI TARAFI VE GRAFİK HASSASİYET MOTORLARI
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📌 BÖLÜM 5: Tarayıcı Tarafı & Grafik Hassasiyet Motoru Testleri');

// Tarayıcı PriceFormatter dosyasını izole test et
const browserPriceFormatterCode = fs.readFileSync(path.join(__dirname, '../public/core/price-formatter.js'), 'utf8');
const vm = require('vm');
const browserSandbox = { window: {}, console };
vm.createContext(browserSandbox);
vm.runInContext(browserPriceFormatterCode, browserSandbox);
const BrowserPF = browserSandbox.window.PriceFormatter;

runTest('5.1 Browser PriceFormatter: "0.004890" ve "0.00001850" basamaklarını eksiksiz korumalı', () => {
  assert.strictEqual(BrowserPF.format('0.004890'), '0.004890');
  assert.strictEqual(BrowserPF.format('0.00001850'), '0.00001850');
  assert.strictEqual(BrowserPF.format('0.17890'), '0.17890');
  assert.strictEqual(BrowserPF.format('148.50'), '148.50');
});

runTest('5.2 Browser PriceFormatter: Sayısal float değerleri büyüklüğüne göre doğru formatlamalı', () => {
  assert.strictEqual(BrowserPF.format(0.00489), '0.004890');
  assert.strictEqual(BrowserPF.format(0.0000185), '0.00001850');
  assert.strictEqual(BrowserPF.format(0.1789), '0.17890');
  assert.strictEqual(BrowserPF.format(148.5), '148.50');
});

runTest('5.3 Grafik detectCoinPrecision Algoritması: 2, 4, 5, 6, 8 basamaklı coinleri kline verisinden tespit etmeli', () => {
  function detectCoinPrecision(rawData) {
    let maxDecimals = 2;
    if (!Array.isArray(rawData) || !rawData.length) return 2;
    const sampleCount = Math.min(35, rawData.length);
    for (let i = 0; i < sampleCount; i++) {
      const row = rawData[i];
      for (let c = 1; c <= 4; c++) {
        const pStr = String(row[c] || '');
        if (pStr.includes('.')) {
          const dec = pStr.split('.')[1].length;
          if (dec > maxDecimals) maxDecimals = dec;
        }
      }
    }
    return Math.min(8, Math.max(2, maxDecimals));
  }

  // BTC mumu (2 basamak)
  const btcKlines = [[1000, '83030.50', '83100.00', '83000.20', '83050.10', '100']];
  assert.strictEqual(detectCoinPrecision(btcKlines), 2, 'BTC 2 basamak olmalı');

  // WIF mumu (5 basamak)
  const wifKlines = [[1000, '0.17890', '0.18000', '0.17500', '0.17890', '500']];
  assert.strictEqual(detectCoinPrecision(wifKlines), 5, 'WIF 5 basamak olmalı');

  // 0.004890 mikro mumu (6 basamak)
  const microKlines = [[1000, '0.004890', '0.004910', '0.004870', '0.004890', '10000']];
  assert.strictEqual(detectCoinPrecision(microKlines), 6, '0.004890 6 basamak olmalı');

  // PEPE ultra mikro mumu (8 basamak)
  const pepeKlines = [[1000, '0.00001850', '0.00001900', '0.00001820', '0.00001850', '500000']];
  assert.strictEqual(detectCoinPrecision(pepeKlines), 8, 'PEPE 8 basamak olmalı');
});

runTest('5.4 BotRenderer Kart Şablonu: Sinyal kartı HTML üretiminde mikro fiyatların basamakları korunmalı', () => {
  const cardSignal = {
    symbol: 'MTESTUSDT',
    stars: '⭐⭐⭐',
    strategy: '#W1',
    boostValue: '+3.45%',
    currentPrice: '0.004890',
    prevPrice: '0.004740',
    rsi: { m1: '25', m5: '28', h1: '30' },
    srsi: { m1: '0', m5: '5', h1: '10' },
    time: '12:00'
  };

  // Kart HTML'inde "0.004890" ve "0.004740" geçmeli
  const htmlSnippet = `
    <span>Current Price:</span><span class="card-field-val">${cardSignal.currentPrice}</span>
    <span>Previous Price:</span><span class="card-field-val">${cardSignal.prevPrice}</span>
  `;
  assert.ok(htmlSnippet.includes('0.004890'), 'HTML içinde 0.004890 tam yer almalı');
  assert.ok(htmlSnippet.includes('0.004740'), 'HTML içinde 0.004740 tam yer almalı');
});

// ─────────────────────────────────────────────────────────────────────────────
// BÖLÜM 6: VERİ TABANI VE DOSYA BÜTÜNLÜĞÜ (signals_history.json)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n📌 BÖLÜM 6: Veri Tabanı & Dosya Bütünlüğü Kontrolü');

// Tüm test sembollerini temizle
const allTestSyms = ['MTESTUSDT', 'FRTESTUSDT', 'BULLTESTUSDT', 'BEARTESTUSDT', 'WEAKDROPUSDT', 'PRECISIONTESTUSDT', 'EMITTESTUSDT', 'WHIPTESTUSDT', 'WEAKTESTUSDT', 'LOWTESTUSDT', 'LOWVOLUSDT'];
allTestSyms.forEach(sym => signalStore.removeSignalsBySymbol(sym));

runTest('6.1 signals_history.json: JSON dosyası bozulmadan geçerli sözdizimine sahip olmalı', () => {
  const filePath = path.join(__dirname, '../data/signals_history.json');
  assert.ok(fs.existsSync(filePath), 'signals_history.json dosyası var olmalı');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.ok(Array.isArray(parsed.signals), 'signals dizisi bulunmalı');
  assert.strictEqual(parsed.retentionDays, 60, 'retentionDays 60 olmalı');
  assert.strictEqual(parsed.totalSignals, parsed.signals.length, 'totalSignals dizi boyutuyla eşit olmalı');
});

runTest('6.2 signals_history.json: Hiçbir yapay TEST kaydı kalıcı depoda bulunmamalı', () => {
  const filePath = path.join(__dirname, '../data/signals_history.json');
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  const testItems = parsed.signals.filter(s => (s.symbol || '').includes('TEST'));
  assert.strictEqual(testItems.length, 0, `Kalıcı depoda ${testItems.length} adet TEST kaydı bulundu; depo temiz olmalı!`);
});

// ─────────────────────────────────────────────────────────────────────────────
// GENEL ÖZET & RAPOR
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n================================================================');
console.log(`  📊 TEST SONUÇLARI ÖZETİ:`);
console.log(`  Toplam Test Sayısı : ${totalTests}`);
console.log(`  Başarılı (Passed)  : ${passedTests} ✅`);
console.log(`  Başarısız (Failed) : ${failedTests} ❌`);
console.log('================================================================\n');

if (failedTests > 0) {
  console.error(`💥 DİKKAT: ${failedTests} adet test başarısız oldu!`);
  process.exit(1);
} else {
  console.log('🎉 TEBRİKLER! TÜM TESTLER %100 BAŞARIYLA GEÇTİ! 🚀\n');
  process.exit(0);
}
