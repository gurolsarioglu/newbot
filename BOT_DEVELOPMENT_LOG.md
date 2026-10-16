# 📚 Kripto Bot Geliştirme Süreci ve Konuşma Kaydı

**Tarih:** 13 Ağustos 2026  
**Proje / Dizin:** `y:\takip\B-5\NewBot`  
**Depo:** `https://github.com/gurolsarioglu/takip.git`

---

## 📌 İçindekiler
1. [1. Adım: 15dk Sinyalinin Tespiti ve NewBot Klasörünün Oluşturulması](#1-adım-15dk-sinyalinin-tespiti-ve-newbot-klasörünün-oluşturulması)
2. [2. Adım: 15dk Botunun 1G (Günlük) Zaman Dilimine Dönüştürülmesi](#2-adım-15dk-botunun-1g-günlük-zaman-dilimine-dönüştürülmesi)
3. [3. Adım: 1Gpro Botu Tasarımı ve RSI Uyumsuzluk (Divergence) Formülasyonu](#3-adım-1gpro-botu-tasarımı-ve-rsi-uyumsuzluk-divergence-formülasyonu)
4. [4. Adım: 4Spro Botu Tasarımı, RSI SMA Kesişimi ve Boost Değeri Mantığı](#4-adım-4spro-botu-tasarımı-rsi-sma-kesişimi-ve-boost-değeri-mantığı)
5. [5. Adım: Tüm Botların NewBot Klasöründe Birleştirilmesi ve 15dk Botunun Eklenmesi](#5-adım-tüm-botların-newbot-klasöründe-birleştirilmesi-ve-15dk-botunun-eklenmesi)
6. [6. Adım: 4Spro Sinyal Mesaj Detayları](#6-adım-4spro-sinyal-mesaj-detayları)
7. [7. Adım: Tüm Projenin GitHub'a Aktarılması](#7-adım-tüm-projenin-githuba-aktarılması)
8. [📊 Botların Karşılaştırma Tablosu ve Çalıştırma Rehberi](#-botların-karşılaştırma-tablosu-ve-çalıştırma-rehberi)

---

## 1. Adım: 15dk Sinyalinin Tespiti ve NewBot Klasörünün Oluşturulması

### 👤 Kullanıcı Talebi:
```text
📉 [15DK] #FOLKSUSDT SELL 🔴
──────────────────
• Fiyat: 1.894
• 15dk RSI: 82 ⭐ (Sinyal)
• 1 Saatlik RSI: 67
• 4 Saatlik RSI: 64
• Günlük RSI: 54
• Stoch: 28(K)/26(D)
• Hacim: 🔥 YÜKSEK HACİM
──────────────────
🔗 Binance Futures (https://www.binance.com/en/futures/FOLKSUSDT) | ⏰ 04:03

bu sinyali 15dk bir bot vardı o üretiyor olması gerekiyor botu bul ve bana dizinde yeni klasör aç ve bir kopyasını oraya taşı klasör adı : NewBot olsun
```

### 🤖 Asistan Yanıtı ve Yapılan İşlemler:
1. **Kaynak Dosya Tespiti:** Yapılan kod taramasında bu sinyal şablonunu üreten botun `telegram-bot/hunter-15m.js` olduğu tespit edildi.
2. **NewBot Klasörü:** `y:\takip\B-5\NewBot` dizini oluşturuldu.
3. **Oluşturulan Dosyalar:**
   - `hunter-15m.js` (Botun kaynak kodu)
   - `bot.js` (Giriş noktası)
   - `package.json` (Bağımlılıklar)
   - `.env` (Ortam değişkenleri)
   - `start.bat` (Hızlı başlatıcı)
   - `README.md` (Dokümantasyon)

---

## 2. Adım: 15dk Botunun 1G (Günlük) Zaman Dilimine Dönüştürülmesi

### 👤 Kullanıcı Talebi:
```text
bu bot 15dk yerine adını 1G olarak değiştirelim ve günlük zaman dilimlerine baksın sadece zaman dilimini değiştirelim.
```

### 🤖 Asistan Yanıtı ve Yapılan İşlemler:
1. **Timeframe Güncellemesi:** `TIMEFRAME = '15m'` ➔ `TIMEFRAME = '1d'` olarak güncellendi.
2. **Kriter:** Günlük RSI $\le 20$ (Buy) ve Günlük RSI $\ge 80$ (Sell) koşullarına uyarlandı.
3. **Dosya Adı:** `hunter-15m.js` ➔ `hunter-1g.js` olarak güncellendi.
4. **Sinyal Başlığı:** `[15DK]` ➔ `[1G]` ve `• Günlük RSI: ... (Sinyal)` şeklinde revize edildi.

---

## 3. Adım: 1Gpro Botu Tasarımı ve RSI Uyumsuzluk (Divergence) Formülasyonu

### 👤 Kullanıcı Talebi:
```text
yeni bir bot yapalım 1Gpro olsun ismi burda bir önceki 1g Bot ile herşey aynı olacak 1 saatlikte - 4 saatlikte ve var ise haftalıkta bir uyumsuzluk yanına uyumsuzluğa göre rengi yeşil yada kırmızı bir ünlem eklesin. (uyumsuzluk başlangıç mumu : 15:00 yada 09:00 yada çarşamba günü gibi yazsın) kodlamaya geçmeden önce bana bir örnek mesaj içeriği ve uyumsuzluğu nasıl tespit ettiğin ile ilgili olan yaklaşımını ve formülünü yaz.
```

### 🤖 Asistan Yanıtı (Formülasyon ve Açıklama):

#### A. Uyumsuzluk (Divergence) Tespit Yaklaşımı & Formülü
1. **Pozitif (Boğa / Bullish) Uyumsuzluk (🟢❗):**
   - **Kural:** Fiyat daha düşük veya eşit dip yaparken ($LL$), RSI daha yüksek dip ($HL$) yapar.
   - **Formül:** $\text{Fiyat}_{son} \le \text{Fiyat}_{önceki} \quad \text{ve} \quad \text{RSI}_{son} > \text{RSI}_{önceki} \quad (\text{RSI} \le 55)$
   - **İşaret:** `🟢❗ (Pozitif Uyumsuzluk | 09:00 - 13 Ağu)`

2. **Negatif (Ayı / Bearish) Uyumsuzluk (🔴❗):**
   - **Kural:** Fiyat daha yüksek veya eşit tepe yaparken ($HH$), RSI daha düşük tepe ($LH$) yapar.
   - **Formül:** $\text{Fiyat}_{son} \ge \text{Fiyat}_{önceki} \quad \text{ve} \quad \text{RSI}_{son} < \text{RSI}_{önceki} \quad (\text{RSI} \ge 45)$
   - **İşaret:** `🔴❗ (Negatif Uyumsuzluk | Pazartesi, 28 Temmuz 2026)`

#### B. Zaman Formatlama Kuralları:
- **1 Saatlik (1H):** `Saat - Gün Ay` $\rightarrow$ `09:00 - 13 Ağu`
- **4 Saatlik (4H):** `Saat - Gün Ay GünAdı` $\rightarrow$ `15:00 - 12 Ağu Çarşamba`
- **Haftalık (1W):** `GünAdı, Gün Ay Yıl` $\rightarrow$ `Pazartesi, 28 Temmuz 2026`

#### C. Örnek Mesaj Formatı:
```text
📈 [1Gpro] #ETHUSDT BUY 🟢
──────────────────
• Fiyat: 2,654.20
• Günlük RSI: 19 ⭐⭐ (Sinyal)
• 1 Saatlik RSI: 28 🟢❗ (Pozitif Uyumsuzluk | 09:00 - 13 Ağu)
• 4 Saatlik RSI: 31 🟢❗ (Pozitif Uyumsuzluk | 15:00 - 12 Ağu Çarşamba)
• Haftalık RSI: 42
• Stoch: 15(K)/12(D)
• Hacim: 🔥 YÜKSEK HACİM
──────────────────
🔗 Binance Futures | ⏰ 10:15
```

---

## 4. Adım: 4Spro Botu Tasarımı, RSI SMA Kesişimi ve Boost Değeri Mantığı

### 👤 Kullanıcı Talebi:
```text
şimdi bir yeni bot daha yapacağız 4S zaman dilimini bakacak. kurallara aynen geçerli mesaj içeriğine ilave Strategy: 4H RSI SMA CROSSED
Boost Value: +4.55% 
Current Price: 0.002635
Previous Price: 0.002625 bu bilgileri ekliyor olacağız. kodlamaya geçmeden önce bana örnek bir mesaj içeriği göster RSI SMA kestiğinin nasıl anladığını da bana formülünü yaz. açıkla
```

### 👤 Kullanıcı Ek Sorusu (Boost Değeri):
```text
boost value de - olmaz diye düşünüyorum bunu bana nasıl düzelteceğimizi açıkla
```

### 🤖 Asistan Yanıtı (RSI SMA Cross & Pozitif Boost Mantığı):

#### A. RSI SMA Kesişimi Formülü:
1. **RSI Serisi:** Kapanışlardan her mum için 14'lük RSI hesaplanır ($RSI_0, \dots, RSI_t$).
2. **RSI'ın SMA'sı:** Son 14 mumluk RSI değerlerinin aritmetik ortalaması alınır:
   $$SMA_{RSI}[t] = \frac{1}{14} \sum_{i=0}^{13} RSI[t-i]$$
3. **Kesişim Kuralları:**
   - **Bullish Cross (Yukarı Kesişim 🟢):** $RSI[t-1] \le SMA[t-1] \quad \text{ve} \quad RSI[t] > SMA[t]$ $\rightarrow$ `BUY`
   - **Bearish Cross (Aşağı Kesişim 🔴):** $RSI[t-1] \ge SMA[t-1] \quad \text{ve} \quad RSI[t] < SMA[t]$ $\rightarrow$ `SELL`

#### B. Boost Value'nun Pozitif (`+`) Yapılması:
"Boost" (İvme / Şiddet), hareketin yönünden bağımsız olarak **şiddetinin büyüklüğünü** temsil eder. Bu nedenle Mutlak Değer ($|x|$ / `Math.abs`) kullanılarak her zaman pozitif (`+`) gösterilir:
$$\text{Boost Value} = \left| \frac{\text{Current Price} - \text{Previous Price}}{\text{Previous Price}} \right| \times 100$$

#### C. Kod Implementasyonu:
```javascript
const rawBoost = Math.abs((price - prev) / prev * 100);
const boost = `+${rawBoost.toFixed(2)}%`; // Örn: +4.55% veya +3.20%
```

---

## 5. Adım: Tüm Botların NewBot Klasöründe Birleştirilmesi ve 15dk Botunun Eklenmesi

### 👤 Kullanıcı Talebi:
```text
bugün oluşturduğumuz bütün botları newbot klasörüne taşı orada kalsın.
newbot altına ilk konuştuğumuz 15dk botunun bir kopyasını da taşı sonra tüm projeyi githuba gönder.
```

### 🤖 Asistan Yanıtı ve Yapılan İşlemler:
Tüm botlar `y:\takip\B-5\NewBot` klasöründe konsolide edildi:
1. `hunter-15m.js` (15 Dakikalık Hunter Bot)
2. `hunter-1g.js` (1G Günlük Hunter Bot)
3. `hunter-1gpro.js` (1Gpro Günlük + MTF Uyumsuzluk Botu)
4. `hunter-4spro.js` (4Spro 4 Saatlik RSI SMA Cross + MTF Uyumsuzluk Botu)
5. `start_15m.bat`, `start_1g.bat`, `start_1gpro.bat`, `start_4spro.bat`
6. `start_all.bat` (Tek tıkla tüm botları ayrı pencerelerde başlatan araç)

---

## 6. Adım: 4Spro Sinyal Mesaj Detayları

### 👤 Kullanıcı Talebi:
```text
4spro mesaj içeriğini göster
```

### 🤖 Asistan Yanıtı (4Spro Mesaj Şablonları):

#### 🟢 4Spro BUY (Long) Mesajı:
```text
📈 [4S] #FOLKSUSDT BUY 🟢
──────────────────
Strategy: 4H RSI SMA CROSSED
Boost Value: +4.55%
Current Price: 0.002635
Previous Price: 0.002625
──────────────────
• Fiyat: 0.002635
• 4 Saatlik RSI: 34 ⭐ (RSI: 34 > SMA: 30) (Sinyal)
• 1 Saatlik RSI: 42 🟢❗ (Pozitif Uyumsuzluk | 08:00 - 13 Ağu)
• Günlük RSI: 48
• Haftalık RSI: 52 🟢❗ (Pozitif Uyumsuzluk | Pazartesi, 28 Temmuz 2026)
• Stoch: 35(K)/28(D)
• Hacim: 🔥 YÜKSEK HACİM
──────────────────
🔗 Binance Futures | ⏰ 10:15
```

#### 🔴 4Spro SELL (Short) Mesajı:
```text
📉 [4S] #SOLUSDT SELL 🔴
──────────────────
Strategy: 4H RSI SMA CROSSED
Boost Value: +3.20%
Current Price: 185.4000
Previous Price: 191.5000
──────────────────
• Fiyat: 185.4000
• 4 Saatlik RSI: 68 ⭐ (RSI: 68 < SMA: 72) (Sinyal)
• 1 Saatlik RSI: 71 🔴❗ (Negatif Uyumsuzluk | 06:00 - 13 Ağu)
• Günlük RSI: 64
• Haftalık RSI: 76 🔴❗ (Negatif Uyumsuzluk | Çarşamba, 15 Temmuz 2026)
• Stoch: 82(K)/88(D)
• Hacim: 🔥 YÜKSEK HACİM
──────────────────
🔗 Binance Futures | ⏰ 13:00
```

---

## 7. Adım: Tüm Projenin GitHub'a Aktarılması

### 🤖 Yapılan İşlemler:
1. `git add -A` ile tüm yeni botlar, scriptler ve batch dosyaları stage edildi.
2. `git commit -m "Add NewBot suite (15m, 1G, 1Gpro, 4Spro) and project updates"` commit'i oluşturuldu.
3. `git push origin master` komutu ile değişiklikler GitHub uzak deposuna yüklendi.
4. **Hedef Depo:** `https://github.com/gurolsarioglu/takip.git`

---

## 📊 Botların Karşılaştırma Tablosu ve Çalıştırma Rehberi

| Bot Adı | Dosya Adı | Zaman Dilimi | Temel Strateji | MTF Uyumsuzluk Taraması | Başlatıcı |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **15dk Hunter** | `hunter-15m.js` | 15 Dakika (15m) | Aşırı RSI ($\le 20$ / $\ge 80$) | 4H ve 1D Detay Analizi | `start_15m.bat` |
| **1G Hunter** | `hunter-1g.js` | 1 Gün (1D) | Aşırı RSI ($\le 20$ / $\ge 80$) | 1H, 4H, 1W RSI Kontrolü | `start_1g.bat` |
| **1Gpro Hunter** | `hunter-1gpro.js` | 1 Gün (1D) | Aşırı RSI + MTF Uyumsuzluk | **1H, 4H, 1W (Başlangıç Tarihli)** | `start_1gpro.bat` |
| **4Spro Hunter** | `hunter-4spro.js` | 4 Saat (4H) | **RSI SMA Kesişimi + Boost (+)** | **1H, 1D, 1W (Başlangıç Tarihli)** | `start_4spro.bat` |

### 🚀 Terminalden Başlatma Komutları:
```powershell
cd y:\takip\B-5\NewBot

# İlgili botu çalıştırmak için:
node hunter-15m.js     # 15dk Botu
node hunter-1g.js      # 1G Botu
node hunter-1gpro.js   # 1Gpro Botu
node hunter-4spro.js   # 4Spro Botu
```

---

## 8. Adım: 15m ve 4Spro Botlarına Trader Positioning & Market Exposure Entegrasyonu

### 👤 Kullanıcı Talebi:
```text
NewBot klasör de yer alan 15m ve 4spro bot a iki bilgi eklemek istiyorum örnek eklemek istediğim bilgiyi paylaşıyorum bunu nasıl yapabiliriz. Bana detaylı bir analiz çıkar.
Trader Positioning: 68.21% 🟢
Market Exposure: 73.03% 🟢

Trader Positioning: 71.64% 🔴
Market Exposure: 69.38% 🔴
```

### 🤖 Yapılan İşlemler & Uygulama Detayları:
1. **Veri Kaynakları:**
   - **Trader Positioning:** Binance Futures `/futures/data/topLongShortAccountRatio` (En iyi trader hesap sayısı oranı)
   - **Market Exposure:** Binance Futures `/futures/data/topLongShortPositionRatio` (En iyi trader net pozisyon hacmi oranı)
2. **Dinamik Eşik Mantığı (`RATIO_THRESHOLD = 55`):**
   - Dominant taraf Long ve $\ge 55\%$ ise ➔ `XX.XX% 🟢`
   - Dominant taraf Short ve $\ge 55\%$ ise ➔ `XX.XX% 🔴`
   - Dominant taraf $\%50.00 - \%54.99$ arasında ise ➔ `XX.XX% ⚪` (Nötr / Kararsız Bölge)
3. **Güncellenen Dosyalar:**
   - `hunter-15m.js`: 15m periyotlu oranlar çekilerek konsol ve dashboard'a eklendi.
   - `hunter-4spro.js`: 4h periyotlu oranlar çekilerek konsol, Telegram ve dashboard'a eklendi.
   - `frontend/js/dashboard.js`: Sinyal kartlarında ilgili metriklerin gösterimi sağlandı.

