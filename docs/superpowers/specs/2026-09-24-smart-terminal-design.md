# Kişisel Vadeli Veri Terminali — Tasarım ve Devir Taslağı

Tarih: 24 Eylül 2026 • Sürüm: 0.1 • Durum: Kullanıcı incelemesi için taslak

Bu belge görüşmede alınan kararları toplar. SMART_TERMINAL_PLAN.md değiştirilmemiştir. Bu belge uygulama kodu veya tamamlanmış test raporu değildir. Başka bir AI agent uygulamayı geliştirecek; Codex kod incelemesi ve testleri yapacaktır. Son kullanıcı incelemesinden sonra dosya/görev düzeyinde uygulama planı hazırlanmalıdır.

## 1. Amaç ve sınırlar

Kullanıcı Telegram'daki bağımsız bot sinyalini gördükten sonra coini elle arar; fiyat, hacim ve vadeli piyasa verilerini tek ekranda inceler. İşlemleri genellikle 15–60 dakika sürer. Terminal veri değişimlerini açıklar ve koşullu çıkış senaryoları sunar. Giriş fiyatı, hedef fiyat, emir, otomatik işlem veya kesin yön tahmini üretmez.

İlk faz: Windows bilgisayar, tek kullanıcı, tek açık manuel pozisyon, Binance USDⓈ-M kapsamındaki aktif USDT kripto perpetual pariteleri. Spot, USDC, COIN-M, vadeli teslim kontratları, diğer borsalar ve TradFi ürünleri kapsam dışıdır. Sembol sonuna bakmak yeterli değildir; exchangeInfo sözleşme/varlık metadata'sı doğrulanır. Yeni uygun listelemeler eklenir; işlemden kaldırılan semboller yeni seçime kapatılır, eski pozisyon kayıtları silinmez.

Bot kodları, abonelikleri, Telegram bağlantısı ve mevcut backend değiştirilmeyecek. Terminal bağımsız paket/servis ve ayrı yapılandırılabilir port kullanır. Aynı ağdaki botların IP istek bütçesine etkisi ölçülür; bağımsızlık onların yükünü yok saymak anlamına gelmez.

İkinci faza bırakılanlar: telefon erişimi, kullanıcının “linge bandı” dediği göstergenin tam adı/sürümü, Nadaraya–Watson'ın seçilecek sürümü. İlk fazda bunlar için hesap veya ekran eklenmez. Harici AI, sesli bildirim, geçmiş emir defteri arşivi ve tüm piyasanın ham işlem arşivi yoktur.

## 2. Kararların özeti ve zaman dilimleri

| Konu | Karar |
|---|---|
| Günlük / 4 saat | Büyük yapı, geri çekilme, uyumsuzluk bağlamı |
| 1 saat / 15 dakika | Kullanıcının hareketin gelişimini değerlendirmesi |
| 5 dakika | Ana karar ve çıkış senaryosu değerlendirmesi |
| 1 dakika | Görsel takip; tek başına çıkış senaryosu tetiklemez |
| Mum görünümü | Heikin Ashi |
| DEMA | 9, standart mum kapanışları |
| RSI | 14, standart mum kapanışları, Wilder yöntemi |
| RSI ortalaması | RSI 14 üzerine SMA 9 |
| Uyumsuzluk | Standart mum low/high ile aynı mumdaki RSI; normal ve gizli |
| Çıkış | Kullanıcı istediğinde elle kapatır; motorun onayı gerekmez |
| Uyarı | Yalnız ekran, zaman damgası ve mesaj geçmişi |
| Analiz | Açıklanabilir, sürümlü, tek profil; eşikler ölçümle belirlenecek |

5 dakikalık açık mumdaki durum “geçici”; kapanışta devam eden ilgili koşul “kapanışla doğrulandı” olarak etiketlenir. Bu, gelecek yönün doğrulanması değildir. Uyumsuzluk pivot teyidi ayrı bir olaydır; sadece mum kapanması pivotu kendiliğinden teyit etmez.

