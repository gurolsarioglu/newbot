const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const technicalService = require('../backend/services/technical.service');

// Load config
dotenv.config({ path: path.join(__dirname, '.env') });

// Telegram Bot Setup
let bot = null;
let chatIds = new Set();
const subscribersPath = path.join(__dirname, 'subscribers_trend.json');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here' && TELEGRAM_TOKEN.trim() !== '') {
    try {
        const TelegramBot = require('node-telegram-bot-api');
        bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

        if (fs.existsSync(subscribersPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(subscribersPath, 'utf8'));
                chatIds = new Set(data);
                console.log(`📂 [DipBot] ${chatIds.size} abone yüklendi.`);
            } catch (e) { }
        }

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            if (!chatIds.has(chatId)) {
                chatIds.add(chatId);
                try {
                    fs.writeFileSync(subscribersPath, JSON.stringify(Array.from(chatIds)), 'utf8');
                } catch (e) { }
                console.log(`✅ [DipBot] Yeni Telegram Abonesi: ${chatId}`);
            }
            bot.sendMessage(chatId, "🚀 *Dip Avcısı (Reversal) Botu Aktif!* \n1G, 5G ve 1W periyotlarında düşüş sonrası Stoch RSI ve WaveTrend alım kesişimleri burada paylaşılacaktır.", { parse_mode: 'Markdown' });
        });

        console.log('🤖 [DipBot] Telegram Bot entegrasyonu aktif.');
    } catch (err) {
        console.warn('⚠️ [DipBot] Telegram başlatılamadı:', err.message);
    }
} else {
    console.log('ℹ️ [DipBot] Telegram token bulunamadı veya geçersiz.');
}

const processedSignals = new Map();
const COOLDOWN_PERIOD = 24 * 60 * 60 * 1000; // 24 hours cooldown for same signal

console.log('⚡ CoinKe V2.0 (Dip Avcısı - Bottom Reversal Bot) Başlatıldı!');

async function getFuturesSymbols() {
    try {
        const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        return res.data.symbols
            .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
            .map(s => s.symbol);
    } catch (e) {
        return [];
    }
}

async function fetchKlines(symbol, interval, limit = 100) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        return res.data.map(k => ({
            openTime: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            hlc3: (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3
        }));
    } catch (e) {
        return [];
    }
}

function build5DKlines(dailyKlines) {
    const klines5d = [];
    for (let i = 0; i < dailyKlines.length; i += 5) {
        if (i + 4 < dailyKlines.length) {
            const chunk = dailyKlines.slice(i, i + 5);
            const merged = technicalService.aggregateKlines(chunk, 5);
            if (merged) klines5d.push(merged);
        }
    }
    return klines5d;
}

// Yeni Dip Dönüş Mantığı
function analyzeDipReversal(klines) {
    if (klines.length < 35) return false;

    // Hedef mum: Kapanmış en son mum
    const targetIndex = klines.length - 2;
    const targetCandle = klines[targetIndex];
    const p1 = klines[targetIndex - 1];
    const p2 = klines[targetIndex - 2];
    const p3 = klines[targetIndex - 3];

    // 1. Düşüş Trendi (Prior Downtrend) Kontrolü
    let redCount = 0;
    if (p1.close < p1.open) redCount++;
    if (p2.close < p2.open) redCount++;
    if (p3.close < p3.open) redCount++;

    // En az 2 kırmızı mum olmalı ve fiyat genel olarak aşağı gitmiş olmalı
    if (redCount < 2 || p1.low >= p3.low) return false;

    // 2. Dönüş Mumu (Reversal Candle) Kontrolü
    // Ya yeşil mum olmalı ya da çekiç (hammer) görünümlü olmalı
    const body = targetCandle.close - targetCandle.open;
    const range = targetCandle.high - targetCandle.low;
    const isGreen = body > 0;
    
    // Alt fitil gövdenin 1.5 katından büyükse çekiçtir
    const lowerWick = Math.min(targetCandle.open, targetCandle.close) - targetCandle.low;
    const isHammer = range > 0 && lowerWick > Math.abs(body) * 1.5;

    if (!isGreen && !isHammer) return false;

    // 3. Stoch RSI Kontrolü (1-2 mum içinde veya şu an dipten kesmiş olmalı)
    const stochData = technicalService.calculateFullStochRSI(klines.slice(0, targetIndex + 1));
    const k = stochData.k;
    const d = stochData.d;
    const lastK = k[k.length - 1];
    const lastD = d[d.length - 1];
    const prevK = k[k.length - 2];
    const prevD = d[d.length - 2];
    const prev2K = k[k.length - 3];
    const prev2D = d[d.length - 3];

    // Şu an K > D olmalı (Bullish) ve bu kesişim yakın zamanda dipte (<35) gerçekleşmiş olmalı
    const currentlyBullish = lastK >= lastD;
    const recentCross0 = prevK <= prevD && lastK > lastD && lastK < 35;
    const recentCross1 = prev2K <= prev2D && prevK > prevD && prevK < 35;

    if (!currentlyBullish || (!recentCross0 && !recentCross1)) return false;

    // 4. WaveTrend Kontrolü
    // Hedef mum, bir önceki mum ve iki önceki mum için WT hesapla
    const wtTarget = technicalService.calculateWaveTrend(klines.slice(0, targetIndex + 1));
    const wtPrev1 = technicalService.calculateWaveTrend(klines.slice(0, targetIndex));

    const wtCurrentlyBullish = wtTarget.wt1 >= wtTarget.wt2;
    // WaveTrend dip bölgesi < -40
    const wtRecentCross0 = wtTarget.cross === 'Bullish 🟢' && wtTarget.wt1 < -40;
    const wtRecentCross1 = wtPrev1.cross === 'Bullish 🟢' && wtPrev1.wt1 < -40;

    if (!wtCurrentlyBullish || (!wtRecentCross0 && !wtRecentCross1)) return false;

    // Tüm şartlar sağlandı!
    return true;
}

