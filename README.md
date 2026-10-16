# 🤖 NewBot Suite (Tüm Yeni Nesil Botlar)

Bu klasör, Binance Futures USDT Perpetual paritelerini tarayan tüm yeni nesil botları bir arada barındırır.

---

### 📦 Klasördeki Botlar

| Bot Dosyası | Başlatma Dosyası | Zaman Dilimi | Strateji ve Özellikler |
| :--- | :--- | :--- | :--- |
| **[hunter-15m.js](file:///y:/takip/B-5/NewBot/hunter-15m.js)** | `start_15m.bat` | **15dk (15m)** | 15 dakikalık aşırı RSI ($\le 20$ / $\ge 80$) tespiti |
| **[hunter-1g.js](file:///y:/takip/B-5/NewBot/hunter-1g.js)** | `start_1g.bat` | **1G (Günlük)** | Günlük aşırı RSI ($\le 20$ / $\ge 80$) tespiti |
| **[hunter-1gpro.js](file:///y:/takip/B-5/NewBot/hunter-1gpro.js)** | `start_1gpro.bat` | **1G (Günlük)** | Günlük RSI + **1H / 4H / 1W MTF Uyumsuzluk** tespiti (Tarih, saat ve gün bilgili) |
| **[hunter-4spro.js](file:///y:/takip/B-5/NewBot/hunter-4spro.js)** | `start_4spro.bat` | **4S (4 Saatlik)** | **4H RSI SMA Kesişimi**, Pozitif Boost Value (`+`), **1H / 1D / 1W MTF Uyumsuzluk** |

---

### 🚀 Nasıl Çalıştırılır?

#### 1. Tek Tek Başlatma (Çift Tıklama ile):
- **15dk Botu:** `start_15m.bat`
- **1G Botu:** `start_1g.bat`
- **1Gpro Botu:** `start_1gpro.bat`
- **4Spro Botu:** `start_4spro.bat`

#### 2. Hepsini Birden Başlatma:
- `start_all.bat` dosyasına çift tıklayarak tüm botları ayrı konsol pencerelerinde tek seferde başlatabilirsiniz.

#### 3. Terminal ile:
```powershell
cd y:\takip\B-5\NewBot

# 15dk Botu için:
node hunter-15m.js

# 1G Botu için:
node hunter-1g.js

# 1Gpro Botu için:
node hunter-1gpro.js

# 4Spro Botu için:
node hunter-4spro.js
```

---

### 🤖 Telegram Bildirimleri
1. [.env](file:///y:/takip/B-5/NewBot/.env) dosyasını açın.
2. `TELEGRAM_BOT_TOKEN=...` kısmına BotFather'dan aldığınız token'ı yapıştırın.
3. Botunuza Telegram'dan `/start` komutunu gönderin.