## 3. Ekran ve kullanıcı akışı

Ana ekran kaydırmasızdır. Dell U2719D ve Samsung 4K TV için ayrı yoğunluk/yazı ölçeği profilleri bulunur. Gerçek viewport ve Windows ölçeklendirmesi ölçülmeden okunabilirlik kabulü verilmez. Ana ekranın minimum desteklenen CSS alanı ekran denemesinde kararlaştırılır; desteklenmeyen alanda metni okunmaz hale getirmek yerine görünür uyarı verilir.

Yerleşim: üstte arama, fiyat, mark/index, değişim, hacim, funding ve sayaç; ortada büyük fiyat grafiği, hacim ve RSI/SMA alt alanı, sağda emir defteri; altta sekiz veri paneli 4×2; en altta analiz mesajı ve küçük sabit pozisyon özeti. Grafik alanının gerçek yüksekliği prototipte ölçülür. Ayrıntılar ve geçmiş açılır panelde, grafik tek tıkla geçici büyütülebilir. Ana sayfanın kaydırmasız olması bu ayrıntı panellerindeki kontrollü kaydırmayı yasaklamaz.

Sekiz panel: OI, top trader hesap oranı, top trader pozisyon oranı, genel L/S oranı, taker alış/satış hacmi, basis, funding geçmişi, OI/piyasa değeri. Her panelde kaynak dönemi, ait olduğu zaman, değer ve değişim özeti bulunur. L/S panellerinde oran ile long/short yüzde çubuğu birlikte; OI'da miktar ve USDT değer değişimi ayrı gösterilir.

Zaman dilimi şeridi 1D/4H/1H/15m/5m/1m geçişi sağlar. Başlangıç önerisi 5m; kullanıcı seçimi korunur. Grafikler ortak zaman imleci ve seçilmiş başlangıç anını paylaşır. Seyrek veri serisi, imleç anında daha yeni bir değeri geçmişe taşımaz. Son mevcut örneğin zamanı ve yaşı gösterilir; geçerli örnek yoksa boş bırakılır.

Arama büyük/küçük harf duyarsızdır; TAKE veya TAKEUSDT gibi girişleri eşler. Coin değişiminde istek/abonelik nesil kimliği kullanılır; önceki coinin geç gelen cevabı yeni ekrana uygulanmaz. Aynı coin için gereksiz yinelenen bağlantı kurulmaz.

Manuel pozisyon: coin, long/short, giriş fiyatı/zamanı zorunlu; not isteğe bağlı. Aynı anda yalnız bir açık kayıt, veritabanı seviyesinde de korunur. Başka coin incelemek pozisyonu değiştirmez; açık pozisyonun gerekli veri takibi devam eder. Mesajlar coin ve varsa pozisyon kimliği taşır. İncelenen coin için veri açıklaması ile açık pozisyon için çıkış yorumu etiketle ayrılır.

Kapatmada çıkış fiyatı/zamanı kaydedilir. Brüt yönlü fiyat değişimi gösterilir: long=(son/giriş−1)×100; short=(giriş−son)/giriş×100. Bu kaldıraç getirisi veya net PnL değildir. Miktar, komisyon ve kişisel funding ödemeleri hesaplanmaz. Son fiyat eskiyse değişim de eski olarak işaretlenir. Pozisyon geçmişi 30 günlük piyasa temizliğinden etkilenmez.

## 4. Kaynaklar ve geçmiş matrisi

