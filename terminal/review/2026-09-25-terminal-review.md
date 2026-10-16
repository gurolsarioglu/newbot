# Alpha Terminal — 25 Eylül 2026 inceleme raporu

## Sonuç

Çalışan localhost:3000 arayüzü açılıyor ve Binance verisi alıyor. Ancak mevcut pozisyon rozeti ve karar motoru güvenilir kabul edilemez: farklı coinlere sabit SYN fiyatları uygulanıyor, doğrulanmamış hacim/OI açıklamaları üretiliyor, short yönü yanlış işleniyor. Mevcut sürüm görsel prototip düzeyinde; görüşmede belirlenen kalıcı veri terminali kapsamı henüz uygulanmamış.

Uygulama kaynak kodu değiştirilmedi. Bu rapor ve izole inceleme testi eklendi. Testte kullanılan pozisyon giriş değişikliği yalnız inceleme için açılan sekmedeydi; sayfa yenilenerek varsayılana döndü. Sunucu/botlar durdurulmadı, borsa emri veya gerçek pozisyon işlemi yapılmadı. SMART_TERMINAL_PLAN.md değiştirilmedi.

## Yöntem ve kanıt sınırı

- yapılanlar.md ve terminal-server.js, public/index.html, core ve plugin kaynakları okundu.
- Gerçek tarayıcı: BTC açılışı, geçersiz sembol, BTC'ye dönüş, 5m geçiş, giriş fiyatı düzenleme, yeniden yükleme.
- 2560×1440 ve 1707×960 CSS viewport denendi; fiziksel TV veya Windows ölçeği değiştirilmedi. 1707×960, QHD %150 ölçek için yaklaşık içerik alanı senaryosudur, gerçek monitör ölçümü değildir.
- Üç salt okunur yerel API isteği: BTC ticker 200/425 ms, BTC top position ratio 200/318 ms, geçersiz sembol klines 400/315 ms. Bu tek örnekler performans p95 ölçümü değildir.
- Top position ratio bu ortamda anahtar eklenmeyen mevcut proxy üzerinden başarılı döndü. Belge erişim şartı ile canlı davranış ayrıdır; erişim hatası varsayılmadı.
- 10 JavaScript dosyası node --check ile sözdizimi kontrolünden geçti. Bu doğruluk testi değildir.
- review/terminal-review-tests.cjs gerçek uygulama kaynaklarını izole VM'de, sahte DOM/akış yanıtlarıyla çalıştırır. Sekiz deterministik hata senaryosunun sekizi yeniden üretildi. Exit 0, hataların üretildiği anlamındadır; uygulamanın sağlıklı olduğu anlamına gelmez.
- Gerçek ağ kesintisi, bilgisayar yeniden başlatma, 72 saat dayanıklılık, tüm piyasa kapasitesi ve canlı likidasyon hacmi doğrulanmadı.

## Öncelikli bulgular

### F01 — P1: SYN için sabit pozisyon/karar değerleri tüm coinlere uygulanıyor

Kaynak: public/index.html:112, 444–480; public/plugins/chart/chart.plugin.js:359.

BTC açıldığında giriş 0.21948 ve LONG seçilmiş kabul ediliyor. Karar rozeti coin veya manuel seviyelere değil 0.2610/0.2250/0.2120 sabitlerine bakıyor. Canlı ekranda yaklaşık +38 milyon % PnL ve HEDEF GELDİ görüldü. İzole 84000 fiyat testi +38272179.93% üretti. Bildirim metni de SYNUSDT olarak sabit.

Öneri: coin/yön/giriş/zaman içeren gerçek manuel pozisyon modeli; pozisyon yoksa PnL veya çıkış rozeti yok. Açık pozisyon, görüntülenen coinden ayrı kalmalı. Sabit örnek fiyatlar üretim akışından kaldırılmalı.

Kabul: BTC/SYN/ucuz coin değişiminde yalnız kayıtlı pozisyon fiyatı kullanılır; manuel seviye değişimi bağımsız eski rozetle çelişmez.

### F02 — P1: OI/hacim doğrulanmadan “short squeeze teyidi” üretiliyor

Kaynak: public/plugins/verdict/verdict.plugin.js:323–345; 258–260.

WATCHING + LONG + fiyat>=trigger yeterli. Mum kapanışı, hacim artışı ve OI artışı kontrol edilmeden mesaj “direncini hacimle kırdı” ve “açık pozisyonlarda yukarı patlama” diyor. Testte OI 100→90 düşerken fiyat 101, tetik 100 olduğunda bu mesaj çıktı. CONFIRMED durumundan sonra smart-money değerlendirmesi erken return ile duruyor; sonraki zayıflama değerlendirilmez.

