# Alpha Terminal — Quant Mimari Dönüşüm ve Kök Neden Çözüm Planı (`yapılacaklar.md`)

**Hedef Ajan:** Antigravity (Gemini 3.8 High)  
**Rol ve Kimlik:** Kıdemli Finansal Sistemler Yazılım Mimarı (Quant & High-Frequency Trading Systems Architect)  
**Proje:** Alpha Terminal (`terminal-server.js`, `bots/`, `services/`, `public/`)  
**Amaç:** Arayüz (UI/CSS) yamaları ve sahte/periyodik sinyal üretimi (`setInterval` + `seedInitialLivePool`) nedeniyle oluşan kısır döngüyü bitirmek; mevcut kullanıcı arayüzünü, 9 botun görsel kart şablonlarını ve API kontratlarını **hiç bozmadan**, arka plandaki **Veri Akışı (Market Data), Fiyat Hassasiyeti (`tickSize`) ve İndikatör Hesaplama Çekirdeğini (Quant Engine)** TradingView ve Binance USD-M Futures standartlarında yeniden inşa etmek.

## 1. Kesin Yasaklar ve Kırmızı Çizgiler (Anti-Patterns — Derhal Kaldırılacaklar)

Geliştirme sırasında aşağıdaki yaklaşımların kullanılması **kesinlikle yasaktır** ve mevcut kodda bulunan bu yapılar Faz 1'de temizlenecektir:

1. **Sahte Canlılık ve Tohumlama (Seeding) Yasağı:**
   * `bots/index.js` içerisindeki `seedInitialLivePool` fonksiyonu ve sunucu açılışında "ekran boş kalmasın" diye rastgele/anlık fiyatlardan uydurulan 10 sinyal üretimi **tamamen silinecektir**.
   * `bots/strategies/*.bot.js` dosyalarının içinde gömülü duran statik/örnek başlangıç sinyalleri (`IOSTUSDT`, `SUIUSDT`, `IMXUSDT`, `QNTUSDT` vb. hardcoded diziler) **tamamen kaldırılacaktır**. Sistem yalnızca gerçek piyasa koşulu oluştuğunda sinyal üretecektir.
2. **Zamanlayıcı (`setInterval`) ile Kör Sinyal Üretimi Yasağı:**
   * `bots/index.js` içindeki 12 sn, 20 sn, 30 sn, 45 sn, 60 sn'lik `setInterval` döngüleriyle sadece 28 sembolü (`TOP_FUTURES_SYMBOLS`) tarayıp zorla sinyal basan sahte arka plan motoru **iptal edilecektir**. Sinyal üretimi süreye değil, **WebSocket olaylarına (Event-Driven) ve gerçek matematiksel eşiklere** bağlanacaktır.
3. **Sezgisel Fiyat Basamağı Tahmini (`detectCoinPrecision` & Magnitude Rules) Yasağı:**
   * `services/price-formatter.js`, `public/core/price-formatter.js`, `public/plugins/chart/multi-chart.plugin.js` ve `chart.plugin.js` içindeki *"fiyat `< 0.01` ise 6 basamak yap"* veya *"son mumların sonundaki sıfırları say"* (`detectCoinPrecision`) mantığı **tamamen kaldırılacaktır**.
   * Bir coinin ondalık basamak sayısı fiyattan tahmin edilemez; yalnızca Binance `GET /fapi/v1/exchangeInfo` içerisindeki resmi `PRICE_FILTER -> tickSize` kontrat tanımından okunacaktır.
4. **Isınmasız (Warm-up Olmadan) İndikatör Hesaplama Yasağı:**
   * Tekil ticker verisiyle veya 14–20 mumluk kısa dizilerle Wilder's RSI(14), Stochastic RSI, WaveTrend (WT) ve EMA200 hesaplamak yasaktır. Her aktif parite ve zaman dilimi için bellekte en az **250 mumluk kayan pencere (Ring Buffer)** tutulacaktır.