| Veri | Kaynak/önerilen edinim | Saklama ve sınır |
|---|---|---|
| Sembol metadata | exchangeInfo | Sürümlü sözleşme bilgisi; periyodik yenileme |
| Gerçek OHLCV | klines REST geçmiş; canlı kline akışı | 1m son 30 gün |
| 5m / 15m | Eksiksiz 1m mumlardan UTC hizalı toplama | 30 gün + hesap başlangıç payı |
| 1h / 4h / 1d | REST geçmiş; kapanmış üst mum doğrulaması | En az 1 yıl hedefi, mevcut listeleme geçmişi kadar |
| OI miktar/değer geçmişi | openInterestHist | Kaynağın son ay sınırı içinde, 5m örnekler, 30 gün hedefi |
| Anlık OI | openInterest | Aktif coin/pozisyon için bütçe içinde; seyrek geçmişten ayrı seri |
| Top hesap / pozisyon | topLongShortAccountRatio / topLongShortPositionRatio | 5m kayıt, kaynak son 30 gün; belgede API anahtarı şartı |
| Genel L/S | globalLongShortAccountRatio | 5m kayıt; erişilebilir son 30 gün |
| Taker hacim | takerlongshortRatio; ayrıca mum taker hacimleri | Kaynak/dönem/birim ayrı; birbirinin yerine sessizce geçmez |
| Gerçekleşmiş funding | fundingRate | Ödeme olaylarının geçmişi, en az 30 gün |
| Gözlenen funding | premiumIndex / mark-price akışı | Kendi toplamamız başladığından itibaren dakikalık gözlem, 30 gün |
| Funding takvimi | next funding zamanı ve fundingInfo | Sabit 8 saat varsayımı yok |
| Basis | Binance basis serisi | 30 gün hedefi; kaynağın dönem anlamı korunur |
| OI / piyasa değeri | OI değeri + uygun dolaşım arzı ve fiyat | Birim, sözleşme çarpanı, arz zamanı doğrulanır; yoksa hesap yok |
| Emir defteri | REST snapshot + diff depth | Yalnız aktif coin/pozisyon, bellekte; tarihsel arşiv yok |
| Canlı işlemler | aggTrade | Aktif coin/pozisyon; sınırlı bellek tamponu, ham 30 gün arşivi yok |

Basis tanımı ve OI/piyasa değeri eşleşmesi ilk veri deneyinde sabitlenmelidir. 1000 gibi sözleşme çarpanları ve yeniden adlandırmalar göz ardı edilmez. Genel L/S “yalnız küçük yatırımcı”, top trader “tüm balinalar” diye etiketlenmez. Hesap sayısı ile pozisyon hacmi birbirine karıştırılmaz.

Funding'in dakikalık gözlem geçmişi ödeme geçmişinden türetilemez; ilk kurulumda geçmiş ay için mevcut olmayan gözlemler boş kalır. Negatif yöndeki değişim yüzde puanla ifade edilir; sıfır etrafında anlamsız göreli yüzdeler üretilmez.

Mum taker-buy miktarından sell=toplam−buy ve delta=buy−sell hesaplanabilir. Base ve quote hacimleri ayrı tutulur. Dakikalık toplamlardan üretilen delta/CVD “mumdan türetilmiş” olarak etiketlenir; tick replay değildir. CVD seçilmiş başlangıçla tanımlanır; boşlukta kesilir, kesintisizmiş gibi devam etmez. Kaynak akışının kapsamı ve olası hacim uyuşmazlıkları veri deneyinde kontrol edilir.

## 5. API bütçesi ve veri güncelliği

Resmî belgede ilgili futures/data uç noktalarında 1000 istek/5 dakika/IP sınırı vardır. Ortak mı ayrı mı olduğuna dair doğrulama tamamlanana kadar ortak muhafazakâr bütçe varsayılır. API ağırlık sınırı da ayrıca uygulanır. Sınırı zorlayan deney veya IP değiştirme yoluyla aşma yoktur. Top trader erişimi düşük hacimli canlı denemeyle doğrulanır; anahtar gerekiyorsa yerel servis saklar, arayüze/loglara göndermez, işlem yetkisi talep edilmez.

İstek öncelikleri: (1) açık pozisyon ve aktif coin, (2) canlı akış onarımı, (3) dönemsel tüm-piyasa tamamlama, (4) ilk geçmiş yükleme. Arka plan beklemiş kayıtları tek sayfada alır. Veri çözünürlüğü ile sorgulama sıklığı ayrı parametrelerdir. Coin açılınca önbellek hemen görünür, yaş etiketiyle tazelenir; yeni veri gelmeden canlı etiketi verilmez.

