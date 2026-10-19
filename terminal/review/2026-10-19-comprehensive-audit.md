# 19.10.2026 — Alpha Terminal kapsamlı doğruluk denetimi

## Sonuç

`npm test` başarılı: 117 test/kontrol, sıfır başarısızlık. Ayrıca 57 JavaScript dosyasının sözdizimi kontrolü ve `git diff --check` geçti. Testler gerçek kasa/sinyal/geçmiş kayıtlarını değiştirmedi.

Canlı Binance kontrolü (`npm run test:live -- --closed-candle`) başarılı: 525 işlem gören USDT perpetual sembolün resmi kontrat bilgisi, BTC için 251 mumluk ısınma ve gerçek 1m WebSocket mesajı alındı. Aynı tamamlanmış mumun WebSocket `k.q` hacmi ile REST kline `[7]` hacmi eşleşti (`closedQuoteVolumeMatch: true`). Bu kontrol hesap anahtarı veya bot arşivi kullanmaz.

## Projenin korunan amacı

Bağımsız Binance Futures analiz terminali; 9 yerel bot, izleme listesi, çoklu grafik/pencere, kalıcı sinyal geçmişi ve yalnızca okuma uç noktaları kullanan kasa entegrasyonu. Harici bot servisinden veri alınmıyor. Sinyalin görünür olması için veri veya gösterge uydurulmuyor.

## Hacim ve zamanlamanın düzeltilmesi

- 24 saatlik kayan ticker hacmi farkı, 1m mum hacmi değildir. Bu farkın M1/V3 hacmi olarak kullanımı kaldırıldı.
- En az 1 milyon USDT günlük hacmi olan semboller için gerçek `kline_1m` akışları dinleniyor. Akışlar bağlantı başına en fazla 800 abonelikte bölünüyor ve abonelik mesajları birleştiriliyor.
- M1 fiyatı, mum kimliği, olay zamanı ve USDT hacmi aynı WebSocket olayında kopyalanıyor. Daha sonra gelen REST yanıtı sinyalin canlı hacmini değiştiremiyor.
- M1 hacmi: `(anlık 1m quoteVolume / önceki tamamlanmış 1m quoteVolume - 1) × 100`. Fiyat değişimi gerçek önceki mum kapanışına göre hesaplanıyor. Önceki mum indeksle değil `openTime` ile eşleştiriliyor.
- Dakika değişimi sonrası gelen son kapanış olayı reddedilmiyor; ilk tick ile 45. saniye arasında önceki kapanış referansı kaybolmuyor.
- V3 hacmi, gerçek tamamlanmış 1m USDT hacmini önceki 20 tamamlanmış mumun USDT ortalamasıyla karşılaştırıyor. `+18.5%` gibi sabit fallback kaldırıldı.
- REST/WS birleşiminde sunucu olay saati ile yerel istek saati karşılaştırılmıyor; yerel alınma zamanı kullanılıyor. Eski olaylar son mumu geriye alamıyor.

## Botlar ve göstergeler

- Kullanılmayan rastgele başlangıç sinyali üreticisi tamamen silindi. Sabit boost, önceki fiyat, RSI/SRSI, balina oranı, fonlama geçmişi ve 4 saat geri sayımı kaldırıldı.
- Yapısal botlar tamamlanmış mumlarda değerlendirilir. 1m/5m/1h/4h/1d gösterge etiketleri kendi gerçek zaman dilimlerinden gelir; günlük pivot önceki tamamlanmış UTC günden hesaplanır.
- İndikatörler 250 geçerli mumla ısınır; tampon 250 tamamlanmış ve 1 oluşan mumu saklar. Tekrarlanan warm-up istekleri birleşir. Eski tamponlar ve yeniden bağlanma boşlukları yeniden yüklenir.
- Kısa geçmiş, tanımsız StochRSI/WT veya eksik türev verisi `null` kalır. Gerçek sıfır kaybolmaz. `Math.round(null)` ile sahte 0 sinyali üretilmez.
- RSI/Stoch/WT erken yuvarlanmaz; EMA/pivot mikro fiyatları 4 basamakta sıfırlanmaz. Pivot ve hacim eşikleri gösterim yuvarlamasından önce değerlendirilir.
- Uyumsuzluk, pivotun ilk teyidinde oluşur; aynı eski pivot her yeni mumda yeniden yayınlanmaz. Kırmızı WT kesişimi boğa teyidi sayılmaz.
- Günlük 250 mum bulunmaması, günlük indikatöre ihtiyaç duymayan DIV/Hammer değerlendirmesini engellemez. Eksik opsiyonel yüksek zaman dilimleri `—` gösterilir.
- Mum/rawId/id tekilleştirmesi ve cooldown yeniden başlatmada korunur. Durdurulmuş neslin soket/REST/tarama işleri yeni nesle sinyal yazamaz.
- Dış webhook yalnızca belirtilen botu hedefler. Bilinmeyen hedef 400, strateji tarafından elenen sinyal 422 döner; elenen sinyal için başarı logu yazılmaz.

## Kayıt, kasa, sunucu ve arayüz

