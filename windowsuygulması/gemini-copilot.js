const https = require('https');

/**
 * Gemini AI Co-Pilot Karar Motoru
 * Multi-Timeframe Trading, Risk Yönetimi & Proaktif Analiz
 */
class GeminiCoPilot {
  constructor(apiKey, model = 'gemini-2.0-flash') {
    this.apiKey = apiKey;
    this.model = model; // varsayılan hızlı ve gelişmiş gemini-2.0-flash veya gemini-1.5-pro
  }

  // Google Gemini API Çağrısı
  generateContent(contents, systemInstruction = '') {
    return new Promise((resolve, reject) => {
      if (!this.apiKey) {
        return resolve({
          text: '⚠️ Gemini API anahtarı girilmemiş. Lütfen .env dosyasında GEMINI_API_KEY değerini tanımlayın.'
        });
      }

      const postData = JSON.stringify({
        contents: contents,
        systemInstruction: systemInstruction ? {
          parts: [{ text: systemInstruction }]
        } : undefined,
        generationConfig: {
          temperature: 0.3, // Kararlı, finansal analize uygun
          maxOutputTokens: 800
        }
      });

      const options = {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (data.error) {
              return reject(new Error(data.error.message || 'Gemini API Hatası'));
            }
            const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve({ text: candidate || 'Analiz üretilemedi.' });
          } catch (e) {
            reject(new Error(`Gemini Response Parse Error: ${e.message}`));
          }
        });
      });

      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  }

  // Sistem Rolü
  getSystemPrompt() {
    return `Sen profesyonel bir Kurumsal Kripto Vadeli İşlemler (Binance Futures) & Akıllı Para (Smart Money Flow) AI Co-Pilot'usun.
Görevin trader kullanıcına aktif pozisyonunda 2. ekrandaki türev verilerini (OI Delta, Funding Rate, Order Book Duvarları, Top Trader Rasyosu, Taker Hacmi) analiz ederek şu hayati soruya yanıt vermektir:
"BÜYÜKLER İŞLEMDE KALMAYA DEVAM MI EDİYOR, YOKSA TAHTACIYI ÜRKÜTMEDEN SESSİZCE KÂRINI ALIP MAL MI BOŞALTIYOR?"

Analiz Mantığın:
1. PARANIN GİRİŞ / ÇIKIŞ YÖNÜ (OI DELTA ANALİZİ):
   - Fiyat Artarken OI Artıyorsa: Gerçek alıcı girişi, akıllı para long pozisyon açarak piyasayı sürüyor (Güçlü Trend).
   - Fiyat Artarken OI Düşüyorsa: Sahte yükseliş veya short covering / kâr alımı! Büyükler sessizce piyasadan çıkıyor olabilir, DİKKAT!
   - Fiyat Düşerken OI Artıyorsa: Agresif short yığılması.
   - Fiyat Düşerken OI Düşüyorsa: Long tasfiyesi / zayıf ellerin dökülmesi.

2. MİKRO vs MAKRO PARA AKIŞI (5m vs 4H UYUMU):
   - 5 dakikalıkta OI hafif düşmüş olabilir (ara kâr satışı / mikro para çıkışı), ancak 4 Saatlikte kümülatif OI güçlü artıyorsa: "Bu bir silkeleme/düzeltmedir, büyük trend yukarı devam ediyor."
   - 5 dakikalıkta fiyat yeni tepe yaparken 4 Saatlikte OI düşüyorsa: "Tahtacıyı ürkütmeden sessiz dağıtım (Distribution) yapılıyor, kâr alıp çıkış planla!"

3. EMİR DEFTERİ (ORDER BOOK) & FONLAMA (FR):
   - Önümüzdeki en büyük satış duvarı nerede?
   - Fonlama oranı (FR) negatif mi (Short squeeze ihtimali sürüyor mu)?

4. NET AKSİYON TAVSİYESİ:
   - Trend Devam mı, Çıkış mı?
   - Stop nereye çekilmeli?
   - Hangi seviyeden kâr realizasyonu yapılmalı?

Üslup: Tamamen Türkçe, net, maddeler halinde, gereksiz süsleme yapmadan direkt veriye ve akıllı para hareketine odaklı.`;
  }

  // 1. Proaktif 5 Dakikalık Otomatik Analiz
  async analyzeProactive(position, multiTfData, depthData, derivativesData) {
    const oi5mStr = derivativesData?.oiDelta5m >= 0 
      ? `+${derivativesData?.oiDelta5m} USDT (+%${derivativesData?.oiDelta5mPercent}) [PARA GİRİŞİ 🟢]` 
      : `${derivativesData?.oiDelta5m} USDT (%${derivativesData?.oiDelta5mPercent}) [PARA ÇIKIŞI 🔴]`;

    const oi4hStr = derivativesData?.oiDelta4h >= 0 
      ? `+${derivativesData?.oiDelta4h} USDT (+%${derivativesData?.oiDelta4hPercent}) [BÜYÜK RESİMDE PARA GİRİŞİ 🟢]` 
      : `${derivativesData?.oiDelta4h} USDT (%${derivativesData?.oiDelta4hPercent}) [BÜYÜK RESİMDE PARA ÇIKIŞI 🔴]`;

    const prompt = `[AKILLI PARA & PROAKTİF 5 DAKİKALIK DURUM RAPORU]
Kullanıcı şu an bir pozisyonda. 2. ekrandaki para akışı (OI), emir defteri ve fonlama verilerini kullanarak analiz et:

📌 AKTİF POZİSYON:
- Sembol: ${position.symbol}
- Yön: ${position.isLong ? 'LONG 🟢' : 'SHORT 🔴'} (${position.leverage}x)
- Giriş: ${position.entryPrice} | Güncel: ${position.markPrice}
- Kâr/Zarar: %${position.pnlPercent} (${position.unRealizedProfit.toFixed(2)} USDT)
- Liq Fiyatı: ${position.liquidationPrice}

🌊 2. EKRAN: PARA GİRİŞ / ÇIKIŞ (OPEN INTEREST DELTA):
- Son 5 Dakikalık Para Akışı (5m OI Delta): ${oi5mStr}
- 4 Saatlik Büyük Resim Para Akışı (4H OI Delta): ${oi4hStr}
- Top Trader Long/Short Oranı: %${derivativesData?.topTraderLongRatio || '--'} Long / %${derivativesData?.topTraderShortRatio || '--'} Short
- Taker Alıcı/Satıcı Oranı (Piyasa Emri Baskısı): ${derivativesData?.takerBuySellRatio || 1}
- Fonlama Oranı (Funding): %${derivativesData?.fundingPercent} (${parseFloat(derivativesData?.fundingPercent) < 0 ? 'NEGATİF - Short Squeeze Baskısı' : 'Pozitif'})

📊 1. EKRAN: FİYAT & MULTI-TIMEFRAME (5m, 15m, 1h, 4h):
- 5m: Fiyat=${multiTfData['5m']?.lastClose}, EMA9=${multiTfData['5m']?.ema9}, RSI=${multiTfData['5m']?.rsi14}
- 15m: Fiyat=${multiTfData['15m']?.lastClose}, EMA9=${multiTfData['15m']?.ema9}, RSI=${multiTfData['15m']?.rsi14}
- 1H: Fiyat=${multiTfData['1h']?.lastClose}, RSI=${multiTfData['1h']?.rsi14}
- 4H: Fiyat=${multiTfData['4h']?.lastClose}, RSI=${multiTfData['4h']?.rsi14}

🧱 EMİR DEFTERİ DUVARLARI:
- Alıcı Baskısı: %${depthData?.buyPressureRatio || 50}
- En Yakın Alış Duvarları: ${JSON.stringify(depthData?.topBids || [])}
- En Yakın Satış Duvarları: ${JSON.stringify(depthData?.topAsks || [])}

Lütfen trader'a şunları açık ve net özetle:
1. Son 5 dakikada para girdi mi çıktı mı?
2. 5dk'daki bu hareket 4 saatlik büyük trend ile uyumlu mu (düzeltme mi yoksa tahtacı sessizce mal mı boşaltıyor)?
3. Tahtadaki satış/alış duvarları ve fonlama ışığında aksiyon önerin nedir (Kâr alma, Stopu yukarı çekme, Bekleme)?`;

    const contents = [{
      role: 'user',
      parts: [{ text: prompt }]
    }];

    return await this.generateContent(contents, this.getSystemPrompt());
  }

  // 2. Kullanıcının Sorusunu Cevaplama
  async answerUserQuestion(question, position, multiTfData, depthData, derivativesData, imageBase64 = null) {
    const parts = [];

    let contextText = `Kullanıcı sana şu anki işlemle ilgili soru soruyor: "${question}"\n\n`;
    if (position) {
      contextText += `AKTİF POZİSYON: ${position.symbol} ${position.isLong ? 'LONG' : 'SHORT'} ${position.leverage}x, Giriş: ${position.entryPrice}, Fiyat: ${position.markPrice}, PnL: %${position.pnlPercent}\n`;
    }
    if (multiTfData) {
      contextText += `5m RSI: ${multiTfData['5m']?.rsi14}, 15m RSI: ${multiTfData['15m']?.rsi14}, 1H RSI: ${multiTfData['1h']?.rsi14}, 4H RSI: ${multiTfData['4h']?.rsi14}\n`;
    }
    if (depthData) {
      contextText += `Satış Duvarları: ${JSON.stringify(depthData.topAsks?.slice(0, 2))}, Alış Duvarları: ${JSON.stringify(depthData.topBids?.slice(0, 2))}\n`;
    }
    if (derivativesData) {
      contextText += `Fonlama: %${derivativesData.fundingPercent}, OI: ${derivativesData.openInterest}\n`;
    }

    parts.push({ text: contextText });

    // Ekran görüntüsü varsa ekle (Vision)
    if (imageBase64) {
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: imageBase64.replace(/^data:image\/[a-z]+;base64,/, '')
        }
      });
    }

    const contents = [{ role: 'user', parts }];
    return await this.generateContent(contents, this.getSystemPrompt());
  }
}

module.exports = GeminiCoPilot;