N sembol, M uç nokta, B kullanılabilir istek/5dk ise tek sayfalık tur alt sınırı 5×N×M/B dakikadır; geçmişte her uç noktanın sayfa sayısı ayrıca çarpılır. B; diğer uygulamalar, yeniden deneme ve canlı takip için ayrılan paydan sonra hesaplanır. N ilk kurulumda ölçülür; önceki 600 örneği sabit gereksinim değildir. Arka plan tazelik hedefi bu bütçe sonucundan çıkarılacak ve teslimde sayısal yazılacaktır.

429 yanıtında bildirilen bekleme uygulanır, 418 durumunda istekler durdurulur ve durum görünürdür. Üstel geri çekilme, rastgele küçük zaman farkları, sınırlı paralellik, timeout ve istek birleştirme uygulanır. Hata halinde veri 0'a dönüşmez. Sayfalama sınırlarında yinelenen kayıtlar anahtar ile birleştirilir. İlk geçmiş yüklemesi kesilirse kaldığı yerden devam eder.

## 6. Mimari ve veri tabanı

Önerilen uygulama: bağımsız Node.js/TypeScript servis ve modüler web arayüzü; ECharts gösterim motoru. Kesin paket/sürüm ve Windows servis barındırma yöntemi uygulama planında seçilir. Botların teknik servisindeki hesapları doğrulamadan kopyalamak yasaktır. Grafik kütüphanesi göstergeleri kendiliğinden hesaplıyor varsayılmaz.

Akış: Binance adaptörleri → doğrulama/zaman-birim normalizasyonu → sınırlı yazma kuyruğu ve ortak bellek durumu → SQLite → hesap/analiz motoru → yerel HTTP başlangıç verisi + WebSocket güncellemeleri → ekran modülleri.

Modüller kendi Binance istemcisini açmaz; merkezi servise abone olur. Her modülde başlat/durdur, abonelik temizliği ve hata yakalama sınırı vardır. Event bus tek başına çökme yalıtımı sağlamaz; ağır hesap işleri arayüz/veri alımını bloke etmemelidir. Kuyruk taşması sessiz veri kaybı yapmaz; etkilenen aralık kaydedilir ve mümkünse yeniden alınır.

SQLite WAL ilk adaydır; tek yazıcı, toplu kısa işlemler, sınırlandırılmış sorgular ve checkpoint izleme kullanılır. Gerçek yerel NVMe dizini zorunludur; ağ sürücüsü veya senkronizasyon klasörü kullanılmaz. SQLite/native sürücü sürümleri güncel kararlı sürümlerden sabitlenir. Açık dosyayı basit kopyalamak yerine desteklenen tutarlı yedek yöntemi kullanılır.

Mantıksal tablolar:

| Tablo | Ana içerik / benzersizlik |
|---|---|
| instruments | Borsa, sembol, sözleşme türü, quote/base, çarpan, tick size, listeleme/delist bilgisi |
| candles | instrument + interval + open_time benzersiz; OHLC, base/quote/taker hacim, closed |
| market_metrics | instrument + metric + period + source_time + source benzersiz; tipli değerler/birim |
| funding_settlements / funding_observations | Ödeme ve gözlem ayrımı |
| collection_state / data_gaps | İlerleme imleci, boşluk, onarım durumu |
| positions | Tek açık kayıt kısıtı; giriş/çıkış bilgileri |
| analysis_events | Pozisyon/coin, rule_version, data_revision, durum ve kanıtlar |
| settings / indicator_state | Kullanıcı tercihleri; sürümlü hesap başlangıcı/checkpoint |