- Sinyal arşivinde sürekli akışın disk kaydını sonsuza ertelemesi, son 10 kayıt dışındaki mükerrerler, sıfır metrik kaybı ve retention indeksleri düzeltildi. Mum/kaynak/zaman ve kart alanları yeniden başlatmada korunur.
- Arşiv, günlük geçmiş ve kasa dosyaları bozuksa orijinal içerik ezilmez. Kasa yazımı atomiktir; başarısız batch yazımı belleği geri alır. Bilerek boş bırakılmış defter eski Excel satırlarıyla doldurulmaz.
- Binance gerçekleşen PnL verisi sayfalanır ve USDT filtrelenir. Kârlı işlemden Long, zarardan Short yönü çıkarılmaz. Hata başarı gibi raporlanmaz. Çoklu import tek disk yazımı kullanır.
- Anahtar değişiminde eski secret/cache temizlenir; maskeli mevcut anahtar yanlışlıkla gerçek anahtarın üzerine yazılmaz. Yerel anahtar dosyası Git dışında tutulur.
- Sunucu localhost üzerinde dinler, yabancı Origin/Host isteklerini reddeder. Ağ zaman aşımı açık bağlantıyı sonlandırır. Modül import edilmesi piyasa motorunu başlatmaz.
- Watchlist 15 saniyelik REST önbelleği ve eşzamanlı istek birleştirmesi kullanır. Canlı fiyat/hacim istemci WebSocket akışından güncellenir. 12 eşzamanlı pencere 24 upstream isteği yerine bir çift istek kullanır.
- Grafiklerde coin/timeframe yarışları ve donmuş RSI/BB/SMA/hacim göstergeleri, bot pencerelerinde geç gelen eski yanıtlar düzeltildi.
- Ondalıklı RSI, 0 hacim, ham fiyat basamakları, boş favoriler, negatif hacim etiketi ve eski sinyallerin hâlâ “Bugün” görünmesi düzeltildi. Eksik sentiment/funding yüzdeleri uydurulmaz.
- `ws` doğrudan terminal bağımlılığı yapıldı; bağımlılık kilidi eklendi. Terminal artık üst klasörün tesadüfi bağımlılıklarına dayanmaz.

## Tekrarlanabilir testler

| Komut / dosya | Başarılı kontrol |
| --- | ---: |
| `review/terminal-regression-tests.cjs` | 6 |
| `review/terminal-followup-tests.cjs` | 5 |
| `review/strategy-accuracy-tests.cjs` | 25 |
| `review/frontend-audit-tests.cjs` | 20 |
| `review/market-engine.test.cjs` | 24 |
| `review/server-services.test.cjs` | 29 |
| `review/http-smoke.test.cjs` | 8 (üst test ve 7 alt test) |
| **`npm test` toplamı** | **117** |

HTTP testi gerçek Express ve yerel HTTP kullanır; geçici veri klasörü, boş kasa/sinyal fixture'ları ve kapalı Binance ağıyla çalışır. Matematik testleri bağımsız RSI/Stoch/EMA referans hesabı ve sınır örnekleri içerir. Motor testi 745 sembollük yük, dakika sınırı, gecikmeli REST, kopma/yeniden başlatma ve hacim kaynaklarını tekrar oynatır.

Eski testlerin artık bulunmayan pozisyon/PnL/OI widget'larını kendi sahte fonksiyonlarıyla taklit edip PASS yazması kaldırıldı. Dört eski kontrol açıkça atlanır ve 117 başarıya dahil değildir. Eski 36 testlik rapor güncel sürümün doğruluk kanıtı değildir; güncel ana komut `npm test`tir.

## Sınırlar ve çalışma ayarları

- M1 tarama saniyesi mevcut varsayılanla `M1_SCAN_SECOND=45`, fiyat eşiği %0.70 ve sembol cooldown'ı 45 saniyedir. Bu ayarlar harici bir terminalin kesin tetik saniyesinin ölçüldüğü anlamına gelmez.
- M1 radarı günlük hacmi en az 1 milyon USDT olan tüm görülen sembolleri izler. Yapısal tarama kaynak bütçesi için en yüksek hacimli 15 sembolle sınırlıdır. V3 kapanmış mumda en az %25 hacim artışı ve 10 milyon USDT günlük hacim; FR pozitif OI teyidi kullanır.
- Önceki gün verisi olmayan sembolde günlük pivot bilinmez; ilgili filtre atlanmış sayılmaz. 250 mumluk geçmişi olmayan zaman diliminde gösterge uydurulmaz.
- Eski sinyal arşivinin geçmişteki verileri geriye dönük yeniden hesaplanmadı/silinmedi. Gerçek kasa ve kullanıcı kayıtları korundu.
- Gerçek hesap anahtarıyla imzalı Binance entegrasyonu ve uzun süreli 7/24 dayanıklılık testi yapılmadı. Hesap akışları izole sahte ağ yanıtlarıyla test edildi. Gerçek tarayıcıda görsel QA yapılmadı; istemci davranışı VM testleriyle ve yerel kaynak/sözdizimi kontrolleriyle denetlendi.
- Depoda Git remote tanımı bulunmuyor; GitHub push için hedef adres mevcut değil.

## Birincil API kaynakları

- [Binance Kline WebSocket alanları ve quote volume](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market#kline-candlestick-streams)
- [Binance REST kline verisi](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data#kline-candlestick-data)
- [Binance resmi connector: gelir geçmişi sayfalaması](https://github.com/binance/binance-futures-connector-python/blob/main/binance/um_futures/account.py)