Öneri: 5m merkezli, geçici/kapanmış ayrımlı kanıt tablosu; veri yoksa o iddia yok. Destek, zayıflama ve çıkış senaryoları sürekli yeniden değerlendirilmeli. Giriş/TP/SL önerileri yerine görüşmedeki açıklama kapsamı uygulanmalı.

### F03 — P1: Short stratejisinde stop yönü yanlış

Kaynak: public/plugins/verdict/verdict.plugin.js:77–93, 331, 349–374, 384–435.

Manuel SHORT için tetik=100, hedef=90, stop=110 seçilip fiyat=99 gönderilince İPTAL/STOP çıktı; 99 short stopu 110'a ulaşmış değildir. Stop koşulu bütün yönlerde price<=stop. Teyit yalnız LONG, hedef kontrolü price>=target. Mevcut AUTO setup düzenlenince direction da yenilenmiyor. Telemetri long formüllerini kullanıyor.

Öneri: pozisyon yönünü açık alan yapma; yönden bağımsız koşulları kaldırma. Seviyeler bu sürümde tutulacaksa pozitif/sonlu değer ve yön sıralaması doğrulama. Nihai kapsamda otomatik giriş seviyesi üretimi yok.

### F04 — P1: Eski coin isteği yeni grafiği ezebiliyor

Kaynak: public/plugins/chart/chart.plugin.js:266–329; public/plugins/smart-money/smart-money.plugin.js:58–62; public/plugins/data-charts/data-charts.plugin.js:27–44; public/index.html:706–715.

REST dönüşünde istek kimliği/sembol/zaman dilimi kontrolü yok. İzole test A=100, B=200: B yanıtı önce, A sonra tamamlandığında B seçiliyken grafik 100 oluyor. chart:klines olayı eski veriyi o anki currentSymbol etiketiyle yayınlayabiliyor. Smartmoney olayında sembol dahi taşınmıyor.

Öneri: istek başında immutable symbol/interval/generation, dönüşte eşleşme kontrolü; iptal ve temiz loading state. WebSocket generation koruması REST'e de uygulanmalı. Interval değişimi ayrıca korunmalı.

### F05 — P1: Hatalı/eksik veriler eski değer veya nötr skor gibi gösteriliyor

Kaynak: public/index.html:690–718; public/plugins/smart-money/smart-money.plugin.js:68–111,207–285; public/plugins/data-charts/data-charts.plugin.js:39–44.

BTC'den ZZZINVALIDUSDT'ye geçince API -1121 Invalid symbol döndürdü. Buna rağmen önceki BTC mumları, mark/index, 97K BTC OI, oranlar, PnL ve taktik sayılar yeni başlığın altında kaldı. Tüm smart-money yanıtları başarısız olduğunda SMI 50% DENGELİ üretildi. İzole boş nesne testi aynı sonucu verdi. Kullanıcıya geçersiz coin hatası gösterilmiyor, tekrar istekleri sürüyor.

Öneri: exchangeInfo ile sembol doğrulama; son-good verinin sembol/zaman/kalite etiketi; başarısız kaynak alanında boş/eski durumu. Eksik veri nötr piyasa anlamına gelmez; yorum engellenmeli.

### F06 — P1: USDT hacim alanına coin miktarı yazılıyor

Kaynak: public/core/websocket.js:82–90; public/index.html:548–573.

WebSocket mapper msg.v base volume taşıyor, quote volume taşımıyor. Üst bar quoteVolume yoksa volume değerini dolar olarak basıyor. Canlı BTC ekranında değer $159.2K ile ~$13.36B arasında değişti. Yerel API yanıtı: volume=159194.041 BTC, quoteVolume=13375663851.73 USDT. İzole test $13.40B→$159.0K geçişini doğruladı.

Öneri: WebSocket q→quoteVolume eşlemesi; birimler ayrı tip/alan; quote hacim eksikse base hacmi USDT olarak kullanmama.

### F07 — P2: EMA çizgileri canlı mumla güncellenmiyor

Kaynak: public/plugins/chart/chart.plugin.js:227–261,307–309.

EMA20/EMA50 sadece REST loadKlines içinde hesaplanıyor. Canlı kline candle/volume serisini güncelliyor, EMA'ları güncellemiyor. İzole testte bir canlı mum güncellemesine karşı EMA update ve yeniden hesap sayısı sıfır. Zamanla çizgi son mumların gerisinde kalır.