Her piyasa kaydı kaynak zamanı ve alınma zamanı taşır. Dönem başlangıcı/bitişi, açık-kapalı durumu, birim ve kalite anlamı veri sözleşmesinde tanımlanır. UTC epoch ms saklanır, İstanbul saati gösterilir. Fiyatlar tick hassasiyetini koruyacak decimal metin veya doğrulanmış ölçekli tamsayıyla saklanır; hesaplar belgelenmiş toleransla yapılır. Aynı an farklı kaynakların değerleri üst üste yazılmaz.

İndeksler sembol/dönem/zaman aralığı sorgularına göre seçilir. Sınırsız SELECT ve tüm geçmişi tarayıcıya yükleme yoktur. Temizlik küçük partilerle yapılır; pozisyonlar ve kanıt kayıtları piyasa retention'ından bağımsızdır. Disk basıncında politika dışı veri sessizce silinmez; tarihsel indirme durdurulup hata gösterilir. Otomatik temizlik yalnız süresi dolmuş kayıtları kapsar.

## 7. Gösterge ve uyumsuzluk sözleşmesi

RSI: ilk 14 fiyat farkının kazanç/kayıp aritmetik ortalaması, devamında Wilder güncellemesi. Kazanç/kayıp ikisi sıfırsa 50; yalnız kayıp sıfırsa 100; yalnız kazanç sıfırsa 0. Bu kenar durum tercihi referans karşılaştırmasında açıkça kontrol edilir. Eksik mum üzerinde kesintisiz hesap varsayılmaz.

DEMA9 = 2×EMA9(close)−EMA9(EMA9(close)); EMA katsayısı 2/(9+1). İlk EMA SMA9 ile, ikinci EMA ilk 9 geçerli EMA'nın SMA'sıyla başlatılır. SMA9(RSI), 9 geçerli RSI olmadan üretilmez. Bu başlangıç seçimleri taslak teknik öneridir; doğrulama örnekleriyle sürüm 1'e sabitlenecektir.

HA close=(O+H+L+C)/4; HA open=(önceki HA open+önceki HA close)/2; high=max(H,HA open,HA close); low=min(L,HA open,HA close). İlk HA open=(O+C)/2. Her zaman dilimi kendi standart mumlarından ayrı hesaplanır; 1m HA toplayarak 5m HA yapılmaz.

Hesap başlangıç tarihi sabittir; viewport başlangıcı değildir. Retention sırasında durum checkpoint'i korunur. Açık mum, son kapalı mum durumundan yeniden hesaplanır; her tick recursive seriye yeni mum diye işlenmez. Kaynak geçmiş düzeltmesinde etkilenen sonrası yeniden hesaplanır ve veri revizyonu değişir; geçmiş mesaj sessizce yeniden yazılmaz.

Uyumsuzluk karşılaştırmaları:

| Tür | Fiyat | Aynı pivot mumlarındaki RSI |
|---|---|---|
| Normal pozitif | İkinci dip daha düşük | İkinci değer daha yüksek |
| Normal negatif | İkinci tepe daha yüksek | İkinci değer daha düşük |
| Gizli pozitif | İkinci dip daha yüksek | İkinci değer daha düşük |
| Gizli negatif | İkinci tepe daha düşük | İkinci değer daha yüksek |

Pivotlar standart fiyat low/high üzerinden bulunur. Eşitlik toleransı, sol/sağ mum sayıları, minimum/maksimum pivot uzaklığı, eşleştirme ve çizgi ihlal kuralı G3 deneyinde dondurulmalıdır; kullanıcı iki mum teyidini henüz onaylamamıştır. Fiyat pivotunda RSI'nın ayrıca pivot olmasını zorunlu kılmak farklı algoritmadır; ilk sürüm aynı mum RSI karşılaştırmasını kullanır. Gizli yapı geometrisi bulunabilir, “trend devamı” yorumu için bağlam kuralı ayrıca gereklidir.

Aday çizgi kesik ve değişebilir; teyitli düz. pivot_time, detected_at ve confirmed_at ayrıdır. Teyitli geçmiş olay yeni mumlarla geçmişten yok edilmez; sonraki gelişmeyle geçersizleşirse ayrı durum/olay eklenir. HA üzerinde standart fiyat pivotu HA fitiline oturmayabilir: kaynak açıklaması ve gerçek fiyat noktasının görsel işareti korunur.

