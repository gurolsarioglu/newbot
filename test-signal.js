const axios = require('axios');

const RATIO_THRESHOLD = 55;

async function getTraderPositioningAndExposure(symbol, period = '15m') {
    try {
        const [accRes, posRes] = await Promise.all([
            axios.get('https://fapi.binance.com/futures/data/topLongShortAccountRatio', {
                params: { symbol, period, limit: 1 },
                timeout: 3500
            }).catch(() => ({ data: [] })),
            axios.get('https://fapi.binance.com/futures/data/topLongShortPositionRatio', {
                params: { symbol, period, limit: 1 },
                timeout: 3500
            }).catch(() => ({ data: [] }))
        ]);

        const formatRatio = (dataList) => {
            if (!dataList || !Array.isArray(dataList) || dataList.length === 0) return 'Bilinmiyor';
            const item = dataList[0];
            const longPct = parseFloat(item.longAccount) * 100;
            const shortPct = parseFloat(item.shortAccount) * 100;

            if (isNaN(longPct) || isNaN(shortPct)) return 'Bilinmiyor';

            if (longPct >= shortPct) {
                const emoji = longPct >= RATIO_THRESHOLD ? '🟢' : '⚪';
                return `${longPct.toFixed(2)}% ${emoji}`;
            } else {
                const emoji = shortPct >= RATIO_THRESHOLD ? '🔴' : '⚪';
                return `${shortPct.toFixed(2)}% ${emoji}`;
            }
        };

        return {
            traderPositioning: formatRatio(accRes.data),
            marketExposure: formatRatio(posRes.data)
        };
    } catch (e) {
        return {
            traderPositioning: 'Bilinmiyor',
            marketExposure: 'Bilinmiyor'
        };
    }
}

async function testDemo() {
    const symbol = process.argv[2] ? process.argv[2].toUpperCase() : 'BTCUSDT';
    console.log(`\n======================================================`);
    console.log(`🧪 TEST MODU: #${symbol} İçin Canlı Veri Çekiliyor...`);
    console.log(`======================================================\n`);

    // 15dk verilerini çek
    const m15 = await getTraderPositioningAndExposure(symbol, '15m');
    const h4 = await getTraderPositioningAndExposure(symbol, '4h');

    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    console.log(`📢 [1] 15dk Hunter Örnek Sinyal Çıktısı:`);
    console.log(`------------------------------------------------------`);
    console.log(
`📈 [15DK] #${symbol} BUY 🟢
──────────────────
• Fiyat: 68450.0000
• 15dk RSI: 19 ⭐ (Sinyal)
• 1 Saatlik RSI: 28
• 4 Saatlik RSI: 34
• Günlük RSI: 42
• Stoch: 12(K)/10(D)
• Hacim: 🔥 YÜKSEK HACİM
• Trader Positioning: ${m15.traderPositioning}
• Market Exposure: ${m15.marketExposure}
──────────────────
🔗 Binance Futures | ⏰ ${now}`
    );

    console.log(`\n📢 [2] 4Spro Hunter Örnek Sinyal Çıktısı:`);
    console.log(`------------------------------------------------------`);
    console.log(
`📉 [4S] #${symbol} SELL 🔴
──────────────────
Strategy: 4H RSI SMA CROSSED
Boost Value: +4.12%
Current Price: 68450.0000
Previous Price: 69200.0000
──────────────────
• Fiyat: 68450.0000
• 4 Saatlik RSI: 78 ⭐⭐ (RSI: 78 > SMA: 64) (Sinyal)
• 1 Saatlik RSI: 72 🔴❗ (Negatif Uyumsuzluk | 11:00 - 10 Eyl)
• Günlük RSI: 68
• Stoch: 84(K)/81(D)
• Hacim: 🔥 YÜKSEK HACİM
• Trader Positioning: ${h4.traderPositioning}
• Market Exposure: ${h4.marketExposure}
──────────────────
🔗 Binance Futures | ⏰ ${now}`
    );
    console.log(`\n✅ Canlı test tamamlandı.\n`);
}

testDemo();