5. **Yüzeysel DOM Testi ile "PASS" Raporlama Yasağı:**
   * Test süitleri sadece "ekranda kart var mı / tarih formatı doğru mu" kontrolü yapmayacaktır; indikatör çıktılarının TradingView PineScript v5 referans formülleriyle virgülden sonra 2 basamak (`±0.05` tolerans) eşleştiği matematiksel olarak doğrulanacaktır.

## 2. Mevcut Durum vs. Hedeflenen Quant Mimarisi

| Mimari Katman | Mevcut Hatalı Yapı (`yapılanlar.txt`) | Yeni Kurulacak Quant Mimari (Hedef) |
| :--- | :--- | :--- |
| **Sembol & Tick Hassasiyeti** | `detectCoinPrecision` + Magnitude (`abs < 0.01 -> 6`) tahmini | `SymbolRegistryService`: `/fapi/v1/exchangeInfo` üzerinden 745+ sembolün gerçek `tickSize` ve `minMove` haritası |
| **Piyasa Veri Akışı** | Sadece 28 sembolde (`TOP_FUTURES_SYMBOLS`) `setInterval` + REST polling | **İki Aşamalı Huni (Two-Stage Funnel):** Aşama 1'de WebSocket `!miniTicker@arr` ile 745 coinin tamamını anlık izleme; Aşama 2'de aday coinler için Kline Ring Buffer |
| **İndikatör Motoru** | Bot dosyalarına dağılmış yüzeysel/eksik formüller | Merkezi `QuantIndicatorsService`: 250 mum ısınmalı (warm-up) Wilder RSI, StochRSI, WaveTrend, EMA200, Pivot ve OBV/Volume SMA |
| **Türev Veriler (OI, L/S, FR)** | Her bota dağınık istek veya statik/eksik veri | `DerivativesEnricherService`: Sadece teknik ön filtreyi geçen aday coinler için Rate-Limit korumalı (Token Bucket + 60sn TTL Cache) OI, Balina L/S ve Funding çekimi |
| **Sinyal Zamanlaması** | Mum kapanmadan (intrabar) rastgele tetikleme ve mükerrer kartlar | Yapısal botlarda (`DIV`, `4S`, `4SS`, `Hammer`) **Mum Kapanışı (`k.x === true`)** zorunluluğu; anlık botlarda (`M1-A`, `M1P`, `V3-A`) **Sembol Bazlı Cooldown & Deduplication** |

## 3. Adım Adım Uygulama Fazları (İcra Planı)

Aşağıdaki 6 fazı sırasıyla, mevcut ön yüz (HTML/CSS/Plugin) yapısını ve `/api/signals` HTTP kontratlarını bozmadan uygula.

### Faz 1: Borsa Kontrat Kayıt Defteri (`SymbolRegistry`) ve Kesin Fiyat Hassasiyeti

**Hedef:** Fiyat yuvarlama, sıfır kırpma (`0.004890` -> `0.0049`) ve yapay sıfır ekleme (`1.8876000`) sorunlarını borsanın resmi kontrat tanımlarıyla kökten çözmek.

1. **`services/symbol-registry.service.js` Dosyasını Oluştur:**
   * Sunucu başlarken (`terminal-server.js` boot aşamasında) ve her 6 saatte bir `https://fapi.binance.com/fapi/v1/exchangeInfo` uç noktasını çek.
   * `status === 'TRADING'` ve `contractType === 'PERPETUAL'` olan tüm `USDT` pariteleri için bellekte (`Map`) şu yapıyı sakla:
     * `tickSize` (`filters` içindeki `PRICE_FILTER.tickSize` string değeri, örn: `"0.0001000"` -> anlamlı ondalık sayısı `decimals`: `4`, `minMove`: `0.0001`).
     * `stepSize` (`LOT_SIZE.stepSize`).
     * Not: `tickSize` içindeki ondalık basamak sayısını hesaplarken sondaki anlamsız sıfırları temizleyerek gerçek adım basamağını bul (`"0.0100"` -> `decimals = 2, minMove = 0.01`; `"0.0000100"` -> `decimals = 5, minMove = 0.00001`).
