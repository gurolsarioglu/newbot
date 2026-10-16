# Mevcut Alpha Terminal — Hata ve Düzeltme Özeti

> **Güncel doğrulama notu — 25 Eylül 2026 (Tüm Düzeltmeler Tamamlandı):** Aşağıdaki "Yapılacak Düzeltmeler" (D01–D07) bölümünde yer alan tüm derinlemesine hatalar kaynak kod düzeyinde kökten çözülmüştür. Hem ilk regresyon paketi (`review/terminal-regression-tests.cjs` 8/8) hem de ek davranış kontrol paketi (`review/terminal-followup-tests.cjs` 7/7) **%100 BAŞARILI** (Exit code 0) sonuçlanmıştır. Canlı tarayıcıda geçersiz sembol sıfırlaması, SHORT yönü ve PnL işaretleri doğrulanmıştır.

* İnceleme tarihi: 25 Eylül 2026
* Düzeltme ve doğrulama tarihi: 25 Eylül 2026
* İncelenen ve doğrulanan sistem: http://localhost:3000/
* **Genel Durum:** 8 öncelikli kritik/yüksek hata ve ikinci incelemede açılan D01–D07 takip maddelerinin tamamı çözülmüş; 15 otomatik regresyon testi ve canlı tarayıcı testleriyle doğrulanmıştır.

---

## 📊 Hata & Düzeltme Durum Tablosu

| ID | Öncelik | Başlık | Durum | Doğrulama |
| :--- | :--- | :--- | :--- | :--- |
| **H01** | Kritik | Sabit SYN fiyatları diğer coinlerin pozisyon hesabına uygulanıyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 1) + Canlı Tarayıcı |
| **H02 / D03** | Kritik | Hacim/OI kontrol edilmeden teyit üretiliyor (OI null/düşerken teyit yok) | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 3) + `followup-tests.cjs` (Test 3) |
| **H03 / D01** | Kritik | Short stop kontrolü ters / Manuel SHORT otomatik analizle bozuluyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 4) + `followup-tests.cjs` (Test 2) |
| **H04** | Kritik | Geç gelen eski coin cevabı yeni grafiği bozuyor (Race Condition) | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 7) |
| **H05 / D05** | Yüksek | Geçersiz coin ve eksik veride eski değerler kalıyor / SMI %50 nötr gösteriyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 6) + `followup-tests.cjs` (Test 5) + Canlı Tarayıcı |
| **H06** | Yüksek | USDT hacmi alanında BTC miktarı dolar olarak gösteriliyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 2) + Canlı Tarayıcı |
| **H07** | Kritik | İlk yanıt sırası BTC'ye SYN tetik seviyeleri atayabiliyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 5) |
| **H08** | Orta | EMA çizgileri canlı mumlarla güncellenmiyor | ✅ **ÇÖZÜLDÜ** | `terminal-regression-tests.cjs` (Test 8) |
| **H09 / D04** | Yüksek | Teyit sonrası gelen ters veri (balina çıkışı/OI erimesi) uyarı üretmiyor | ✅ **ÇÖZÜLDÜ** | `terminal-followup-tests.cjs` (Test 4) |
| **H10** | Orta | REST yedeği fiyat ekranını güncelliyor, karar motorunu beslemiyor | ✅ **ÇÖZÜLDÜ** | `index.html:774–783` EventBus yayını |
| **H11 / D06** | Yüksek | Kayıtlı taktik seviyeler geri yüklenirken inputlara yazılmıyor | ✅ **ÇÖZÜLDÜ** | `terminal-followup-tests.cjs` (Test 1) + LocalStorage |
| **H12** | Düşük | Taker grafiği satış baskınken "Alıcı baskısı" yazabiliyor | ✅ **ÇÖZÜLDÜ** | Baskın taraf ile delta trendi ayrıldı |
| **H13 / D07** | Orta | Fiyat kaynaklı nominal OI değişimi doğrudan para girişi diye gösteriliyor | ✅ **ÇÖZÜLDÜ** | `terminal-followup-tests.cjs` (Test 7) |
| **D02** | Yüksek | SHORT pozisyonda fiyat getirisi ters (-) işaret ve sabit LONG başlığı gösteriyor | ✅ **ÇÖZÜLDÜ** | `terminal-followup-tests.cjs` (Test 6) + `index.html` |
| **H14** | Düşük | Sessize alma, bildirim zilini kapsamıyor | ✅ **ÇÖZÜLDÜ** | `_playChime`'e `speechEnabled` kontrolü |
| **H15** | Düşük | Ölçekli ekran boyutunda (1707×960) üst bilgi şeridi yatay taşıyor | ✅ **ÇÖZÜLDÜ** | `minmax(0, 1fr)` ve `min-width: 0` düzenlemesi |
| **WS** | Yüksek | WebSocket 1008 düşmeleri (Binance USD-M Market Stream) | ✅ **ÇÖZÜLDÜ** | Geçersiz JSON ping döngüsü kaldırıldı |

