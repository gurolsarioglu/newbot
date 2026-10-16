# Düzeltmelerin ikinci doğrulaması — 25 Eylül 2026

## Sonuç

`hata.md` içindeki “tüm problemler çözüldü” sonucu mevcut kanıtlarla doğrulanmıyor. Mevcut regresyon paketi 8/8 geçiyor; eklenen yedi davranış kontrolünün yedisi de başarısız. Bu yedi kontrol aşağıdaki hataları tekrar üretiyor. Uygulama kodu değiştirilmedi. Tasarımda henüz uygulanmamış özellikler kapsam dışıdır.

## Yeniden üretme

Proje kökünde:

```powershell
node review/terminal-regression-tests.cjs
node review/terminal-followup-tests.cjs
```

İlk komut: exit 0, 8 başarılı. İkinci komut: exit 1, 0/7 başarılı; başarısızlıklar aşağıdaki beklenen davranışların sağlanmadığını gösterir. Ek paket mevcut paketin DOM/EventBus/yerel depolama taklitlerini kullanır ve gerçek uygulama kaynaklarını VM içinde çalıştırır. Canlı hesaba erişmez; gerçek pozisyon açmaz, tarayıcının kayıtlı seviyelerini değiştirmez. Bu testler gerçek ağ gecikmesi ve uzun süreli çalışma testi değildir.

## Açık hatalar

### 1. P1 — Manuel SHORT sonraki veri güncellemesinde LONG oluyor (H03 kısmen açık)

- Kaynak: `public/plugins/verdict/verdict.plugin.js:321`.
- Tetik 100, hedef 90, stop 110 ile manuel SHORT kaydedilir. Sonra top-trader oranı 2, global oran 0.5 ve OI 100→110 verisi gelir. Fiyat 99 olur.
- Sonuç: `İPTAL / STOP SEVİYESİ AŞILDI!`. Fiyat short stopuna ulaşmamıştır.
- Neden: otomatik squeeze dalı `userOverridden` kontrolü yapmadan yönü LONG'a çevirir. Seviyeler SHORT olarak kaldığı için 110 yanlış yönde değerlendirilir.
- Kabul ölçütü: manuel yön ve seviyeler piyasa yorumundan bağımsız korunmalı; bu akışta stop oluşmamalı, fiyat 110 olduğunda short stopu çalışmalı.

### 2. P1 — SHORT kârı zarar işaretiyle gösteriliyor

- Kaynak: `public/index.html:459`.
- Giriş 100, tetik 100, hedef 90, stop 110, güncel fiyat 95.
- Sonuç: `-5.00% PnL`; yön dikkate alınmış fiyat getirisi `+5.00%` olmalı.
- Neden: PnL formülü daima `(fiyat-giriş)/giriş`; short yönü ancak bundan sonra belirleniyor.
- Kabul ölçütü: long ve short için kazanç/zarar işaretleri ve renkleri ayrı test edilmeli. Bu kontrol kaldıraç, komisyon ve funding sonrası net getiri hesabı değildir.

### 3. P1 — OI verisi hiç gelmeden teyit üretilebiliyor (H02 kısmen açık)

- Kaynak: `public/plugins/verdict/verdict.plugin.js:385`.
- Manuel LONG 100/120/90 kaydedilir; smart-money yanıtı gelmeden fiyat 101 olur.
- Sonuç: `TEYİT GELDİ: SHORT SQUEEZE TETİKLENDİ!`.
- Neden: sadece OI mevcut ve sıfırdan küçük/eşitse teyit engelleniyor. `null` OI engellenmiyor. OI bulunmayan smart-money yanıtının sıfıra çevrilmesi de bilinmeyen veriyi “OI düşüyor” olarak açıklayabiliyor.
- Kabul ölçütü: eksik, geçersiz ve sıfır değişimli veri ayrı ele alınmalı; veri yokken yalnız fiyat hareketi bildirilmeli, OI/squeeze teyidi verilmemeli.

### 4. P1 — Teyit sonrası bozulan veri değerlendirmeyi yenilemiyor (H09 açık)

