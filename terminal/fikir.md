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