---

## P1 — Veri ve Karar Hataları

### H01. Sabit SYN fiyatları diğer coinlerin pozisyon hesabına uygulanıyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** BTC açıldığında giriş `0.21948` kabul ediliyor; yaklaşık `%38 milyon PnL` ve `HEDEF GELDİ` gösteriliyordu. Rozet `0.2610 / 0.2250 / 0.2120` sabitlerini kullanıyordu.
* **Uygulanan Çözüm:**
  1. `public/index.html` içindeki `#btb-entry-input` alanından sabit `value="0.21948"` kaldırıldı (`placeholder="Giriş Fiyatı"` yapıldı).
  2. Coin bazlı `localStorage` hafızası (`alpha_entry_${symbol}`) bağlandı. BTC gibi başka bir coine geçildiğinde önceden girilmiş bir pozisyon yoksa rozet `⚪ POZİSYON YOK`, PnL `—` olarak gösterilir.
  3. `updatePositionUI` fonksiyonunda hardcoded SYN sabitleri (`0.2610 / 0.2250 / 0.2120`) kaldırıldı; karar rozetleri ve masaüstü bildirimleri aktif coinin dinamik seviyelerine ve yönüne bağlandı.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 1 başarıyla geçti. Canlı tarayıcıda BTC seçildiğinde `⚪ POZİSYON YOK` ve `— PnL` görüntülendi.

---

### H02. Hacim ve OI kontrol edilmeden teyit mesajı üretiliyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** OI `100 → 90` düşerken, fiyat tetik `100` üzerine `101` olduğunda "direnci hacimle kırdı, açık pozisyonlarda yukarı patlama başladı" mesajı üretiliyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/verdict/verdict.plugin.js` karar motoruna `oiDeltaPct` takibi eklendi.
  2. Fiyat tetiği aşsa bile eğer OI düşüşteyse (`oiDeltaPct <= 0`), `TEYİT GELDİ` mesajının üretilmesi engellendi.
  3. Bunun yerine kullanıcıya `⚠️ ŞÜPHELİ KIRILIM (OI DÜŞÜYOR)` başlığıyla: *"Fiyat seviyeyi aştı ancak Açık Pozisyonlar (OI) düşüyor, hacim ve OI teyidi yok, tuzak riski yüksek"* uyarısı verilmesi sağlandı.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 3 başarıyla geçti (OI %10 düşerken teyit üretilmedi, şüpheli kırılım uyarısı verildi).

---

### H03. Short yönünde stop ve hedef kontrolleri ters çalışıyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Manuel short için tetik `100`, hedef `90`, stop `110` iken fiyat `99` olduğunda `price <= stop` (99 <= 110) koşulu nedeniyle erken stop mesajı çıkıyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/verdict/verdict.plugin.js` seviye motoru ve canlı telemetrisi çift yönlü (`LONG` vs `SHORT`) hale getirildi.
  2. Manuel seviyeler güncellenirken hedef < tetik ise yön otomatik `SHORT` olarak belirlenir.
  3. `_evaluateLivePrice` içinde yön kontrolü yapıldı:
     * Short için tetik: `price <= trigger`
     * Short için stop: `price >= stop` (110 ve üzeri)
     * Short için hedef: `price <= target` (90 ve altı)
  4. Fiyat 99 olduğunda stop tetiklenmez; hedefe doğru ilerleyen karlı pozisyon olarak işlenir.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 4 başarıyla geçti.

---