async function analyzeSymbol(symbol) {
    try {
        const klines1d = await fetchKlines(symbol, '1d', 100);
        const klines1w = await fetchKlines(symbol, '1w', 100);
        const klines5d = build5DKlines(klines1d);
        
        const timeframes = [
            { name: '1G (Günlük)', klines: klines1d },
            { name: '5G (5 Günlük)', klines: klines5d },
            { name: '1W (Haftalık)', klines: klines1w }
        ];

        let signalsFound = [];

        for (const tf of timeframes) {
            if (analyzeDipReversal(tf.klines)) {
                signalsFound.push(tf.name);
            }
        }

        if (signalsFound.length > 0) {
            const key = `${symbol}_DIPREVERSAL`;
            if (!processedSignals.has(key) || (Date.now() - processedSignals.get(key) > COOLDOWN_PERIOD)) {
                processedSignals.set(key, Date.now());
                await sendTelegramAlert(symbol, signalsFound, klines1d[klines1d.length - 1].close);
            }
        }
    } catch (e) {
        // Silently fail
    }
}

async function sendTelegramAlert(symbol, timeframes, currentPrice) {
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const binanceUrl = `https://www.binance.com/en/futures/${symbol}`;
    const cleanSymbol = symbol.replace(/[^\x00-\x7F]/g, '');

    const message = `🚀 *[DİP AVCISI] #${cleanSymbol}*\n` +
        `──────────────────\n` +
        `🟢 *DİP DÖNÜŞ FORMASYONU*\n` +
        `📊 *Zaman Dilimi:* ${timeframes.join(', ')}\n` +
        `──────────────────\n` +
        `✅ *Kriterler Sağlandı:*\n` +
        `• 🩸 Geçmiş Düşüş Trendi (Kırmızı Mumlar)\n` +
        `• 🕯️ Dönüş Mumu (Yeşil veya Çekiç)\n` +
        `• 📈 Stoch RSI Dip Kesişimi (K > D)\n` +
        `• 🟢 WaveTrend Dip Kesişimi (WT1 > WT2)\n` +
        `──────────────────\n` +
        `💰 *Anlık Fiyat:* ${currentPrice.toFixed(4)}\n` +
        `🔗 [Binance Futures](${binanceUrl}) | ⏰ ${now}`;

    console.log(`\n==============================================`);
    console.log(message.replace(/\*/g, ''));
    console.log(`==============================================\n`);

    if (bot && chatIds.size > 0) {
        for (const id of chatIds) {
            try {
                await bot.sendMessage(id, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (tgErr) {}
        }
    }
}

async function performScan() {
    try {
        console.log(`\n🔍 [${new Date().toLocaleTimeString()}] Dip Avcısı (Bottom Reversal) Taraması Başlıyor...`);
        const symbols = await getFuturesSymbols();
        console.log(`📈 Toplam ${symbols.length} aktif Futures çifti taranacak.`);

        for (const symbol of symbols) {
            await analyzeSymbol(symbol);
            await new Promise(r => setTimeout(r, 100)); // API Rate Limit
        }
        console.log(`✅ [${new Date().toLocaleTimeString()}] Tarama Tamamlandı.`);
    } catch (e) {
        console.error('Tarama Hatası:', e.message);
    }
}

function scheduleNextScan() {
    const intervalMs = 4 * 60 * 60 * 1000; // 4 Hours
    console.log(`⏰ Bir sonraki tarama 4 saat sonra (${new Date(Date.now() + intervalMs).toLocaleTimeString()}) yapılacak.`);
    setTimeout(async () => {
        await performScan();
        scheduleNextScan();
    }, intervalMs);
}

async function init() {
    await performScan();
    scheduleNextScan();
}

init();