2. **`services/price-formatter.js` ve `public/core/price-formatter.js` Güncellemesi:**
   * `formatPrice(price, symbol)` fonksiyonunu doğrudan `SymbolRegistry.getPrecision(symbol)` kullanacak şekilde güncelle.
   * Sembol biliniyorsa fiyatı tam olarak o sembolün `decimals` basamağına (`Number(price).toFixed(decimals)`) formatla; böylece ne eksik basamak kalsın ne de Binance'in ham string padding'inden gelen 7-8 sıfır (`1.8876000`) ekrana yansısın.
3. **Ön Yüz Grafik Eksen Entegrasyonu (`multi-chart.plugin.js` & `chart.plugin.js`):**
   * `GET /api/exchange-info` (veya `/api/watchlist` içine gömülü `decimals` ve `minMove` alanları) üzerinden ön yüze tüm sembollerin resmi `decimals` ve `minMove` tablosunu gönder.
   * `detectCoinPrecision(rawData)` fonksiyonunu sil; yerine doğrudan `SymbolRegistry`'den gelen `{ type: 'price', precision: symbolDecimals, minMove: symbolMinMove }` değerini Lightweight Charts serilerine ata.

### Faz 2: İki Aşamalı Piyasa Veri Motoru (`MarketDataEngine`) ve 250 Mumluk Ring Buffer

**Hedef:** 28 sembol kısıtlamasından kurtulup 745+ vadeli paritenin tamamını Binance IP Rate Limit'ine (`HTTP 429 / 418`) takılmadan gerçek zamanlı taramak.

1. **`services/market-data-engine.service.js` Dosyasını Oluştur:**
   * **Aşama 1 — Geniş Piyasa Radarı (WebSocket `!miniTicker@arr` + `!markPrice@arr@1s`):**
     * Backend üzerinde Binance Futures WebSocket (`wss://fstream.binance.com/ws/!miniTicker@arr` ve `!markPrice@arr@1s`) bağlantısı kur (Otomatik `ping/pong` ve Exponential Backoff Reconnect destekli).
     * 745 coinin tamamı için bellekte son 60 saniyelik kayan fiyat/hacim penceresi (`SlidingWindow`) tut. Böylece `M1-A` (1m ani düşüş), `M1 Premium` (1m ani sıçrama), `V3-A` (Hacim patlaması) ve `FR` (Funding Rate değişimi) için 745 coinin tamamında anlık ön filtreleme yap.
   * **Aşama 2 — Dinamik Kline Havuzu ve 250 Mumluk Ring Buffer:**
     * Yüksek hacimli ana coinler (Top 60 likit parite) + Aşama 1'de anlık volatilite/hacim anomalisi gösteren dinamik aday coinler için çoklu Kline WebSocket akışlarını (`1m`, `5m`, `15m`, `1h`, `4h`, `1d`) dinle.
     * Her `(symbol, interval)` çifti ilk kez izlemeye alındığında bir kez REST `/fapi/v1/klines?symbol=X&interval=Y&limit=250` çekerek bellekteki `RingBuffer(250)` yapısını doldur (Warm-up); sonrasında gelen her WebSocket `kline` mesajıyla son mumu güncelle, `k.x === true` (mum kapanışı) geldiğinde mumu kesinleştirip yeni muma geç.
   * **Rate Limit Koruması (Token Bucket Queue):**
     * Tüm REST `/fapi/v1/*` ve `/futures/data/*` isteklerini tek bir hız sınırlayıcı kuyruktan (dakikada maksimum ağırlık bütçesi kontrolü ve `x-mbx-used-weight-1m` header takibi ile) geçir.

### Faz 3: Gerçek Quant İndikatör Motoru (`QuantIndicatorsService`)

**Hedef:** Tüm botların kullandığı matematiksel indikatörleri tek bir merkezi, birim testli ve TradingView PineScript v5 ile birebir aynı sonucu üreten modülde toplamak.

