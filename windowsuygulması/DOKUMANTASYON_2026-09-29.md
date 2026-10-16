# 🚀 AI Trading Co-Pilot (Çoklu Ekran Masaüstü Asistanı)
**Tarih:** 29 Eylül 2026  
**Klasör:** `windowsuygulması/`  
**Durum:** Konsept & Mimari Tasarım, Canlı Vaka Analizi  

---

## 1. Proje Vizyonu ve Amacı

Kripto para ve vadeli işlemler (Futures) ticaretinde trader'lar genellikle 2 veya daha fazla ekranda aynı anda onlarca veriyi takip eder. 

**Hedef:**
Kullanıcı işlem açtığında **hiçbir şeye basmak zorunda kalmadan**:
1. **Binance Read-Only API** ile pozisyonu anında otomatik algılayan,
2. **Her 5 dakikalık periyotta (veya mum kapanışında)** proaktif olarak kendiliğinden analiz yapıp chat ekranına tavsiye yazan,
3. Büyük resmi görmek için **5dk, 15dk, 1 Saat ve 4 Saatlik (Multi-Timeframe)** zaman dilimlerini aynı anda harmanlayan,
4. Derinlik tablosundaki (Order Book) alış/satış duvarlarını, Fonlama Oranını (Funding) ve Açık Pozisyonu (OI) süzüp kâr alım/stop-loss önerisi sunan,
5. Kullanıcı soru sorduğunda (mikrofon veya chat ile) güncel durumu anında yanıtlayan **Otonom Masaüstü AI Co-Pilot** geliştirmek.

---

## 2. Sistem Mimarisi & Çalışma Akışı

```
[ Binance Futures Hesabı ] (Read-Only API)
            │ (Pozisyon Algılandı: Örn: NMRUSDT LONG @ 13.784)
            ▼
[ AI Co-Pilot Arka Plan Motoru ]
    ├── 1. 2. Ekran Verileri: Para Akışı (OI Delta 5m vs 4H), Fonlama (FR), Top Trader Rasyoları
    ├── 2. Emir Defteri (Order Book): Alış/Satış Likidite Duvarları, Taker Alıcı/Satıcı Baskısı
    ├── 3. Çoklu Zaman Dilimi (5m, 15m, 1h, 4h Mumları & İndikatörler)
    └── 4. Proaktif 5dk Döngüsü (Kullanıcı sormadan otomatik durum & akıllı para raporu)
            │
            ▼
[ Google Gemini AI (Pro / Flash) Akıllı Para Motoru ]
    - "Fiyat yükseliyor ama 5m OI düşüyor mu? (Short squeeze mi, yoksa sessiz kâr satışı mı?)"
    - "5m'de mikro para çıkışı varken 4H'ta devasa para girişi devam ediyor mu? (Düzeltme vs Dağıtım)"
    - "Büyükler tahtacıyı ürkütmeden gizlice mal mı boşaltıyor?"
            │
            ▼
[ Masaüstü Şık Co-Pilot Arayüzü (Chat + 2. Ekran Para Radarı) ]
    - [Canlı Radar]: 5M OI: +145K $ | 4H OI: +2.1M $ | FR: -%0.097 | Top Trader: %62 Long
    - [Otomatik Tavsiye]: "5dk'da 140k $ para girişi var, 4 saatlik trend ile tam uyumlu. Büyükler pozisyonda kalmaya devam ediyor. 14.10'da 800k satış duvarı var. Stopu 13.85'e çekip izlemeye devam et."
```

### Önerilen Teknoloji Yığını:
1. **Masaüstü Arayüzü & Motor:**
   - **Python (PyQt6 / CustomTkinter):** Ekran yakalama (`mss`), görüntü işleme (`Pillow/OpenCV`) ve AI API'leri için en hızlı ve hafif çözüm.
   - *Alternatif:* **Electron / Tauri (JS/TS):** Web teknolojileriyle modern arayüz + Node.js desktop capture.
2. **Ekran Yakalama (Multi-Monitor Capture):**
   - Python'un `mss` kütüphanesi 2 ekranı 50 milisaniyede tam çözünürlükte yakalayabilir.