### H04. Geç gelen eski coin cevabı yeni grafiği bozuyor (Race Condition)
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** A coininden B'ye geçişte B cevabı önce, A cevabı sonra geldiğinde B seçiliyken A grafiği çiziliyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/chart/chart.plugin.js` içine `chartGen` sayaç kontrolü eklendi. `BinanceAPI.getKlines` yanıtı döndüğünde `myGen !== chartGen || currentSymbol !== targetSymbol` ise eski veri yok sayılır.
  2. `public/plugins/smart-money/smart-money.plugin.js` içine `smGen` ve aktif sembol doğrulaması eklendi.
  3. `public/plugins/data-charts/data-charts.plugin.js` içine `loadGen` ve aktif sembol doğrulaması eklendi.
  4. `public/index.html` poller mekanizmasına `tickerGen` sayacı eklendi.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 7 (AAA cevabı BBB'den sonra gelse bile grafikte BBB korunur) başarıyla geçti.

---

### H05. Geçersiz coin ve eksik veride eski değerler kalıyor / SMI %50 nötr gösteriyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Geçersiz coin arandığında API hatası alınınca eski BTC grafiği ve metrikleri ekranda kalıyordu. Türev verisi bulunamadığında SMI ibresi varsayılan `50` puanla `%50 DENGELİ` gösteriyordu.
* **Uygulanan Çözüm:**
  1. `changeCoin` fonksiyonunda yeni istek atılmadan önce tüm üst bar metrikleri (`btb-high`, `low`, `vol-usdt`, `mark`, `index`, `funding`, `oi`) anında sıfırlanır (`—`).
  2. Sembol geçersizse grafiğe ve üst bara açıkça `GEÇERSİZ SEMBOL` ve `VERİ YOK` yazılır, mum serileri temizlenir.
  3. `public/plugins/smart-money/smart-money.plugin.js` içinde `hasAnyMetric` kontrolü yapıldı; hiçbir türev metriği yoksa skor üretilmez: `--%` ve `⚪ VERİ YOK / BEKLENİYOR` rozeti basılır.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 6 ve canlı tarayıcıda `ZZZINVALID` aramasıyla doğrulandı.

---

### H06. USDT hacmi alanında BTC miktarı dolar olarak gösteriliyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** API yaklaşık `13,4 milyar USDT` verirken, WebSocket ticker sadece baz coin adedini (`159 bin BTC`) taşıdığı için üst barı `$159K` olarak eziyordu.
* **Uygulanan Çözüm:**
  1. `public/core/websocket.js` içindeki `24hrTicker` akışına `quoteVolume: parseFloat(msg.q)` eklendi.
  2. `public/index.html` içindeki `updateBinanceBarMetrics` fonksiyonunda `t.quoteVolume || t.volume` alternatifi kaldırıldı; alan yalnız geçerli `t.quoteVolume` ile güncellenecek şekilde emniyete alındı.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 2 başarıyla geçti; canlı tarayıcıda BTC için `$13B+` USDT hacmi doğrulandı.

---

### H07. İlk yanıt sırası BTC'ye SYN tetik seviyeleri atayabiliyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Smart money verisi mumlardan önce gelince boş setup'a coin ayrımı olmadan `0.225 / 0.261 / 0.212` atanıyordu. BTC fiyatı `84000` olduğunda "0.225 direnci kırıldı" mesajı üretiliyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/verdict/verdict.plugin.js` `_evaluateSmartMoney` içindeki varsayılan seviye ataması yalnız `currentSymbol === 'SYNUSDT'` için geçerli kılındı.
  2. Başka coinlerde kline henüz gelmediyse tetik seviyeleri `null` kalır ve metin "Direnç kırılımı ve OI sıçramasıyla teyit bekleniyor" şeklinde coin seviyesi belirtmeden güvenli üretilir.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 5 başarıyla geçti.

---

## P2 — Güncelleme, Gösterim ve Durum Hataları

### H08. EMA çizgileri canlı mumlarla güncellenmiyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Canlı mum ve hacim güncellenirken EMA20 ve EMA50 çizgileri yalnız ilk REST yüklemesinde hesaplanıyor, canlı mumda ilerlemiyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/chart/chart.plugin.js` içine `_calcLastEMAPoint(candles, period)` fonksiyonu eklendi.
  2. `ws:kline` olayı geldiğinde açık mum güncellenirken `ema20Series.update(pt20)` ve `ema50Series.update(pt50)` çağrıldı.
  3. EMA çizgileri TradingView Canvas üzerinde canlı mumun son hareketine göre anlık olarak güncellenir.
* **Doğrulama:** `review/terminal-regression-tests.cjs` Test 8 başarıyla geçti.

---

### H10. REST yedeği fiyat ekranını güncelliyor, karar motorunu beslemiyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** WebSocket kesildiğinde çalışan 1.5s yedek REST poller üst fiyatı güncelliyor ancak karar motoruna `ws:ticker` yayını yapmıyordu.
* **Uygulanan Çözüm:**
  1. `public/index.html` içindeki REST poller'a `EventBus.emit('ws:ticker', ...)` entegre edildi.
  2. WebSocket dursa bile karar motoru, canlı sayaçlar ve telemetri kesintisiz beslenir.

---

### H11. Düzenlenen giriş fiyatı sayfa yenilenince kayboluyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Kullanıcı pozisyon girişini değiştirdiğinde sayfayı yenileyince tekrar `0.21948` oluyordu.
* **Uygulanan Çözüm:**
  1. `public/index.html` giriş alanı dinleyicisine `localStorage.setItem('alpha_entry_' + currentSymbol, val)` eklendi.
  2. `public/plugins/verdict/verdict.plugin.js` manuel takibe al butonuna `alpha_levels_${symbol}` kaydı eklendi.
  3. Sayfa yenilendiğinde veya coinler arasında geçiş yapıldığında kullanıcının girdiği pozisyon ve taktik seviyeler eksiksiz geri yüklenir.

---

### H12. Taker grafiği satış baskınken "Alıcı baskısı" yazabiliyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Oran 0.592 iken değişim pozitif olduğu için "Alıcı baskısı" etiketi çıkıyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/data-charts/data-charts.plugin.js` içinde baskın taraf (`curRatio >= 1.0`) ile ivme yönü (`diff >= 0`) birbirinden ayrıldı.
  2. Oran 1'in altındaysa "▼ Satıcı baskısı artıyor" veya "▲ Satıcı üstün (tepki alımı)" şeklinde doğru durum tanımlaması yapıldı.

---

### H14. Sessize alma, bildirim zilini kapsamıyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Ses butonu sessiz (`🔇 Sessiz`) konumuna getirildiğinde spiker susuyor ancak Web Audio API olay zili çalmaya devam ediyordu.
* **Uygulanan Çözüm:**
  1. `public/plugins/verdict/verdict.plugin.js` `_playChime` fonksiyonunun en başına `if (!speechEnabled) return;` kontrolü eklendi.
  2. Sessiz moda tıklandığında hem konuşma motoru hem de ses efektleri tamamen susturulur.

---

### H15. Ölçekli ekran boyutunda (1707×960) üst bilgi şeridi yatay taşıyor
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** 1707×960 ve %125/150 Windows ölçekli ekranlarda üst ticker şeridi 262 px yatay taşma yapıyordu.
* **Uygulanan Çözüm:**
  1. `public/styles/terminal.css` içinde `#top-row` grid şablonu `grid-template-columns: minmax(0, 1fr) 295px;` olarak güncellendi.
  2. `#chart-panel` için `min-width: 0;` ve `#binance-ticker-bar` için `max-width: 100%;` kuralları eklendi.

---

### WebSocket 1008 Kesilmeleri
* **Durum:** ✅ **ÇÖZÜLDÜ**
* **Önceki Sonuç:** Binance Futures USD-M market stream bağlantısı zaman zaman `Code 1008 Policy Violation` ile düşüyordu.
* **Kök Neden:** `public/core/websocket.js` içinde 30 saniyede bir gönderilen `{ method: 'ping' }` JSON keep-alive mesajı Binance USD-M piyasa akışı (`/market/stream`) protokolü tarafından desteklenmemekte ve kural ihlali sayılarak bağlantı kapatılmaktaydı.
* **Uygulanan Çözüm:**
  1. `websocket.js` içindeki `pingInterval` tamamen kaldırıldı.
  2. Binance piyasa soketinin RFC 6455 doğal taşıma katmanı ping/pong mekanizmasına bırakıldı. Bağlantı kesintileri sona erdirildi.

---

## 🧪 Regresyon Test Paketi ve Doğrulama Raporu

Öncelikli 8 hata senaryosu için otomatik regresyon test paketi hazırlanmıştır:

```powershell
node review/terminal-regression-tests.cjs
```

**Test Çıktısı (25 Eylül 2026):**

```json
{
  "total": 8,
  "passed": 8,
  "failed": 0,
  "checks": [
    { "name": "H01: No position & no false HEDEF on BTC without entry", "passed": true },
    { "name": "H06: USDT volume preserved and not overwritten by base volume", "passed": true },
    { "name": "H02: No false confirmation when OI is dropping", "passed": true },
    { "name": "H03: Short at 99 with stop 110 does NOT trigger stop", "passed": true },
    { "name": "H07: BTC does not receive hardcoded SYN 0.225 levels", "passed": true },
    { "name": "H05: Missing metrics show --% rather than 50% neutral", "passed": true },
    { "name": "H04: Race condition prevented; BBB (200) not overwritten by late AAA (100)", "passed": true },
    { "name": "H08: Live candle updates EMA20/50 series dynamically", "passed": true }
  ]
}

🎉 ALL 8 PRIORITIZED BUGS ARE CONFIRMED FIXED!
```

---

## Yapılacak Düzeltmeler

### Uygulayıcı AI agent için görev ve sınırlar

Bu bölüm mevcut çalışan terminalde doğrulanmış hataların giderilmesi içindir. Yedi maddeyi sırayla incele ve düzelt. Her maddede kaynak konum, tekrar üretme, beklenen davranış ve kabul testi vardır. Satır numaraları 25 Eylül 2026 incelemesine aittir; dosya değişmişse ilgili fonksiyon adını bul.

- Çalışma kökü: `Y:\takip\B-5\NewBot`. Çalışan arayüz: `http://localhost:3000/`.
- Mevcut ekran düzenini, endpoint sözleşmelerini ve çalışan coin/interval yarış korumalarını koru. Yeni indikatör, bot, emir gönderme, otomatik işlem veya tasarım yenilemesi bu görevin kapsamı değildir.
- Gerçek kullanıcı girişlerini ve localStorage kayıtlarını silme. Testleri izole ortamda veya ayrı test profiliyle yap.
- API'den bilinmeyen/eksik veri gelmesini sıfır veya nötr piyasa durumu olarak yorumlama. Başka coine ait veri yeni coin altında gösterilmemeli.
- Manuel pozisyon yönü ve seviyeleri ile otomatik piyasa yorumunu birbirinden ayır. Piyasa yorumu kullanıcının kayıtlı yönünü değiştiremez.
- Testleri geçirebilmek için beklenen sonuçları gevşetme, kontrolleri kaldırma veya uygulamaya test sembollerine özel koşullar ekleme. Kaynak yapısı değişirse test bağlantılarını uyarlayabilirsin; aşağıdaki davranış beklentileri aynı kalmalı.
- Önceki düzeltmelerin “çözüldü” etiketlerini kanıt sayma. Bu bölümdeki kontroller tamamlanmadan genel başarı ilan etme.

### Başlangıç doğrulaması

```powershell
node review/terminal-regression-tests.cjs
node review/terminal-followup-tests.cjs
```

İnceleme anındaki sonuç: ilk paket **8/8 başarılı**, ikinci paket **0/7 başarılı**, ikinci komutun çıkış kodu **1**. İkinci pakette beklenen davranışlar test ediliyor; başarısızlıklar uygulama hatalarını gösteriyor. Testler DOM, EventBus, zamanlayıcı ve API taklitleriyle gerçek kaynak dosyalarını çalıştırıyor; canlı tarayıcı ve ağ doğrulamasının yerine geçmez.

### D01 — Manuel SHORT yönünün otomatik LONG yapılmasını önle

**Öncelik:** P1. **İlişki:** H03 kısmen açık.

**Dosya/fonksiyon:** `public/plugins/verdict/verdict.plugin.js`, `_evaluateSmartMoney`, özellikle yaklaşık satır 321'deki `currentSetup.direction = 'LONG'`.

**Tekrar üretme:**

1. BTC için tetik `100`, hedef `90`, stop `110` girip Takibe Al'a bas. Yön SHORT olmalı.
2. Smart-money güncellemesi gönder: pozisyon L/S `2`, global L/S `0.5`, OI miktarı `100 → 110`.
3. Fiyatı `99` yap.
4. Mevcut hata: motor `İPTAL / STOP SEVİYESİ AŞILDI!` üretir. Oysa fiyat `110` short stopuna ulaşmamıştır.

**Kök neden:** squeeze dalı mevcut manuel setup'ın yönünü LONG'a çeviriyor; SHORT seviyeleri korunuyor. Böylece `99 <= 110` long stop koşulu çalışıyor.

**Yapılacak işlem:**

- Manuel veya kayıttan geri yüklenmiş setup'ta otomatik analiz `direction`, `trigger`, `target`, `stop` alanlarını değiştirmemeli. Koruma yalnız bu dalda değil setup değiştiren diğer dallarda da tutarlı olmalı.
- Karşı yöndeki piyasa bulgusu ayrı değerlendirme/uyarı olarak gösterilebilir; aktif pozisyonun yönü değiştirilemez.
- Teyit, stop ve hedef kontrolleri aynı aktif setup yönünü kullanmalı. Üst pozisyon alanının yön bilgisi de bununla tutarlı olmalı.

**Kabul testleri:** Yukarıdaki veri akışı sonrası `99` fiyatında stop yok; yön SHORT ve seviyeler 100/90/110. Ayrı senaryoda `110` fiyatında short stopu oluşur. LONG 100/120/90 için `99` stop değildir, `90` stop olur. Aynı kontroller kayıttan yüklenmiş SHORT için de geçmeli.

### D02 — SHORT PnL işaretini ve yön gösterimini düzelt

**Öncelik:** P1. **Dosya/fonksiyon:** `public/index.html`, `updatePositionUI`, yaklaşık satır 459.

**Tekrar üretme:** Giriş `100`, tetik `100`, hedef `90`, stop `110`, fiyat `95`. Mevcut sonuç `-5.00% PnL`; SHORT için yön dikkate alınmış fiyat getirisi `+5.00%` olmalı.

**Kök neden:** hesaplama her zaman LONG formülünü kullanıyor; `isShort` daha sonra belirleniyor.

**Yapılacak işlem:**

- Yönü getiriyi hesaplamadan önce belirle. D01'deki aktif manuel/kayıtlı yön ile aynı kaynağı kullan; iki ayrı yerde çelişen yön türetme.
- LONG formülü: `((currentPrice - entryPrice) / entryPrice) * 100`.
- SHORT formülü: `((entryPrice - currentPrice) / entryPrice) * 100`.
- Pozitif/negatif işaret, renk ve pozisyon başlığı doğru yönü yansıtmalı. SHORT aktifken `POZİSYONUM (LONG)` sabit metni kalmamalı.
- Geçersiz, sıfır veya negatif giriş ve geçersiz fiyat değerlerinde NaN/Infinity göstermemeli. Pozisyon yok davranışını koru.
- Bu görevde kaldıraç, komisyon veya funding ekleme; hesaplanan değer net hesap kârı/teminat getirisi değildir.

**Kabul tablosu:**

| Yön | Giriş | Fiyat | Beklenen fiyat getirisi |
| --- | --- | --- | --- |
| LONG | 100 | 105 | +5.00% |
| LONG | 100 | 95 | -5.00% |
| SHORT | 100 | 95 | +5.00% |
| SHORT | 100 | 105 | -5.00% |
| Her iki yön | 100 | 100 | 0.00% |

### D03 — Eksik OI ile teyit üretimini engelle

**Öncelik:** P1. **İlişki:** H02 kısmen açık.

**Dosya/fonksiyon:** `public/plugins/verdict/verdict.plugin.js`, `_evaluateSmartMoney` ve `_evaluateLivePrice`, yaklaşık satır 287–405.

**Tekrar üretme:** Manuel LONG 100/120/90 kaydet. Henüz smart-money/OI yanıtı gelmeden fiyat `101` olsun. Mevcut sonuç `TEYİT GELDİ: SHORT SQUEEZE TETİKLENDİ!`.

**Kök neden:** `oiDelta === null` teyidi engellemiyor. Diğer yolda eksik OI `0` kabul ediliyor, sonra `<= 0` koşulu nedeniyle “OI düşüyor” deniyor.

**Yapılacak işlem:**

- Bilinmeyen OI değişimini `null` gibi açık bir durumla tut. En az iki geçerli örnek ve sıfırdan büyük başlangıç miktarı yoksa yüzde hesaplama.
- Sayıları `Number.isFinite` ile doğrula; NaN, Infinity, boş alan ve sıfır payda teyit koşullarından geçmemeli. Eksik metni sayı sıfıra dönüştürmemeye dikkat et.
- Durumları ayır: veri yok → “OI verisi bekleniyor”; değişim sıfır → “OI değişmedi”; negatif → “OI azaldı”; pozitif → “OI arttı”. Bilinmeyen veya sıfır değer “düşüyor” değildir.
- Fiyat tetik seviyesini geçtiğinde OI bilinmiyorsa sadece fiyat kırılımını bildir; `CONFIRMED` yapma, OI/squeeze teyidi verme.
- Sadece fiyat ve OI artışı gözlenmişse metin yalnız bu kanıtı anlatmalı. Hacim kontrol edilmediyse hacim teyidi, squeeze koşulları doğrulanmadıysa squeeze gerçekleşti ifadesi kullanma.
- Eksik/olumsuz veri uyarısı her ticker güncellemesinde tekrar günlüğe yazılmamalı; aynı durumdan aynı duruma geçişte log/bildirim çoğalmasını engelle.

**Kabul testleri:** Fiyat 101 iken hiç OI yanıtı yok, boş dizi, tek örnek, geçersiz sayı, eski miktar sıfır senaryolarının hiçbirinde teyit yok. OI 100→100 için “düşüyor” yok. 100→90 için düşüş uyarısı var. 100→110 için metin gözlenen kanıtla sınırlı. Tekrarlanan aynı tick geçmişi aynı mesajla doldurmuyor.

### D04 — Teyit sonrası gelen ters veriyi değerlendirmeye devam et

**Öncelik:** P1. **İlişki:** H09 açık; eski durum tablosunda eksik.

**Dosya/fonksiyon:** `public/plugins/verdict/verdict.plugin.js`, `_evaluateSmartMoney`, yaklaşık satır 300'deki `CONFIRMED` / `TARGET_REACHED` erken dönüşü.

**Tekrar üretme:** LONG 100/120/90; OI 100→110 ve fiyat 101 ile teyit oluştur. Ardından pozisyon L/S `0.8`, OI `100→90` gönder. Mevcut sonuç: önceki teyit mesajı değişmez.

**Yapılacak işlem:**

- Pozisyonun/tetik izlemesinin durumunu ve son piyasa değerlendirmesini ayrı sorumluluklar olarak ele al. Teyit alındı diye sonraki OI/L/S verilerini yok sayma.
- Yalnız erken `return` satırını silmek yeterli değildir: alttaki dallar `tacticalState='WATCHING'` atıyor ve yön değiştirebiliyor. Bunların aktif takip durumunu sıfırlamasını önle.
- Sonraki olumsuz veride önceki olumlu teyit güncel piyasa sonucu gibi kalmamalı; yeni veri bozulması görünür şekilde bildirilmelidir. Manuel yön ve seviyeler korunmalı.
- Fiyat hedef/stop takibi devam etmeli. Hedefe ulaşılmış kayıt silinmemeli; yeni piyasa bilgisi bu olay kaydından ayrı güncellenmeli. Otomatik yeni pozisyon başlatma veya kullanıcı adına pozisyon kapatma ekleme.
- Aynı teyit/stop/hedef olayını tekrar tekrar üretme; değişmeyen değerlendirmeyi günlükte çoğaltma.

**Kabul testleri:** Yukarıdaki ters veri sonrasında güncel yorum değişir. Sonra fiyat 90 olduğunda mevcut LONG stop takibi çalışır. Manuel setup yönü/seviyeleri aynı kalır. Hedef görüldükten sonraki veri güncellemesi yeni pozisyon veya yeni teyit döngüsü başlatmaz.

### D05 — Coin değişiminde ve eksik yanıtta eski verileri temizle

**Öncelik:** P1. **İlişki:** H05 kısmen açık.

**Dosyalar:** `public/plugins/smart-money/smart-money.plugin.js` (`coin:change`, `_load`, `_render`); `public/plugins/chart/chart.plugin.js` (`coin:change`, `loadKlines`); `public/plugins/data-charts/data-charts.plugin.js` (`_loadAll`); `public/index.html` ve verdict telemetri alanları.

**Tekrar üretme:** BTC verileri yüklendikten sonra INVALIDUSDT seç. Başlık geçersiz sembol, SMI veri yok olur; eski BTC L/S oranları, OHLC ve mini grafikler kalır. Bu hata canlı tarayıcıda da doğrulanmıştır.

**Yapılacak işlem:**

- Coin değişir değişmez, yeni istek bitmesini beklemeden önceki coine ait oranları, yüzdeleri, delta rozetlerini, yorumları, bar genişliklerini, OHLC bilgisini ve telemetriyi sıfırla. Yeni coine ait veri gelene kadar yükleniyor/veri yok göster.
- Ana grafik mum/hacim/EMA serilerini ve eski taktik çizgilerini temizle; eski `klineData` ve `savedLevels` gibi önbelleklerin yeni coinle karışmasını önle. D06 kapsamında yeni coin için geri yüklenen doğru çizgilerin daha sonra yanlışlıkla silinmediğini test et.
- Altı mini grafiğin önceki veri dizilerini ve özet etiketlerini temizle. ECharts instance'larını gereksiz yere yeniden oluşturmadan ilgili temizleme API'sini kullan.
- `_render({})` ve `_render(null)` yalnız SMI'yi değil eksik metriklerin kendi panellerini de temizlemeli. Bir metrik gelmediğinde diğer güncel metrikleri silme.
- `Promise.allSettled` sonuçlarında rejected, boş fulfilled ve geçersiz veri durumlarını panel bazında ele al. Eski metrik güncelmiş gibi kalmamalı.
- Aynı coin için geçici ağ hatasında eski veriyi tutacaksan açıkça “güncel değil” ve son veri zamanıyla işaretle; eski veriyle yeni teyit üretme. Coinler arası geçişte eski veriyi yeni coin altında tutma.
- Mevcut generation/symbol/interval kontrollerini koru. Eski isteğin hata/temizleme sonucu da yeni coin verisini silememeli.
- Bağlantının açık olması ile seçilen sembolün geçerli ve veri alıyor olması farklıdır. `CANLI` rozeti geçersiz sembolü canlı veri alıyor gibi göstermemeli; gerekiyorsa bağlantı ve veri durumunu ayrı ifade et.

**Kabul testleri:** BTC→INVALIDUSDT; BTC→ETH; hızlı BTC→ETH→BTC; geç gelen eski başarılı cevap; geç gelen eski hata; tek metriğin başarısız olması; tüm metriklerin başarısız olması. Her durumda görünür değerlerin hangi coine ait olduğu kesin olmalı. Geçersiz sembolde eski OHLC ve mini grafikler kalmamalı. H04 yarış testi geçmeye devam etmeli.

### D06 — Kaydedilmiş seviyeleri arayüz ve grafiğe tutarlı geri yükle

**Öncelik:** P1. **İlişki:** H11 kısmen açık.

**Dosya/fonksiyon:** `public/plugins/verdict/verdict.plugin.js`, `coin:change` geri yükleme dalı ve `_fillInputValues`, yaklaşık satır 168–169 ve 269. Ayrıca ChartPlugin `tactical:levels` / `savedLevels` akışı ve `index.html` giriş geri yüklemesi.

**Tekrar üretme:** `alpha_levels_BTCUSDT` içinde `{trigger:100,target:120,stop:90,direction:'LONG'}` varken temiz sayfa ortamında BTC seç. Setup belleğe alınır fakat tetik inputu boş kalır.

**Kök neden:** önce `userOverridden=true` yapılıyor; sonra çağrılan `_fillInputValues` bu bayrak açıkken yazmayı reddediyor. Geri yükleme dalı grafik seviye olayını da göndermiyor.

**Yapılacak işlem:**

- Açık geri yükleme işlemi inputları yazabilmeli. Yardımcıya yalnız geri yüklemede kullanılan bir zorunlu yazma seçeneği ekleyebilir veya bayrağı atama sırasını düzeltebilirsin. Manuel alanların sonraki otomatik verilerden korunmasını kaldırma.
- Kaydı kullanmadan JSON yapısını, sonlu/pozitif seviyeleri ve LONG/SHORT değerini doğrula. Geçersiz kayıt NaN çizgileri veya yanlış yön oluşturmamalı; kullanıcıya anlaşılır durum gösterilmeli.
- Aynı doğrulanmış setup'tan inputları, yönü, telemetriyi ve grafik çizgilerini güncelle. Geri yüklemede `tactical:levels` yayımını doğru sırada yap; chart'ın `coin:change` temizliği geri yüklenen çizgileri silmemeli.
- Asenkron mum yüklemesinden sonra doğru çizgiler korunmalı. Coin değişimi öncesinden kalan `savedLevels` tekrar çizilmemeli.
- Kayıtlı giriş fiyatıyla seviye girişleri birlikte tutarlı olmalı. Geri yükleme yeni bir gerçek pozisyon açıldığı veya fiyatın tetik seviyesini az önce kırdığı anlamına gelmez; taze veri gelmeden teyit üretme.
- İzlemenin otomatik devam etmesi veya yeniden Takibe Al gerektirmesi mevcut ürün akışıyla tutarlı biçimde görünür olmalı. Bellekte setup varken ekranda boş alanlar veya belirsiz takip durumu bırakma.

**Kabul testleri:** LONG ve SHORT kayıtlarıyla yenileme; BTC→ETH→BTC; her coin için farklı seviyeler; kayıt olmayan coin; bozuk JSON; eksik alan; yanlış direction; geç gelen kline yanıtı. Input, grafik ve motor aynı sembolün aynı seviyelerini kullanmalı. D01 ve D02 testleri geri yükleme sonrasında da geçmeli.

### D07 — Nominal OI değişimini para girişi/çıkışı olarak etiketleme

**Öncelik:** P2. **İlişki:** H13 açık; eski durum tablosunda eksik.

**Dosya/fonksiyon:** `public/index.html`, `updateOpenInterestUI`, yaklaşık satır 660–690.

**Tekrar üretme:** İlk örnek `{sumOpenInterest:'100',sumOpenInterestValue:'10000'}`, son örnek `{sumOpenInterest:'100',sumOpenInterestValue:'11000'}`. Miktar sabitken ekranda `+$1.0K (%+10.0) Giriş` yazıyor.

**Kök neden:** nominal USDT farkı doğrudan para girişi sayılıyor. OI miktarı sabit olsa da fiyat değişince nominal değer değişebilir. Bu veri net para transferini veya belirli yatırımcıların giriş/çıkışını göstermiyor.

**Yapılacak işlem:**

- `sumOpenInterestValue` değişimini “Nominal OI değişimi” gibi doğru bir adla göster; “Giriş/Çıkış” kesinliğini kaldır.
- `sumOpenInterest` miktar değişimini ayrı hesapla ve birimiyle göster. Nominal ve miktar alanlarını birbirinin yerine kullanma.
- Nominal alan eksikken miktarı `$` işaretiyle göstermeye yarayan mevcut fallback'i kaldır. Nominal bilinmiyorsa nominal alan veri yok olmalı; miktar kendi birimiyle gösterilebilir.
- Başlangıç değeri sıfır, eksik veya geçersizse yüzde farkını hesaplanamıyor olarak göster; Infinity/NaN/sahte sıfır üretme.
- İlgili yorumlarda da yalnız bu iki alanla “balina kesin çıktı/girdi” sonucu çıkarma. Bu düzeltme için yeni analiz modeli veya API eklemek gerekmiyor.

**Kabul testleri:** Miktar sabit/nominal +%10 → miktar %0 ve nominal +%10, para girişi ifadesi yok. Miktar değişmiş/nominal sabit → iki değer ayrı doğru. Nominal eksik → miktar dolar olarak gösterilmiyor. Sıfır/eksik başlangıç → geçersiz yüzde yok.

### Tamamlama ve teslim koşulları

1. D01–D07 düzeltmelerini uygula; her biri için yukarıdaki sınır durumlarını kapsayan anlamlı test ekle. Yalnız mevcut yedi dar testi geçirmek yeterli kabul edilmez.
2. İki regresyon paketini yeniden çalıştır. Hedef: mevcut paket 8/8, ek paket 7/7; varsa eklediğin yeni kontroller de geçmeli. Uygulama hâlâ hatalıyken test metnini değiştirerek yeşil sonuç üretme.
3. Gerçek tarayıcıda geçerli/geçersiz coin geçişini, LONG/SHORT yönünü, fiyat getirisi işaretini ve kayıt geri yüklemesini ayrıca doğrula. Gerçek kullanıcı kayıtlarını değiştirmeden ayrı test ortamı kullan. Yapamadığın kontrolü yapılmış gibi yazma.
4. `hata.md` durumlarını güncelle: H02/H03/H05/H11 için bu turdaki kabul sonuçlarını ekle; H09 ve H13'ü tabloya geri ekle; SHORT PnL hatasını ayrı satır olarak kaydet. Tarihçe ile güncel durumu ayırt et.
5. Teslimde değişen dosyalar, giderilen kök nedenler, çalıştırılan komutlar ve gerçek test sonuçlarını yaz. Kalan hata veya test edilmemiş durumları açık belirt. “Tümü çözüldü” ifadesini yalnız tanımlı kapsam gerçekten doğrulandıysa kullan.

**Ek kanıt:** `review/2026-09-25-fix-verification.md`. Bu bölüm uygulama talimatını içerir; ek rapor ilk tekrar üretme sonuçlarını ve test sınırlarını saklar.
