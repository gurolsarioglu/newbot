const assert = require('assert');
const path = require('path');
const fs = require('fs');

console.log('--- 1. Fiyat Hassasiyet Koruma Testi (price-formatter.js) ---');
const { formatCryptoPrice, computePrevPrice, getDecimalPlaces } = require('../services/price-formatter');

// Test: 0.004890 gibi 6 basamaklı mikro fiyatlar
const p1 = '0.004890';
assert.strictEqual(formatCryptoPrice(p1), '0.004890', '0.004890 tam olarak korunmali');
console.log('✅ Test 1: formatCryptoPrice("0.004890") ->', formatCryptoPrice(p1));

// Test: 0.00001850 gibi 8 basamaklı ultra mikro coinler
const p2 = '0.00001850';
assert.strictEqual(formatCryptoPrice(p2), '0.00001850', '0.00001850 tam olarak korunmali');
console.log('✅ Test 2: formatCryptoPrice("0.00001850") ->', formatCryptoPrice(p2));

// Test: 148.50 gibi standart fiyatlar
const p3 = '148.50';
assert.strictEqual(formatCryptoPrice(p3), '148.50', '148.50 korunmali');
console.log('✅ Test 3: formatCryptoPrice("148.50") ->', formatCryptoPrice(p3));

// Test: Sayısal float verilirse dinamik hassasiyet
assert.strictEqual(formatCryptoPrice(0.00489), '0.004890', '0.00489 float 6 basamaga formatlanmali');
console.log('✅ Test 4: formatCryptoPrice(0.00489) ->', formatCryptoPrice(0.00489));

// Test: prevPrice hesaplama hassasiyeti
const prev = computePrevPrice(0.004890, 2.0, '0.004890');
assert.strictEqual(prev.length, 8, '0.004890 icin 6 ondalik basamak korunmali');
console.log('✅ Test 5: computePrevPrice(0.004890, 2.0) ->', prev);

console.log('\n--- 2. 60 Günlük Kalıcı Sinyal Depolama Testi (signal-store.service.js) ---');
const signalStore = require('../services/signal-store.service');

// Test sinyalleri ekle
signalStore.recordSignal('hammerproplus', {
  id: 'test_1',
  symbol: 'TESTUSDT',
  strategy: '#W1',
  stars: '⭐⭐⭐',
  boostValue: '+2.45%',
  currentPrice: '0.004890',
  prevPrice: '0.004773',
  rsi: { m1: '25 ❗', m5: '28 ❗', h1: '30 ❗' },
  srsi: { m1: '0 ❗', m5: '5 ❗', h1: '10 ❗' },
  pivot: '%0.15 ⚠️'
}, 'Hammer Pro Plus');

signalStore.recordSignal('4ssniper', {
  id: 'test_2',
  symbol: 'TESTUSDT',
  strategy: 'NW UP',
  boostValue: '+5.10%',
  currentPrice: '0.004890',
  prevPrice: '0.004652',
  rsi: { h1: '28 ❗', h4: '35', d1: '45' }
}, '4S Sniper');

// 60 Günlük Coin Geçmişi Sorgula
const coinSignals = signalStore.getSignalsByCoin('TESTUSDT', 60);
assert.ok(coinSignals.length >= 2, 'TESTUSDT icin en az 2 sinyal donmeli');
console.log(`✅ Test 6: getSignalsByCoin("TESTUSDT") -> ${coinSignals.length} sinyal donduruldu.`);

// İstatistik Sorgula
const stats = signalStore.getStatsByCoin('TESTUSDT', 60);
assert.strictEqual(stats.symbol, 'TESTUSDT');
assert.ok(stats.count >= 2);
console.log('✅ Test 7: getStatsByCoin("TESTUSDT") ->', stats);

console.log('\n--- 3. Bot Controller & API Kontrol Testi ---');
const botController = require('../bots/controllers/bot.controller');

let resJson = null;
const reqMock = { query: { symbol: 'TESTUSDT', days: '60' } };
const resMock = {
  json(data) { resJson = data; return this; },
  status(code) { return this; }
};

botController.getCoinHistory(reqMock, resMock);
assert.ok(resJson, 'Controller JSON yaniti vermeli');
assert.strictEqual(resJson.symbol, 'TESTUSDT');
assert.ok(resJson.count >= 2);
console.log(`✅ Test 8: Controller getCoinHistory("TESTUSDT") -> ${resJson.count} sinyal ve istatistik basarili.`);

// Test sonrasi temizlik: Test verilerini depodan temizle
const removedCount = signalStore.removeSignalsBySymbol('TESTUSDT');
console.log(`🧹 Test Temizligi: ${removedCount} adet TESTUSDT kaydi depodan temizlendi.`);

console.log('\n========================================');
console.log('  TÜM TESTLER BAŞARIYLA GEÇTİ! 🚀');
console.log('========================================');