3. **AI Vision & Karar Motoru:**
   - Gemini Multimodal Vision API (düşük maliyet, yüksek hız, grafik ve tablo okumada üstün başarı).
4. **Opsiyonel Doğrudan Veri Beslemesi (Hibrit Mod):**
   - Sadece ekrandan okumakla kalmayıp kullanıcının izlediği sembolü algılayıp Binance API üzerinden anlık orderbook ve trade akışını da birleştirerek %100 hassasiyet sağlama.

---

## 3. Canlı Deneme & Vaka Analizi (NMRUSDT - 29.09.2026)

Kullanıcının sağladığı 2 ekrana dayalı canlı test analizi:

### Ekran 1: Binance Futures 5m Grafik & Pozisyon Durumu
* **Sembol:** NMRUSDT Perpetual
* **Açılan Pozisyon:** Long (5x Kaldıraç, İzole)
* **Giriş Fiyatı:** `13.7840` | **Güncel Fiyat:** `13.901`
* **Mevcut Kâr/Zarar (PnL):** `+0.15 USDT` (`+%4.02`)
* **Likidasyon Seviyesi:** `11.199` (Fiyata %18+ mesafede, 5x için son derece güvenli).
* **Fiyat & Göstergeler:**
  * Günlük +%39 yükseliş sonrası 16.50 tepesinden 13.00-13.40 bölgesine sağlıklı bir düzeltme yapmış.
  * Fiyat **EMA(9) (13.75)** üzerine geri tırmanmış.
  * RSI(14) 49.6 seviyesinde; aşırı satımdan çıkıp pozitif momentum bölgesine (50 üzerine) geçiyor.
  * Emir defterinde alıcı baskısı %54 seviyesinde.

### Ekran 2: Binance Futures Metrik & Türev Verileri
* **Fonlama Oranı (Funding Rate):** `-%0.097` ile `-%0.048` arasında **aşırı negatif**. Piyasadaki satıcılar (short'çular) long'lara yüksek oranda fonlama ödüyor. Bu durum klasik bir **Short Squeeze (yukarı patlama)** zeminidir.
* **Top Trader Long/Short Ratio (Accounts):** 07:15'te 1.10 dip seviyesinden hızla **1.36'ya** yükselmiş. Akıllı para (büyük cüzdanlar) long tarafına geçmiş.
* **Taker Buy/Sell Volume:** Son barlarda güçlü yeşil Taker Buy hacim sıçraması (agresif piyasa alımı) gelmiş.
* **Open Interest (OI):** Düşüş durulmuş, 710k seviyesinde konsolide oluyor.

### 🎯 Karar & Değerlendirme
* **Pozisyon Yönü:** **BAŞARILI / DOĞRU.**
* **Giriş Noktası:** 13.784 girişi EMA desteği kırılımı ve funding negatifliğiyle çok uyumlu.
* **Aksiyon Önerisi:**
  1. **Stop-Loss:** Fiyat 13.90'a çıktığı için stop seviyesini başa baş noktasına (`13.79`) veya `13.65` altına çekerek riski sıfırlamak.
  2. **Take-Profit (Hedef):** İlk kâr alma `14.20 - 14.50` direnç aralığı, ana hedef `15.00+`.

---

## 4. Geliştirme Yol Haritası (Adım Adım)

- [ ] **Aşama 1 (PoC):** Python `mss` ile 2 ekranı yakalayıp Gemini Vision API'ye gönderen minimal test scripti.
- [ ] **Aşama 2 (Tetikleyici):** Global kısayol tuşu (örneğin `Ctrl + Space` veya `F8`) ile basıldığı anda ekranları çekip AI'a soran yapı.
- [ ] **Aşama 3 (Ses / Chat Arayüzü):** Kullanıcının mikrofonundan soruyu alıp ("Bu pozisyonu alayım mı?") ekran görüntüsüyle birlikte AI'a gönderip yanıtı sesli/yazılı bildiren arayüz.
- [ ] **Aşama 4 (Bot Entegrasyonu):** Mevcut `NewBot` altyapısı ile haberleşen sinyal teyit modülü.