## 8. Kural tabanlı analiz ve kanıt

Tek profil; sürümlü ve deterministik. Durumlar: destek sürüyor, zayıflama var, çıkış senaryosu güçleniyor, veri yetersiz. Bunlar emir değildir. Tek bir göstergeden güçlü çıkış mesajı oluşmaz. Kanıt grupları: fiyat/momentum; gerçekleşen işlem baskısı; OI/pozisyonlanma. RSI ile RSI-SMA kesişimi iki bağımsız grup değildir; OI ve top oranları da bağımsız iki oy diye sayılmaz.

5m temel değerlendirme, 1m yalnız takip. Üst zaman dilimleri yön/yapı bağlamı sağlar. Mum içi aday durum ile kapanış değerlendirmesi ayrı kaydedilir. Mesajda ölçüm penceresi, kullanılan değerler ve zamanları, karşıt kanıt, güçlenme/zayıflama koşulu, veri kalitesi bulunur. Kalibre edilmemiş güven yüzdesi yoktur. “Balinalar kârla çıktı”, “kesin dağıtım”, “taze para girişi kesin azaldı” gibi toplu verinin kanıtlamadığı nedenler kesin dille yazılmaz.

Son 5m, son 15m ve girişten beri değişimler ayrıdır; kaynak örnekleri istenen sınıra eşit değilse gerçek karşılaştırma zamanları gösterilir. Veri gelecekten geçmişe taşınmaz. Gerekli veri eski/eksikse ilgili çıkarım engellenir; diğer mevcut ölçümler gösterilebilir.

Durum geçişi, yeni bağımsız kanıt veya anlamlı veri kalitesi değişiminde mesaj kaydı oluşur. Aynı durumun her tick'te yeni mesajı yoktur. Tekrar önleme, minimum süre ve histerezis sayıları G5'te kalibre edilecek; uygulayan agent keyfi sayıları üretim varsayılanı yapamaz.

Kanıt kaydı: giriş değerleri/birim/zamanlar, mum kimlikleri, hesap ve kural sürümleri, açık-kapalı durum, o anda sistemin eriştiği veri. Ham piyasa temizlendikten sonra tam grafik replay vaat edilmez; mesajın kararı kanıt paketi üzerinden yeniden üretilebilmelidir.

## 9. Windows, toparlanma ve yerel erişim

Servis Windows açılışında oturum açılmadan çalışır, görünür konsol gerektirmez. Tarayıcı kendiliğinden açılmaz. Tek örnek kilidi, kontrollü yeniden başlatma, kullanıcıya elle durdur/başlat imkânı vardır. Normal durdurma yazma kuyruğunu güvenli kapatır; zorla kapanma testi de yapılır.

İlk faz yalnız loopback erişimi. Anahtarlar tarayıcı veya repoya yazılmaz. Telefon fazı geldiğinde ağ erişimi/kimlik doğrulama ayrı tasarlanacaktır. Windows uyku ve ağ ayarları kullanıcıya belgelenir; kendiliğinden sistem ayarı değiştirilmez. Pil, uyku veya router kesintisini çözmüş sayılmaz.

Bağlantıda REST geçmiş ve WebSocket yarışını önlemek için tamponlama, benzersiz anahtar ve kapanış sonrası uzlaştırma uygulanır. Emir defterinde Binance snapshot/delta sıra kuralları izlenir; kopuk zincir tespitinde defter “yeniden eşitleniyor” olur, snapshot yeniden alınır. Tutarsız defterden metrik üretilmez.

Gözlemlenebilirlik: kaynak bazında son olay/ulaşma zamanı, saat farkı tahmini, API kullanım ve bekleme, kuyruk, boşluklar, SQLite/WAL boyutu, disk, son yedek ve servis sürümü. Loglar döndürülür, anahtar ve kişisel hesap bilgisi içermez. Yedekten geri dönüş ayrı dizinde denenir.

