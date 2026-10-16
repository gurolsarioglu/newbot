# Antigravity & Agent Çalışma Kuralları

## 🚀 Otonom İcraat (Autonomous Execution) Kuralı
1. **Ara Onay Sorma:** Kullanıcı bir görev verdiğinde veya "Yap", "Başla" dediğinde, ara adımlarda onay istemek için durma.
2. **Baştan Sona Tamamla:** Planlanan tüm adımları (kod yazımı, veri tabanı, API, ön yüz, test ve doğrulama) baştan sona eksiksiz uygula.
3. **Doğrula ve Teslim Et:** Kodları ve sistemi çalıştırıp doğrula, ardından yapılan tüm işleri ve sonuçları net bir raporla kullanıcıya teslim et.
4. **Deterministik ve Hassas:** Finansal verilerde (özellikle kripto fiyatlarında 0.004890 gibi mikro basamaklar) hiçbir zaman basamak kırpma veya yapay yuvarlama yapma; tick hassasiyetini koru.

## 📌 İş Bitişinde Otomatik Yapılacak 2 Zorunlu İşlem
Her çalışma/görev tamamlandığında kullanıcı hatırlatmak zorunda kalmadan otomatik olarak:
1. **`proje takip.md` Dosyasını Güncelle:**
   İçerisine o günün tarihi (örn: `# 07.10.2026`) başlığı açılarak:
   - **Yaptıklarımız:** Yapılan tüm teknik ve mimari değişiklikler
   - **Düşündüklerimiz:** Mimari kararlar, planlamalar ve teknik gerekçeler
   - **Konuşmalarımız ve Onaylananlar:** Kullanıcının talepleri, belirlenen ihtiyaçlar
   - **Tamamlanan İşler ve Doğrulama:** Biten işler ve test sonuçları
   Sonraki seanslarda yeni günün tarihi başlığıyla kronolojik devam edilir.
2. **GitHub Reposuna Otomatik Gönder:**
   `git add .`, standart açıklayıcı commit mesajıyla `git commit` ve ardından `git push` komutunu çalıştırarak değişiklikleri GitHub reposuna gönder.