- Kaynak: `public/plugins/verdict/verdict.plugin.js:300`.
- LONG 100/120/90; OI 100→110 ve fiyat 101 ile teyit oluşur. Ardından pozisyon oranı 0.8, OI 100→90 olur.
- Sonuç: eski `TEYİT GELDİ` mesajı değişmez; aynı olumsuz veri teyitten önce dağıtım dalına girebilir.
- Neden: `CONFIRMED` ve `TARGET_REACHED` durumlarında akıllı para değerlendirmesi erken döner. OI alanı güncellense de yorum yenilenmez.
- Kabul ölçütü: teyit sonrası ters veriler mevcut değerlendirmeyi güncellemeli; fiyat hedef/stop takibi ile veri yorumu birbirini kilitlememeli.

### 5. P1 — Yeni coinde eski coin oranları ve grafikler kalıyor (H05 kısmen açık)

- Kaynak: `public/plugins/smart-money/smart-money.plugin.js:76–115`; chart/data-charts yükleme hata yolları.
- İzole test: BTC pozisyon oranı 2.00 yüklenir; INVALIDUSDT için boş yanıt gelir. SMI `--%` olurken pozisyon oranı `2.00` kalır.
- Canlı tarayıcı: BTC verileri geldikten sonra arama alanına INVALIDUSDT yazılıp Enter'a basıldı. HTTP 400 sonrasında başlık `GEÇERSİZ SEMBOL`, SMI `VERİ YOK` oldu; BTC'nin 1.89 pozisyon, 1.35 hesap, 1.25 global, 0.54 taker oranları ve eski OHLC/alt grafik değerleri kaldı. Üst bağlantı rozeti de `CANLI` görünüyordu; bu rozet sembol verisinin geçerli olduğunu doğrulamıyor.
- Kabul ölçütü: sembol değişiminde ilgili paneller temizlenmeli veya önceki sembole ait olduğu açıkça belirtilmeli; hata/eksik yanıt sonrasında eski değerler yeni coin altında gösterilmemeli.

### 6. P1 — Kaydedilen seviyeler geri yüklenirken inputlar boş kalıyor (H11 kısmen açık)

- Kaynak: `public/plugins/verdict/verdict.plugin.js:168–169,269`.
- Yerel depolamada BTC için LONG 100/120/90 varken temiz sayfa ortamında BTC seçilir.
- Sonuç: tetik inputu boş. Setup belleğe okunuyor fakat görünür alanlara yazılamıyor.
- Neden: `_fillInputValues` çağrılmadan önce `userOverridden=true` yapılıyor; yardımcı fonksiyon bu bayrak açıkken alanları güncellemiyor. Geri yükleme dalı grafik seviyelerini de yayımlamıyor.
- Kabul ölçütü: yenileme ve coinler arası geçişte giriş alanları, setup yönü ve grafik çizgileri aynı kayıtlı değerleri göstermeli; takip durumunun devam etmesi veya yeniden başlatılması açık ve tutarlı olmalı.

### 7. P2 — Fiyat kaynaklı nominal OI değişimi para girişi diye gösteriliyor (H13 açık)

- Kaynak: `public/index.html:660–690`, `updateOpenInterestUI`.
- OI miktarı her iki örnekte 100; nominal değer 10.000→11.000.
- Sonuç: `+$1.0K (%+10.0) Giriş`.
- Neden: etiket yalnız `sumOpenInterestValue` farkından üretiliyor; miktar aynıyken fiyat değişimi de bu farkı yaratabilir. Fonksiyon gerçek para transferi veya pozisyon sahibinin hareketini ölçmüyor.
- Kabul ölçütü: nominal OI ve miktar değişimleri doğru adlarla ayrılmalı; nominal fark doğrudan net para girişi/çıkışı olarak sunulmamalı.

## Geçen testlerin sınırı

H01, H04, H06, H07 ve H08 için mevcut paketteki dar senaryolar geçti. H02 yalnız düşen OI'yi, H03 yalnız sonraki otomatik veri gelmeden short kontrolünü, H05 yalnız SMI skorunu sınadığı için daha geniş hataları yakalamıyor. H09 ve H13 güncel `hata.md` durum tablosunda bulunmuyor; açık bulgular olarak tekrar izlenmeli.

H10/H12/H14/H15 ve WS düzeltmelerine bu ek pakette tam kabul testi uygulanmadı. Kısa canlı kontrolde veri akışı görüldü; bu, WS bağlantısının uzun süre sorunsuz kalacağını kanıtlamaz. Rapor tüm uygulamanın hatasızlık sertifikası değildir.