1. **`services/quant-indicators.service.js` Dosyasını Oluştur ve Aşağıdaki Formülleri Eksiksiz Kodla:**
   * **Wilder's RSI (14) ve RSI-SMA (14):**
     * İlk 14 mum için basit ortalama kazanç/kayıp, 15. mumdan 250. muma kadar Wilder RMA düzleştirmesi:
       $$\text{AvgGain}_t = \frac{\text{AvgGain}_{t-1} \times 13 + \text{Gain}_t}{14}, \quad \text{AvgLoss}_t = \frac{\text{AvgLoss}_{t-1} \times 13 + \text{Loss}_t}{14}$$
     * RSI serisi üzerinden 14 periyotluk SMA hesapla (Divergence ve kesişim botları için).
   * **Stochastic RSI (14, 14, 3, 3):**
     * Hesaplanan RSI(14) dizisinin son 14 değerindeki `Lowest(RSI, 14)` ve `Highest(RSI, 14)` üzerinden `%K = SMA(StochRSI, 3)` ve `%D = SMA(%K, 3)` değerlerini üret (`0–100` ölçeğinde).
   * **WaveTrend Osilatörü — WT (10, 21) [LazyBear Standardı]:**
     * `ap = (high + low + close) / 3` (HLC3)
     * `esa = EMA(ap, 10)`
     * `d = EMA(abs(ap - esa), 10)`
     * `ci = (ap - esa) / (0.015 * d)`
     * `wt1 = EMA(ci, 21)` ve `wt2 = SMA(wt1, 4)`
     * Kesişim (`wt1` ve `wt2` cross) ve aşırı satım/alım (`<= -60` / `>= +60`) durumlarını döndür.
   * **EMA (20, 50, 200) ve Klasik/Seanslık Pivot Noktaları:**
     * 250 mum üzerinden gerçek `EMA(200)` hesabı.
     * Bir önceki tamamlanmış günün/seansın `High, Low, Close` değerlerinden `P = (H + L + C) / 3`, `S1, S2, R1, R2` seviyeleri ve anlık fiyatın en yakın pivota yüzdesel uzaklığı (`pivotDistancePct`).
   * **Hacim Sıçraması ($\Delta\text{Vol}\%$) ve Gerçek Uyumsuzluk (Pivot Divergence) Algılayıcı:**
     * $\Delta\text{Vol}\% = \frac{\text{Vol}_{\text{current}} - \text{SMA}(\text{Vol}_{\text{closed}}, 20)}{\text{SMA}(\text{Vol}_{\text{closed}}, 20)} \times 100$
     * **Pivot Lookback Divergence (Boğa & Ayı):** Son 30 kapanmış mum içinde yerel fiyat dipleri (`Pivot Low` — sağında ve solunda en az 2 daha yüksek dip olan bar) ile aynı barlardaki RSI diplerini karşılaştır:
       * **Boğa Uyumsuzluğu (Bullish Div 🟢):** $\text{Price}_{\text{Low},2} < \text{Price}_{\text{Low},1}$ iken $\text{RSI}_{\text{Low},2} > \text{RSI}_{\text{Low},1}$ ve $\text{RSI}_{\text{Low},1} \le 35$.
       * **Ayı Uyumsuzluğu (Bearish Div 🔴):** $\text{Price}_{\text{High},2} > \text{Price}_{\text{High},1}$ iken $\text{RSI}_{\text{High},2} < \text{RSI}_{\text{High},1}$ ve $\text{RSI}_{\text{High},1} \ge 65$.

### Faz 4: Türev Veri Zenginleştirici (`DerivativesEnricherService`)

**Hedef:** Teknik kriteri geçen aday coinlere gerçek zamanlı Balina Long/Short, Perakende Dağılımı, Open Interest (OI) değişimi ve Funding Rate verilerini eklemek.

1. **`services/derivatives-enricher.service.js` Dosyasını Oluştur:**
   * Aday sembol için 60 saniye TTL önbellekli (Cache) olarak şu Binance uç noktalarını paralel çek:
     * `GET /futures/data/topLongShortPositionRatio?symbol=X&period=5m&limit=2` (Balina Pozisyon L/S Oranı ve bir önceki periyoda göre değişimi).
     * `GET /futures/data/globalLongShortAccountRatio?symbol=X&period=5m&limit=2` (Perakende Hesap L/S Oranı).
     * `GET /futures/data/openInterestHist?symbol=X&period=5m&limit=2` (Kontrat bazında gerçek OI değişimi `oiDeltaPct`).
     * `!markPrice@arr@1s` WebSocket önbelleğinden anlık `fundingRate`, bir önceki fonlama oranı ile farkı ve `nextFundingTime` UTC geri sayımı.

