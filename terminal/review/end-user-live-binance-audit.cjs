/**
 * end-user-live-binance-audit.cjs
 * Son Kullanıcı Gözüyle Gerçekçi Canlı Binance Futures vs Terminal Denetim Testi
 */

const https = require('https');
const http = require('http');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, { headers: { 'User-Agent': 'AlphaTerminalAuditor/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

async function runAudit() {
  console.log('================================================================');
  console.log('  🔍 ALPHA TERMINAL — SON KULLANICI & CANLI BİNANCE DENETİMİ');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details ? '-> ' + details : ''}`);
      failed++;
    }
  }

  // ─── 1. Canlı Binance Futures REST vs Terminal Proxy Karşılaştırması ───
  console.log('📌 1. CANLI BİNANCE REST vs TERMİNAL PROXY DOĞRULAMASI');
  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTWUSDT', 'DOGEUSDT', '1000PEPEUSDT'];

  for (const sym of symbols) {
    try {
      const [binanceTicker, localTicker] = await Promise.all([
        fetchJson(`https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=${sym}`),
        fetchJson(`http://localhost:3000/api/fapi/v1/ticker/24hr?symbol=${sym}`)
      ]);

      const bPrice = parseFloat(binanceTicker.lastPrice);
      const lPrice = parseFloat(localTicker.lastPrice);
      const diffPct = Math.abs((bPrice - lPrice) / bPrice) * 100;

      assert(
        `${sym} Canlı Fiyat Senkronizasyonu (Binance: ${binanceTicker.lastPrice} | Terminal: ${localTicker.lastPrice})`,
        diffPct < 0.05,
        `Fark: %${diffPct.toFixed(4)}`
      );

      // Basamak kesilmediğini doğrula
      const bDec = (binanceTicker.lastPrice.split('.')[1] || '').length;
      const lDec = (localTicker.lastPrice.split('.')[1] || '').length;
      assert(
        `${sym} Basamak Bütünlüğü (Binance basamak: ${bDec} == Terminal basamak: ${lDec})`,
        bDec === lDec,
        `Binance: ${bDec}, Terminal: ${lDec}`
      );
    } catch (e) {
      assert(`${sym} API Sorgusu`, false, e.message);
    }
  }

  // ─── 2. Watchlist (740+ Coin) Veri Bütünlüğü ve Sıralama ─────────
  console.log('\n📌 2. WATCHLIST (740+ COIN) VERİ VE SIRALAMA DENETİMİ');
  try {
    const wl = await fetchJson('http://localhost:3000/api/watchlist');
    assert('Watchlist Veri Dizisi Döndü', Array.isArray(wl) && wl.length > 500, `Bulunan coin sayısı: ${wl.length}`);

    // Hacim sıralaması kontrolü
    const isVolSorted = wl.slice(0, 50).every((item, idx, arr) => idx === 0 || arr[idx - 1].volUsd >= item.volUsd);
    assert('Watchlist Varsayılan Olarak 24h Hacme Göre Sıralı', isVolSorted);

    // Mikro coin fiyat testi (fiyatı 0.01'in altında olan bir coin)
    const microCoin = wl.find(x => x.priceNum < 0.01);
    if (microCoin) {
      assert(
        `Mikro Coin Fiyat Formatı (${microCoin.symbol}: ${microCoin.price})`,
        typeof microCoin.price === 'string' && microCoin.price.includes('.'),
        `Fiyat: ${microCoin.price}`
      );
    }

    // Fonlama oranı varlığı
    const hasFunding = wl.every(x => typeof x.fr === 'number' && !isNaN(x.fr));
    assert('Tüm Coinlerde Fonlama Oranı (Funding Rate) Mevcut', hasFunding);
  } catch (e) {
    assert('Watchlist Testi', false, e.message);
  }

  // ─── 3. Çoklu Zaman Dilimli (1m, 5m, 1h, 1D) Kline Veri Hassasiyeti ─
  console.log('\n📌 3. ÇOKLU ZAMAN DİLİMLİ (1m, 5m, 1h, 1D) KLINE HASSASİYETİ');
  const testTfs = ['1m', '5m', '1h', '1d'];
  for (const tf of testTfs) {
    try {
      const klines = await fetchJson(`http://localhost:3000/api/fapi/v1/klines?symbol=SOLUSDT&interval=${tf}&limit=5`);
      assert(
        `SOLUSDT ${tf} Kline Verisi Alındı (5 mum)`,
        Array.isArray(klines) && klines.length === 5,
        `Alınan: ${klines.length}`
      );
    } catch (e) {
      assert(`SOLUSDT ${tf} Kline`, false, e.message);
    }
  }

  // ─── 4. Grafik detectCoinPrecision Algoritma Doğrulaması ─────────
  console.log('\n📌 4. GRAFİK EKSENİ TICK PRECISION ALGORİTMASI DOĞRULAMASI');
  function detectCoinPrecision(rawData) {
    if (!Array.isArray(rawData) || !rawData.length) return 2;
    const samplePrice = parseFloat(rawData[0][4] || rawData[0][1] || 0);
    let minByMag = 2;
    if (samplePrice < 0.0001) minByMag = 8;
    else if (samplePrice < 0.01) minByMag = 6;
    else if (samplePrice < 1) minByMag = 4;
    else minByMag = 2;

    let maxSignificantDecimals = 2;
    const sampleCount = Math.min(35, rawData.length);
    for (let i = 0; i < sampleCount; i++) {
      const row = rawData[i];
      for (let c = 1; c <= 4; c++) {
        const pStr = String(row[c] || '').replace(/0+$/, '');
        if (pStr.includes('.')) {
          const dec = pStr.split('.')[1].length;
          if (dec > maxSignificantDecimals) maxSignificantDecimals = dec;
        }
      }
    }
    return Math.min(8, Math.max(minByMag, maxSignificantDecimals));
  }

  const pBTW = await fetchJson('http://localhost:3000/api/fapi/v1/klines?symbol=BTWUSDT&interval=1m&limit=35');
  const precBTW = detectCoinPrecision(pBTW);
  assert('BTWUSDT Grafik Hassasiyeti: 4 basamak (Gereksiz 7 basamak sıfırları temizlendi)', precBTW === 4, `Sonuç: ${precBTW}`);

  const pSOL = await fetchJson('http://localhost:3000/api/fapi/v1/klines?symbol=SOLUSDT&interval=1m&limit=35');
  const precSOL = detectCoinPrecision(pSOL);
  assert('SOLUSDT Grafik Hassasiyeti: 2 basamak (Binance cent standardı)', precSOL === 2, `Sonuç: ${precSOL}`);

  const pPEPE = await fetchJson('http://localhost:3000/api/fapi/v1/klines?symbol=1000PEPEUSDT&interval=1m&limit=35');
  const precPEPE = detectCoinPrecision(pPEPE);
  assert('1000PEPEUSDT Mikro Hassasiyet: 7 basamak tam korundu', precPEPE === 7, `Sonuç: ${precPEPE}`);

  // ─── 5. Derin Piyasa Duyarlılığı (Order Book & Balina Pozisyonları) ─
  console.log('\n📌 5. DERİN PİYASA DUYARLILIĞI (SENTIMENT) VE BALİNA ANALİZİ');
  try {
    const s = await fetchJson('http://localhost:3000/api/sentiment?symbol=BTCUSDT');
    assert('Order Book Bid/Ask Toplamı %100', Math.round(s.orderBook.bidPct + s.orderBook.askPct) === 100);
    assert('Balina Long/Short Toplamı %100', Math.round(s.topPosition.longPct + s.topPosition.shortPct) === 100);
    assert('Balina Hesap Oranı Toplamı %100', Math.round(s.topAccount.longPct + s.topAccount.shortPct) === 100);
    assert('Perakende Market Exposure Toplamı %100', Math.round(s.globalExposure.longPct + s.globalExposure.shortPct) === 100);
  } catch (e) {
    assert('Sentiment Testi', false, e.message);
  }

  // ─── 6. 200 Günlük Analiz Motoru ────────────────────────────────
  console.log('\n📌 6. 200 GÜNLÜK KANTİTATİF ANALİZ MOTORU DOĞRULAMASI');
  try {
    const fav = await fetchJson('http://localhost:3000/api/favorites/analytics?symbol=SOLUSDT');
    assert('200 Günlük Analiz Yanıtı Alındı', !!fav && !!fav.metrics);
    if (fav && fav.metrics) {
      assert('EMA 200 Mesafesi Sayısal', typeof fav.metrics.ema200DiffPct === 'number');
      assert('200G ATH Zirve Mesafesi Negatif veya 0', fav.metrics.athDistancePct <= 0);
      assert('200G ATL Dip Sıçraması Pozitif veya 0', fav.metrics.atlBouncePct >= 0);
      assert('Kazanma Oranı (Win Rate) [0-100] Aralığında', fav.metrics.winRatePct >= 0 && fav.metrics.winRatePct <= 100);
      assert('Gün Serisi (Streak) Yapısı Mevcut', !!fav.metrics.currentStreak && fav.metrics.currentStreak.count > 0);
    }
  } catch (e) {
    assert('200 Günlük Analiz Testi', false, e.message);
  }

  // ─── Özet ────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`  📊 DENETİM SONUÇLARI:`);
  console.log(`  Toplam Adım : ${passed + failed}`);
  console.log(`  Başarılı    : ${passed} ✅`);
  console.log(`  Başarısız   : ${failed} ❌`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('\n🎉 TÜM DENETİM ADIMLARI VE CANLI BİNANCE UYUMU %100 BAŞARILI! 🚀\n');
  }
}

runAudit();