## 10. Teslim aşamaları ve geçiş kapıları

| Kapı | Teslim | Geçiş şartı |
|---|---|---|
| G0: kaynak doğrulama | Endpoint sözleşmeleri, erişim, limit kapsamı, funding/basis/arz tanımı | Düşük hacimli gerçek yanıt örnekleri + kaynak tarihleri; eksik kaynaklar açık |
| G1: kapasite | 20–30 farklı yoğunlukta parite, ardından tüm ölçeğe uygun yük deneyi | Disk/RAM/CPU/API, sorgu p95 ve günlük büyüme; SQLite kararı |
| G2: kalıcı veri | Toplayıcı, DB, ilk yükleme, retention, Windows başlangıcı | Kesinti/tekrar/yeniden başlatma/yedek testleri |
| G3: hesaplar | Referans seriler, göstergeler, uyumsuzluk parametreleri | Sabit veri üzerinden bağımsız beklenen sonuçlar; geleceğe bakmama testleri |
| G4: arayüz | Gerçek ekran profilleri, sekiz panel, pozisyon, senkron imleç | Kaydırmasız okunabilirlik, coin değiştirme ve performans testleri |
| G5: analiz | Sayısal eşikler, geçiş tablosu, kanıt paketleri | Long/short, yatay/oynak/eksik veri örnekleri ve kullanıcı incelemesi |
| G6: dayanıklılık | Tam entegre sistem, işletim rehberi | En az 72 saat soak, toparlanma ve geri yükleme raporu |

G1 başarısızlığı doğrudan PostgreSQL gerektirir demek değildir: önce darboğazın DB kaynaklı olduğu gösterilir. Düzeltilmiş SQLite tasarımı hedefleri karşılamıyorsa PostgreSQL'e arayüz geliştirilmeden geçilir. Daha fazla disk almak API veya CPU darboğazını çözmez.

## 11. Kabul testleri ve hedefler

Performans sayıları kullanıcıyla konuşulan başlangıç hedefleridir, ölçülmüş sonuç değildir. G1/G4 raporunda veri miktarı, donanım, ekran ölçeği, eşzamanlı işler, örnek sayısı ve p95 verilir. Önerilen örnek sayısı her etkileşim için en az 100; ağ gecikmesi yerel işleme süresinden ayrılır.

| Kimlik | Kabul kriteri |
|---|---|
| P01 | Sıcak önbellekte coin görünümü p95 <500 ms |
| P02 | Yerel geçmişten ilk kullanılabilir görünüm p95 <2 s; ilk internet geçmiş indirmesi bu test değildir |
| P03 | Servisin aldığı canlı olayın ilgili ekrana ulaşması p95 <250 ms; kaynağın yayın sıklığı ayrı |
| P04 | 72 saatte kontrolsüz RAM/WAL/kuyruk büyümesi yok; günlük büyüme ve disk ömrü projeksiyonu raporlanır |
| D01 | Yinelenen/sırasız/sınırda tekrar sayfalar aynı kalıcı veri sonucunu verir |
| D02 | Açık mum tekrar güncellenmesi RSI/EMA geçmişine sahte mum eklemez |
| D03 | Giriş, kapanış ve üst mum sınırları UTC'de doğrudur; İstanbul gösterimi sonucu değiştirmez |
| D04 | Zoom, viewport ve restart aynı kapalı mum göstergelerini tolerans içinde korur |
| D05 | Veri boşluğu 0 olmaz, gelecek örnek geçmiş ana bağlanmaz; eski veri yorum engelini tetikler |
| D06 | HA, standart fiyat, OI miktar/değer ve funding yüzde/puan ayrımı örneklerle doğrulanır |
| D07 | Uyumsuzluk sadece teyit anından sonra teyitli; geçmiş replay gelecekteki mumları kullanmaz |
| D08 | Kaynak geçmiş düzeltmesi revizyon üretir; eski mesajın dayanağı kaybolmaz |
| U01 | Hızlı A→B→A coin geçişi eski cevabı yanlış ekrana koymaz |
| U02 | İncelenen coin değişirken açık pozisyon takibi ve mesaj kimliği korunur |
| U03 | İki hedef ekran/gerçek Windows ölçeğinde ana ekran kaydırmasız ve okunabilir |
| U04 | Sessiz bildirim; mesaj geçmişi ve büyütme çalışır; 1m tek başına çıkış durumu üretmez |
| R01 | Ağ kopma/uyku/yeniden açılış sonrası veri onarılır veya boşluk görünür kalır |
| R02 | Defter delta zincirindeki eksiklik yeniden senkronizasyon başlatır |
| R03 | Zorla süreç kapanması sonrası DB bütünlüğü, tek servis ve tek pozisyon kısıtı korunur |
| R04 | Düşük disk ve API kısıtında kontrollü davranış; sınırsız retry/yazma yok |
| R05 | Tutarlı yedekten ayrı dizine geri yükleme ve pozisyon/ayar/kanıt doğrulaması |
| A01 | Aynı kanıt+profil sürümü aynı mesaj/durum üretir; ters yön senaryoları ayrı test edilir |
| A02 | Tek kanıt grubu güçlü çıkış üretmez; eksik veri ve çelişki saklanmaz |