### Faz 5: 9 Bot Stratejisinin Deterministik Durum Makinesine Bağlanması

**Hedef:** Sahte tohumlamaları kaldırıp 9 botun tamamını net tetikleme zamanlaması (Mum Kapanışı vs. Anlık İvme) ve tekilleştirme (Cooldown) kurallarıyla çalıştırmak.

1. **`bots/base/base-bot.js` İçine Tekilleştirme (Deduplication & Cooldown) Ekle:**
   * Her bota `canEmitSignal(symbol, timeframe, candleOpenTime, cooldownMs)` kontrolü ekle.
   * Aynı `(symbol, botId, candleOpenTime)` için ikinci kez sinyal üretilmesini engelle.
   * 1 dakikalık botlar (`m1a`, `m1premium`, `v3`) için sembol başına minimum **180 saniye (3 dakika) Cooldown** uygula (aynı coinin üst üste 10 kart basmasını önle, ancak 745 coinin tamamı dinlendiği için farklı coinlerden gelen gerçek sinyallerle akış kesintisiz ve zengin olsun).
2. **9 Botun Tetikleme Kurallarını Güncelle (`bots/strategies/*.bot.js` ve `bots/index.js`):**

| Bot Kodu | Tetikleme Zamanı | Kesin Matematiksel Giriş Kriterleri (Quant Engine) |
| :--- | :--- | :--- |
| **`m1a` (M1-A Drop)** | Anlık (Intrabar / 3sn Throttle + 3dk Cooldown) | 745 coinde 1m mum değişimi $\le -1.00\%$, 1m $\text{Vol} > 1.5 \times \text{SMA}(\text{Vol}, 20)$, 1m StochRSI $K < D$ |
| **`m1premium` (M1P)** | Anlık (Intrabar / 3sn Throttle + 3dk Cooldown) | 745 coinde 1m mum sıçraması $\ge +1.00\%$, 1m $\text{RSI} \ge 70$, 1m $\text{SRSI} \ge 80$, $\text{Vol} > 2 \times \text{SMA}(\text{Vol}, 20)$ |
| **`v3` (V3-A Volume)** | 1m / 5m Mum Kapanışı veya Anlık Eşik (5dk Cooldown) | $\Delta\text{Vol}\% \ge +25\%$ (20 mumluk hacim ortalamasının en az %25 üzerinde gerçek hacim patlaması) ve 24s USDT hacmi $> \$10\text{M}$ |
| **`hammerproplus`** | 1m veya 5m Mum Kapanışı (`k.x === true`) | `1m/5m/1h RSI <= 30` + `WT(10,21) 1m` yukarı kesişim (`wt1 > wt2` ve `wt1 <= -50`) + Seanslık Pivot mesafesi $\le \%0.50$ |
| **`hammerpro`** | 5m Mum Kapanışı (`k.x === true`) | `5m ve 1h RSI <= 30`, `5m ve 1h SRSI <= 15`, `1m WT` yukarı kesişim ve `4H EMA200` mesafe/trend filtresi |
| **`4ssniper`** | 15m / 1h Mum Kapanışı (`k.x === true`) | `1H RSI <= 30`, `4H veya 1D SRSI <= 5`, `Top Trader Long Ratio >= %60` (`DerivativesEnricher` teyitli) |
| **`4s`** | 1h / 4h Mum Kapanışı (`k.x === true`) | 4H yapı kırılımı (`Boost >= +4%`), `1h|4h|1d` Multi-RSI & Multi-SRSI + `Top Trader L/S` vs `Global L/S` karşılaştırması (Sahte Pump `🔴` vs Gerçek Ralli `🟢` ayrımı) |
| **`div` (Divergence)** | 15m / 1h Mum Kapanışı (`k.x === true`) | **Yalnızca kapanmış mumda** onaylanan `Pivot Lookback Bullish/Bearish RSI(14) Divergence` veya `1H RSI(14) / SMA(14)` kesişimi |
| **`fr` (Funding Rate)** | Canlı `!markPrice@arr@1s` Anomali Tespiti (15dk Cooldown) | Fonlama oranının pozitiften negatife geçişi (`Short Squeeze 🟢`) veya negatif fonlamanın $\le -0.10\%$ altına derinleşmesi + `OI Delta > 0` teyidi |

