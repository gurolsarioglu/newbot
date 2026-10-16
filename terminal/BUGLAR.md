# Bug Tracking — Alpha Terminal
## Genel Saglik Kontrolleri (28.09.2026)

| Kontrol | Sonuc |
|---|---|
| terminal-server.js syntax | OK |
| bot-hub.plugin.js syntax | OK |
| multi-chart.plugin.js syntax | OK |
| watchlist.plugin.js syntax | OK |
| sentiment-modal.plugin.js syntax | OK |
| /api/signals bot=hammerpro (4 sinyal) | OK |
| /api/signals bot=hammerproplus (6 sinyal) | OK |
| /api/signals bot=m1premium (4 sinyal) | OK |
| /api/signals bot=m1a (4 sinyal) | OK |
| /api/signals bot=fr (7 sinyal) | OK |
| /api/signals bot=div (6 sinyal) | OK |
| /api/signals bot=v3 (7 sinyal) | OK |
| /api/signals bot=4s (6 sinyal) | OK |
| /api/signals bot=4ssniper (6 sinyal) | OK |
| /api/watchlist (732 coin) | OK |

## Bulunan Hatalar ve Durumlari

| Kod | Sorun | Dosya | Durum |
|---|---|---|---|
| H-01 | Cift Hammer butonu | index.html | DUZELTILDI |
| H-02 | DIV butonu yanlis CSS sinifi | index.html | DUZELTILDI |
| H-03 | Sayfa acilisinda bot basligi yanlis | index.html | DUZELTILDI |
| H-05 | FR fundingRate null guvenlik | bot-hub.plugin.js | DUZELTILDI |
| H-06 | FR difference null guvenlik | bot-hub.plugin.js | DUZELTILDI |
| H-07 | Hammer Pro kart wt null guard | bot-hub.plugin.js | DUZELTILDI |
| H-10 | Title tag eski ad | index.html | DUZELTILDI |
| H-11 | 4S Sniper date divider tekrar | bot-hub.plugin.js | DUZELTILDI |
| H-12 | Hammer Pro Plus date divider | bot-hub.plugin.js | DUZELTILDI |
| H-14 | test_api.ps1 gereksiz dosya | terminal/ | SILINDI |
| H-15 | Botlarda eski tarihlerde donma (3 Agustos, 11 Temmuz) & hisse sembolleri (EWJ, GTLB, HOOD) | terminal-server.js | DUZELTILDI |
| H-16 | /api/signals/emit POST endpoint eksikligi | terminal-server.js | DUZELTILDI |
| H-17 | Canli arka plan sinyal tazeleyici motor eksikligi | terminal-server.js | DUZELTILDI |
| H-18 | Buton sayac rozetlerinin statik kalmasi (.bot-count-badge) | bot-hub.plugin.js | DUZELTILDI |
| H-19 | 4S kartlarinda hasToday divider hatasi | bot-hub.plugin.js | DUZELTILDI |
| H-20 | terminal-server.js icindeki 700+ satirlik monolitik bot yapisi | terminal/bots/ | DUZELTILDI (MVC MIKRO-MIMARI) |
| H-21 | hunter-15m.js ve hunter-1g.js sinyallerinde botType eksikligi nedeniyle terminalce yutulmasi | hunter-*.js & bots/index.js | DUZELTILDI |
| H-22 | hunter-4spro.js içinde prevPrice eksikligi (Current == Previous Price cikmasi) | hunter-4spro.js | DUZELTILDI |
| H-23 | Trader Positioning ve Market Exposure alanlarinda cift emoji (64.52% 🟢 🟢) cikmasi | bots/strategies & bot-hub | DUZELTILDI |
| H-24 | Uyumsuzluk (Divergence) sinyallerinin 4S sarti icine hapsolmasi | bots/index.js & divergence.bot.js | DUZELTILDI |
| H-26 | Hammer Pro Plus botunda parseFloat('+3.36%') hatası, ⭐⭐⭐ 3 yıldız algoritması eksikliği ve prevPrice eşitliği | hammer-pro-plus.bot.js | DUZELTILDI |
| H-27 | Hammer Pro (#W1) botunda ingest() sırasında ema200 ve pivot alanlarının unutulması, parseBoost eksikliği, whipsaw/düşen bıçak filtresi yokluğu | hammer-pro.bot.js | DUZELTILDI |
| H-28 | 4S Sniper (NW UP) botunda parseBoost/parseRatio eksikliği, aşırı alımdaki coinlere NW UP verilmesi ve balina satıcı kontrolü eksikliği | four-s-sniper.bot.js | DUZELTILDI |
| H-29 | 4S botunda bot-hub.plugin.js sabit yeşil emoji hatası, sahte pump (🔴) vs sağlıklı ralli (🟢) karar motoru yokluğu ve prevPrice eşitliği | four-s.bot.js & bot-hub.plugin.js | DUZELTILDI |
| H-30 | V3-A Hacim botunda bot-hub dateLabel eksikliği, parseVolumeChange yokluğu, negatif/sıradan hacim filtreleme ve 24s baz hacim format hatası | v3-volume.bot.js & bot-hub.plugin.js | DUZELTILDI |
| H-31 | Divergence (DIV) botunda parseBoost/parseDistance eksikliği, çift yönlü prevPrice tersliği (Short/Long) ve nötr RSI uyumsuzluk filtresi yokluğu | divergence.bot.js | DUZELTILDI |
| H-32 | FR (Funding Rate) botunda ters dot hatası (+ to - geçişine ezbere kırmızı basılması), dinamik geri sayım yokluğu ve fark formülü eksikliği | funding-rate.bot.js & bot-hub.plugin.js | DUZELTILDI |
| H-33 | M1-A botunda bot-hub dateLabel eksikliği, parseDropOrBoost eksikliği, çift yönlü prevPrice tersliği ve mikro-düşüş gürültü filtresi yokluğu | m1a-drop.bot.js & bot-hub.plugin.js | DUZELTILDI |
| H-34 | M1 Premium botunda parseBoost eksikliği, otomatik yıldız (⭐) derecelendirme algoritması yokluğu, prevPrice eşitliği ve dateLabel eksikliği | m1-premium.bot.js & bot-hub.plugin.js | DUZELTILDI |
| H-35 | Watchlist WebSocket akışının Spot (stream.binance.com) olması ve vadeli fiyat makası/eksik coin problemi | watchlist.plugin.js | DUZELTILDI (fstream.binance.com) |
| H-36 | Arama çubuğunda anlık canlı arama (input event) olmaması ve sadece Enter ile seçim yapılabilmesi | index.html & watchlist.plugin.js | DUZELTILDI |
| H-37 | İzleme listesinde 80 coinlik katı sınır nedeniyle arama yapmadan 740 coinin geri kalanının kaydırılamaması | watchlist.plugin.js | DUZELTILDI (Sonsuz Kaydırma / Scroll) |
| H-38 | 200 Günlük Geçmiş Mum ve Kantitatif Analiz Motoru (EMA200, ATH/ATL, Win Rate, Streak) | services/history.service.js & data/ | TAMAMLANDI |
| H-39 | 200 Günlük Analiz ve Arka Plan Senkronizasyon REST API Uç Noktaları (/api/favorites/analytics, /api/favorites/sync) | terminal-server.js | TAMAMLANDI |
| H-40 | İzleme Listesi ⭐ Favori (Yıldızlama) Sistemi ve LocalStorage Kalıcı Saklama | watchlist.plugin.js & terminal-pro.css | TAMAMLANDI |
| H-41 | Gelişmiş Filtre Sekmeleri (⭐ Favoriler, 📈 Yükselenler, 📉 Düşenler, 💰 Ekstrem FR, 📊 Hacim) | index.html & watchlist.plugin.js | TAMAMLANDI |
| H-42 | İnteraktif Çift Yönlü Sütun Başlığı Sıralaması (Symbol, Price, Chg, Vol, FR - Artan/Azalan) | watchlist.plugin.js & terminal-pro.css | TAMAMLANDI |
| H-43 | Ticker Snapshot Kokpiti 200 Günlük Kantitatif Rozet Paneli (EMA200, ATH/ATL, Win Rate, Streak) | index.html & terminal-pro.css & watchlist.plugin.js | TAMAMLANDI |
| H-44 | Çift Ekran (Dual Monitor) Desteği — Bağımsız, serbest boyutlandırılabilir (resizable) bot pencereleri | bot-window.html & bot-renderer.js | TAMAMLANDI |
| H-45 | Çift Ekran Çapraz Canlı Senkronizasyon (BroadcastChannel) — 2. ekrandaki karta tıklandığında 1. ekrandaki 4'lü grafik kokpitinin o coine kilitlenmesi | bot-renderer.js & bot-window.html & index.html | TAMAMLANDI |
| H-46 | 2. Ekran Bağımsız Bot Penceresinde Adres Çubuğunun (Omnibox URL Bar) Kaldırılması (popup=yes, location=no) ve Özel [✕] Kapat Butonu | bot-renderer.js & bot-window.html | TAMAMLANDI |
| H-47 | Chrome Standalone App Modu (`--app`) Entegrasyonu — Tarayıcının Beyaz Adres Çubuğunun (URL Bar / Omnibox) 100% Kaldırılması, PWA Manifest + Dark Theme-Color ve Çoklu Profil Destekli Bağımsız Masaüstü Penceresi | terminal-server.js & bot-renderer.js & manifest.json | TAMAMLANDI |
| H-48 | Asenkron `fetch` popup engelleme sorununun giderilmesi (Senkron `window.open` onarımı), Bot Penceresine `[ ⛶ Çerçevesiz ]` Butonu ve Masaüstü Başlatıcı (.bat) Kısayolları Entegrasyonu | bot-renderer.js & bot-window.html & Desktop/ | DUZELTILDI |

## Tüm 9 Bot, İzleme Listesi ve Çift Ekran (Dual Monitor) Geliştirmeleri Tamamlandı (05.10.2026):
1. 🔨 **Hammer Pro Plus** (`hammer-pro-plus.bot.js`) — Confluence motoru (⭐⭐⭐), #W1/#S1, gürültü filtresi: 100% OK.
2. 🔨 **Hammer Pro** (`hammer-pro.bot.js`) — EMA200/Pivot desteği, #W1 WaveTrend dip teyidi: 100% OK.
3. 🎯 **4S Sniper** (`four-s-sniper.bot.js`) — NW UP dip dönüşü, balina onay filtresi, ters prevPrice: 100% OK.
4. 🛡️ **4S** (`four-s.bot.js`) — Sahte pump (🔴) vs sağlıklı ralli (🟢) karar motoru, balina/perakende makası: 100% OK.
5. 📊 **V3-A** (`v3-volume.bot.js`) — Anlık hacim patlaması (+%8+), 24s hacim formatlayıcı, 🔥 rozeti: 100% OK.
6. 📐 **Divergence** (`divergence.bot.js`) — Pozitif (🟢) vs Negatif (🔴) uyumsuzluk motoru, çift yönlü prevPrice: 100% OK.
7. 💰 **FR** (`funding-rate.bot.js`) — Short Squeeze (+ to -) yeşil nokta düzeltmesi, dinamik UTC geri sayımı: 100% OK.
8. 🔴 **M1-A** (`m1a-drop.bot.js`) — Mikro düşüş (Drop <= -0.75%), Stokastik K/D, çift yönlü prevPrice: 100% OK.
9. ⚡ **M1 Premium** (`m1-premium.bot.js`) — Breakout momentumu, otomatik yıldız (⭐) motoru, 1m Divergence: 100% OK.
10. 📋 **İzleme Listesi (Watchlist)** (`watchlist.plugin.js`) — Binance Futures stream, canlı harf-harf arama, sonsuz kaydırma: 100% OK.
11. ⭐ **200 Günlük Quant Analiz Motoru & Favoriler** (`history.service.js` & `data/daily_history.json`) — EMA200, 200G Zirve/Dip, Kazanma Oranı, Gün Serisi, Çift Yönlü Sıralama: 100% OK.
12. 🖥️ **Çift Ekran & Bağımsız Pencereler (Dual Monitor Station)** (`bot-window.html` & `bot-renderer.js`) — 9 botun her biri için adres çubuğu gizlenmiş (`popup=yes`) serbest boyutlandırılabilir bağımsız pencereler + özel [✕] kapat butonu + 1. ekran ile canlı çift yönlü senkronizasyon: 100% OK.