Öneri: son kapalı hesap durumundan açık mumu yeniden hesaplama; yeni kapanmış mumda durumu ilerletme. Nihai DEMA/RSI/SMA uygulamasında da aynı test şartı kullanılmalı.

### F08 — P1: Yanıt sırası başka coin için SYN seviyeleriyle teyit üretebiliyor

Kaynak: public/plugins/verdict/verdict.plugin.js:265–275.

Smart-money cevabı kline cevabından önce gelirse currentSetup boşken 0.225/0.261/0.212 her coin için atanıyor. Test BTC + posRatio=2 + globalRatio=0.5 + fiyat=84000 koşulunda BTC için 0.225 direnci kırıldı mesajını üretti. Sonradan klines gelmesi önceden verilmiş yanlış teyidi geri almıyor.

Öneri: sembole özgü gerekli veriler hazır değilken setup üretmeme. Hard-coded fiyat fallback'i kaldırma. F02'nin kanıt/ready sözleşmesine dahil etme.

### F09 — P1 / kapsam eksikliği: Kalıcı veri ve bağımsız pozisyon takibi yok

Kaynak: terminal-server.js:9–55; public/index.html:400–784; package.json.

Sunucu yalnız static dosya ve HTTP proxy sunuyor. Veri toplama tarayıcı setInterval/WebSocket içinde; SQLite, sunucu tarafı toplayıcı ve pozisyon API'si yok. İncelenen coin değişince yalnız o coin dinleniyor. Tarayıcı kapanınca bu uygulamanın toplaması durur. Windows otomatik başlangıcını kuran dosya da mevcut teslimde yok; işletim sistemi görevleri ayrıca denetlenmedi.

Tarayıcıda giriş 84000 olarak değiştirildi, PnL yaklaşık -0.06% oldu; reload sonrası 0.21948'e döndü. Yön seçimi, giriş zamanı, kapatma/geçmiş yaşam döngüsü yok. “Kaydedildi” geri bildirimi kalıcı kayıt anlamına gelmiyor.

Öneri: onaylanan yerel toplayıcı/SQLite/manuel tek pozisyon mimarisini önce kurma; arayüzün canlı akışları sunucudan alması. Proxy ayakta olması 24/7 veri kaydı değildir.

### F10 — P2: WebSocket kesilmeleri devam ediyor; yedek akış motorları eşit beslemiyor

Kaynak: public/core/websocket.js:47–52,130–148; public/index.html:711–718.

İlk geçerli BTC görünümünde 1008 kapanışı görüldü; sonraki incelemede başka 1008 kayıtları da oluştu. Geçersiz sembol denemesinin 1006/1008 logları ayrıca mevcut, hepsi BTC kanıtı sayılmamalı. Kod 30 saniyede JSON method:'ping' gönderiyor; protokol uyumu araştırılmalı, bu incelemede kesin kopma nedeni kanıtlanmadı.

REST ticker fallback yalnız üst UI fonksiyonlarını çağırıyor; verdict motoruna ws:ticker veya başka fiyat olayı vermiyor. Bu yüzden bağlantı kaybında üst fiyat hareket ederken analiz/telemetri durabilir. Fallback WS sağlıklıyken de 1.5 saniyede bir çalışıyor. Proxy'de timeout, rate-limit kuyruğu ve Retry-After aktarımı yok.

Öneri: tek fiyat olay kaynağı, veri zamanı ve tazelik; kurala uygun reconnect/backoff ve eksik mum tamamlama; gerçek kesinti testi. “0 ms”, “her mikrosaniye”, “fiyat asla durmaz” iddiaları kaldırılmalı.

## Diğer geliştirme ve kapsam farkları