3. **Dış Hunter Scriptlerinin (`hunter-*.js`) Tekilleştirilmesi:**
   * Kök dizindeki `hunter-15m.js`, `hunter-4spro.js`, `hunter-1g.js` gibi dış scriptlerin yaptığı hesaplamalar artık doğrudan `MarketDataEngine` + `QuantIndicatorsService` içinde çalışacağından, `/api/signals/emit` webhook uç noktasını geriye dönük uyumluluk için açık tut ancak gelen dış sinyalleri de `SymbolRegistry` ve `QuantIndicatorsService` doğrulamasından geçir.
4. **Veri Deposu Temizliği (`data/signals_history.json`):**
   * Daha önce `seedInitialLivePool` veya statik diziler tarafından `data/signals_history.json` içine yazılmış tüm sentetik/statik sinyalleri temizleyen bir migrasyon adımı çalıştır (yalnızca gerçek piyasa verisiyle üretilmiş veya doğrulanmış kayıtlar kalsın).

### Faz 6: Gerçek Quant Doğrulama ve Performans Test Süiti (`review/quant-accuracy-verification.cjs`)

**Hedef:** Arayüz testlerinin ötesine geçerek, matematiksel doğruluğu ve sistem performansını kanıtlayan 5 aşamalı gerçekçi bir test süiti yazmak ve çalıştırmak.

1. **Test 1 — `SymbolRegistry` vs Binance `exchangeInfo` Birebir Eşleşme Testi:**
   * En az 10 farklı fiyat büyüklüğündeki sembolde (`BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `IMXUSDT`, `DOGEUSDT`, `1000PEPEUSDT`, `1000SHIBUSDT`, `BTWUSDT` vb.) `PriceFormatter.format(price, symbol)` çıktısının Binance `PRICE_FILTER.tickSize` basamak sayısıyla **%100 aynı olduğunu** ve hiçbir yapay sıfır (`1.8876000`) veya kırpma üretmediğini doğrula.
2. **Test 2 — TradingView İndikatör Doğruluk Testi (250 Mum Warm-up):**
   * Binance'ten canlı 250 mum çekerek hesaplanan `Wilder RSI(14)`, `StochRSI(14,14,3,3)`, `WT(10,21)` ve `EMA(200)` değerlerinin matematiksel formül tutarlılığını ve `NaN / undefined / Infinity` üretmediğini doğrula.
3. **Test 3 — Sıfır Sahte Sinyal (Zero Synthetic Seed) Denetimi:**
   * `bots/index.js` ve `bots/strategies/*.bot.js` kaynak kodlarını AST/Regex ile tarayarak hiçbir hardcoded sinyal dizisi veya `seedInitialLivePool` kalmadığını doğrula.
4. **Test 4 — Cooldown ve Mükerrer Sinyal (Deduplication) Testi:**
   * Aynı sembol ve aynı mum açılış zamanı (`candleOpenTime`) ile art arda gönderilen 5 sinyalin yalnızca 1 kez kabul edildiğini ve diğer 4'ünün `BaseBot` tarafından reddedildiğini doğrula.
5. **Test 5 — Bellek ve Event Loop Performans Testi:**
   * 745 sembollük `!miniTicker@arr` yükü altında Node.js bellek kullanımının (Heap) sızıntı yapmadığını (Ring Buffer'ların 250 mum sınırını aşmadığını) ve API yanıt süresinin `< 50 ms` kaldığını doğrula.

## 4. Teslimat ve Dokümantasyon Kuralı

* Yukarıdaki 6 faz tamamlanıp `node review/quant-accuracy-verification.cjs` ve mevcut uçtan uca tarayıcı testleri **%100 başarılı** olduktan sonra, yapılan mimari değişiklikleri `proje takip.md` dosyasına kronolojik olarak işle.