Testler yalnız uygulamanın ürettiği sonucu kopyalayarak yazılmaz. Küçük elle doğrulanabilir seriler, bağımsız formül hesapları ve aynı veri/kaynak/başlangıç koşuluyla referans karşılaştırması gerekir. Kullanıcının mevcut grafiğinden fark varsa formül, başlangıç veya veri kaynağı farkı raporlanır; görünümü benzetmek için yanlış veri seçilmez.

## 12. Uygulama öncesi kapanacak teknik kayıtlar

Bu taslak doğrudan eksiksiz kodlama talimatı değildir. Aşağıdaki kayıtlar ilgili kapının ölçüm teslimidir; kullanıcıdan teknik sayı tahmin etmesi beklenmez:

1. G0: güncel uygun sembol sayısı, uç nokta erişimi/API anahtarı, kota paylaşımı ve diğer botların payı.
2. G0: her metrik zaman/birim sözleşmesi; basis, arz/çarpan ve funding alanlarının anlamı.
3. G1: işlemci modeli, boş disk, yerel veri dizini, veri boyutu ve sorgu testi; arka plan tazelik hedefi.
4. G3: hesap başlangıç payları/toleransları, uyumsuzluk pivot/pencere/eşitlik parametreleri ve bağlam tanımı.
5. G4: gerçek ekran çözünürlüğü, Windows ölçeği ve minimum okunabilir viewport.
6. G5: sayısal eşikler, tazelik toleransları, histerezis, mesaj tekrar önleme ve geçiş kuralları.
7. G2/G6: yedek sıklığı, saklama sayısı, ayrı yedek konumu ve geri yükleme prosedürü. Tek fiziksel disk tam yedek koruması sayılmaz.

Bu değerler tanımlanmadan ilgili özellik “üretime hazır” sayılmaz. Kullanıcı taslağı inceledikten sonra uygulama planı bunları dosya/görev/test teslimlerine bölecektir. Uygulayıcı kapsamı sessizce genişletemez, açık kararları tamamlanmış gibi sunamaz.

## 13. Doğrulama kaynakları

24 Eylül 2026 tarihli belge incelemesi; canlı erişim ve kapasite testi henüz yapılmadı.

- Binance REST market data: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data
- Binance yerel emir defteri: https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly
- SQLite WAL: https://www.sqlite.org/wal.html
- PostgreSQL MVCC: https://www.postgresql.org/docs/current/mvcc-intro.html
- Heikin Ashi veri ayrımı: https://www.tradingview.com/pine-script-docs/concepts/non-standard-charts-data/
- RSI uyumsuzluk kavramı: https://www.tradingview.com/support/solutions/43000589127-rsi-divergence-indicator/