1. **Kararlaştırılan göstergeler yok:** Standart mum + EMA20/50 var; Heikin Ashi, DEMA9, RSI14/SMA9, normal/gizli uyumsuzluk yok. Kütüphane değişimi tek başına hata değildir, ama gereksinimi karşılamıyor.
2. **Altı panel var:** Basis ve OI/piyasa değeri eksik; sağda gerçek emir defteri yerine büyük işlem radarı bulunuyor. Bunlar farklı veriler.
3. **Geçmiş derinliği yetersiz:** Kline 500 kayıt (1m'de yaklaşık 8 saat 20 dakika); vadeli grafikler 288×5m≈24 saat. 30 günlük all-market ve 1 yıllık üst zaman dilimi arşivi yok.
4. **Funding türleri etiketsiz:** Üstte güncel gözlem +0.0043%, altta son gerçekleşmiş funding +0.0002% görüldü. İkisi farklı seri; bu başlı başına yanlış veri değil. Son ödeme tarihi ve gözlem zamanı yazılmalı.
5. **Taker başlık anlamı yanlış:** data-charts.plugin.js:213–220, oran 1'in altında olsa bile önceki değere göre arttığında “Alıcı baskısı” diyor. Canlı 0.592 ve Alıcı baskısı birlikte görüldü. “Alıcı payı arttı; satış hâlâ baskın” ayrımı gerekir.
6. **OI dolar değişimi nakit akışı değildir:** index.html:626–648 miktar yerine notional değişimini doğrudan Giriş/Çıkış diye adlandırıyor. Fiyat etkisi ve OI miktar değişimi ayrı gösterilmeli.
7. **SMI % gücü doğrulanmış olasılık değil:** Keyfi ağırlıklı 5–98 skoru, eksik veride de hesaplanıyor. Kaynak/zaman, kalibrasyon ve anlam yok; görüşmedeki kanıt tabanlı mesajlarla değiştirilmeli.
8. **$600 balina eşiği:** BTC'de sıradan işlemleri de balina etiketiyle veriyor. Toplu işlem birimi, yatırımcı kimliği veya kâr alımını kanıtlamaz. Büyük işlem olarak etiketlemek daha doğru.
9. **Fiyat hassasiyeti:** chart.plugin.js:289–290 ve verdict:205–208 fiyat büyüklüğüne göre sabit basamak seçiyor. Tick size kullanılmalı; küçük fiyatların tetik/stop'u sıfıra yuvarlanabilir.
10. **Zaman eksenleri:** Ana grafik epoch UTC, alt ECharts etiketleri yerel getHours kullanıyor; ortak zaman/İstanbul biçimleyicisi ve senkron imleç yok. Koddan tespit; fiziksel ekranla saat karşılaştırması ayrıca doğrulanmalı.
11. **Ses açık başlıyor:** verdict.plugin.js:21 speechEnabled=true; ayrıca chime ses toggle'ını kontrol etmiyor. Kullanıcının sessiz ekran şartıyla çelişiyor. Testte ses/bildirim izni açılmadı.
12. **Yerleşim:** 2560×1440 ölçümünde üst şerit taşmadı. Veri yüklendikten sonra 1707×960'da üst şerit clientWidth=1392, scrollWidth=1654: 262 px yatay taşma. Kaydırmasız şartı ölçekli kullanımda sağlanmıyor. Sekiz panel+RSI eklendiğinde yeniden test şart.
13. **Yerel erişim sınırı:** terminal-server.js:46 host belirtmeden listen çağırıyor; yalnız loopback hedefiyle uyumsuz. Ağdan erişilebilirlik firewall üzerinden bu incelemede test edilmedi. Proxy yalnız izin verilen GET market-data yollarını kabul etmeli.
14. **HTML kaçışlama:** coin:change sembolü verdict içindeki innerHTML'e gidiyor, aramada exchangeInfo doğrulaması yok. Sembol beyaz liste ve textContent/escape kullanılmalı. Aktif exploit denenmedi.

## Düzeltme sırası

1. F01/F02/F03/F08: yanıltıcı pozisyon ve teyit davranışını durdur; yönlü, kanıtlı analiz kur.
2. F04/F05/F06: sembol izolasyonu, veri kalitesi ve birim doğruluğu.
3. F09/F10: kalıcı merkezi veri katmanı, pozisyon yaşam döngüsü ve toparlanma.
4. HA/DEMA/RSI/SMA/uyumsuzluklar, EMA canlı güncellemesi yerine onaylanan gösterge seti.
5. Gerçek defter ve eksik paneller, zaman/funding etiketleri, ekran profilleri.
6. Otomatik regresyon, 72 saat dayanıklılık, kapasite ve geri yükleme testleri.

## Yeniden üretme

```powershell
node review/terminal-review-tests.cjs
```

Test mevcut hataları yakalamak için yazıldı; düzeltmelerden sonra beklenen davranışa göre assertion'ları tersine çevrilerek ürün regresyon testlerine taşınmalıdır. Mock DOM testi gerçek ECharts/Lightweight Charts çizimini veya dış servisin protokolünü doğrulamaz.
