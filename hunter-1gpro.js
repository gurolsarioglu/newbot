const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');
const technicalService = require('../backend/services/technical.service');

// Load config
dotenv.config({ path: path.join(__dirname, '.env') });

// Optional Telegram Bot Setup
let bot = null;
let chatIds = new Set();
const subscribersPath = path.join(__dirname, 'subscribers.json');

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (TELEGRAM_TOKEN && TELEGRAM_TOKEN !== 'your_telegram_bot_token_here' && TELEGRAM_TOKEN.trim() !== '') {
    try {
        const TelegramBot = require('node-telegram-bot-api');
        bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

        if (fs.existsSync(subscribersPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(subscribersPath, 'utf8'));
                chatIds = new Set(data);
                console.log(`📂 [1Gpro Telegram] ${chatIds.size} abone yüklendi.`);
            } catch (e) { }
        }

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            if (!chatIds.has(chatId)) {
                chatIds.add(chatId);
                try {
                    fs.writeFileSync(subscribersPath, JSON.stringify(Array.from(chatIds)), 'utf8');
                } catch (e) { }
                console.log(`✅ [1Gpro] Yeni Telegram Abonesi: ${chatId}`);
            }
            bot.sendMessage(chatId, "🚀 *1Gpro (Günlük Hunter & Multi-Timeframe Uyumsuzluk Botu) Aktif!* \nGünlük aşırı RSI ve 1H/4H/1W uyumsuzluk sinyalleri burada paylaşılacaktır.", { parse_mode: 'Markdown' });
        });

        console.log('🤖 [1Gpro] Telegram Bot entegrasyonu aktif.');
    } catch (err) {
        console.warn('⚠️ [1Gpro] Telegram başlatılamadı:', err.message);
    }
} else {
    console.log('ℹ️ [1Gpro] Telegram token henüz eklenmedi. Sinyaller Konsola ve Dashboard API\'ye aktarılıyor.');
}

const processedSignals = new Map();
const COOLDOWN_PERIOD = 6 * 60 * 60 * 1000; // 6 hours cooldown for 1D signals
const TIMEFRAME = '1d';

console.log('⚡ CoinKe V2.0 (1Gpro - Günlük Hunter & RSI Uyumsuzluk Analizörü) Başlatıldı!');

/**
 * Fetch all active USDT Futures symbols
 */
async function getFuturesSymbols() {
    try {
        const res = await axios.get('https://fapi.binance.com/fapi/v1/exchangeInfo');
        return res.data.symbols
            .filter(s => s.quoteAsset === 'USDT' && s.status === 'TRADING' && s.contractType === 'PERPETUAL')
            .map(s => s.symbol);
    } catch (e) {
        console.error('Sembol listesi alınamadı:', e.message);
        return [];
    }
}

async function performScan() {
    try {
        console.log(`🔍 [${new Date().toLocaleTimeString()}] 1Gpro Futures Taraması Başlıyor...`);
        const symbols = await getFuturesSymbols();
        console.log(`📈 Toplam ${symbols.length} aktif Futures çifti taranacak.`);

        for (const symbol of symbols) {
            await checkCoin(symbol);
            await new Promise(r => setTimeout(r, 60)); // API rate limit koruması
        }
        console.log(`✅ [${new Date().toLocaleTimeString()}] 1Gpro Taraması Tamamlandı.`);
    } catch (e) {
        console.error('Tarama Hatası:', e.message);
    }
}

// ==================== DIVERGENCE & SWING HELPERS ====================

function findSwingLows(klines, lookback = 2) {
    const swings = [];
    for (let i = lookback; i < klines.length - lookback; i++) {
        let isSwing = true;
        for (let j = 1; j <= lookback; j++) {
            if (klines[i].low > klines[i - j].low || klines[i].low > klines[i + j].low) {
                isSwing = false;
                break;
            }
        }
        if (isSwing) {
            swings.push({ index: i, price: klines[i].low, openTime: klines[i].openTime });
        }
    }
    return swings;
}

function findSwingHighs(klines, lookback = 2) {
    const swings = [];
    for (let i = lookback; i < klines.length - lookback; i++) {
        let isSwing = true;
        for (let j = 1; j <= lookback; j++) {
            if (klines[i].high < klines[i - j].high || klines[i].high < klines[i + j].high) {
                isSwing = false;
                break;
            }
        }
        if (isSwing) {
            swings.push({ index: i, price: klines[i].high, openTime: klines[i].openTime });
        }
    }
    return swings;
}

function formatTime1h(timestamp) {
    const d = new Date(timestamp);
    const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const date = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
    return `${time} - ${date}`;
}

function formatTime4h(timestamp) {
    const d = new Date(timestamp);
    const time = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const day = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'long' });
    return `${time} - ${day}`;
}

function formatTime1w(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function detectDivergence(klines, rsiArr, interval) {
    if (!klines || klines.length < 20 || !rsiArr || rsiArr.length < 20) return null;

    const lookback = interval === '1w' ? 1 : 2;
    const recentCount = Math.min(50, klines.length);
    const sliceKlines = klines.slice(-recentCount);
    const sliceRsi = rsiArr.slice(-recentCount);

    // 1. Pozitif (Boğa) Uyumsuzluk Kontrolü: Fiyat daha düşük dip, RSI daha yüksek dip
    const swingLows = findSwingLows(sliceKlines, lookback);
    if (swingLows.length >= 2) {
        for (let i = swingLows.length - 2; i >= 0; i--) {
            const prev = swingLows[i];
            const last = swingLows[swingLows.length - 1];

            if (last.index <= prev.index) continue;
            if (sliceKlines.length - 1 - last.index > 10) continue;

            const prevRsi = sliceRsi[prev.index];
            const lastRsi = sliceRsi[last.index];

            if (last.price <= prev.price * 1.01 && lastRsi > prevRsi + 0.8 && lastRsi <= 58) {
                let timeStr = '';
                if (interval === '1h') timeStr = formatTime1h(prev.openTime);
                else if (interval === '4h') timeStr = formatTime4h(prev.openTime);
                else if (interval === '1w') timeStr = formatTime1w(prev.openTime);
                else timeStr = new Date(prev.openTime).toLocaleDateString('tr-TR');

                return {
                    type: 'BULLISH',
                    badge: `🟢❗ (Pozitif Uyumsuzluk | ${timeStr})`,
                    timeStr
                };
            }
        }
    }

    // 2. Negatif (Ayı) Uyumsuzluk Kontrolü: Fiyat daha yüksek tepe, RSI daha düşük tepe
    const swingHighs = findSwingHighs(sliceKlines, lookback);
    if (swingHighs.length >= 2) {
        for (let i = swingHighs.length - 2; i >= 0; i--) {
            const prev = swingHighs[i];
            const last = swingHighs[swingHighs.length - 1];

            if (last.index <= prev.index) continue;
            if (sliceKlines.length - 1 - last.index > 10) continue;

            const prevRsi = sliceRsi[prev.index];
            const lastRsi = sliceRsi[last.index];

            if (last.price >= prev.price * 0.99 && lastRsi < prevRsi - 0.8 && lastRsi >= 42) {
                let timeStr = '';
                if (interval === '1h') timeStr = formatTime1h(prev.openTime);
                else if (interval === '4h') timeStr = formatTime4h(prev.openTime);
                else if (interval === '1w') timeStr = formatTime1w(prev.openTime);
                else timeStr = new Date(prev.openTime).toLocaleDateString('tr-TR');

                return {
                    type: 'BEARISH',
                    badge: `🔴❗ (Negatif Uyumsuzluk | ${timeStr})`,
                    timeStr
                };
            }
        }
    }

    return null;
}

async function analyzeTimeframe(symbol, interval) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`);
        const klines = res.data.map(k => ({
            openTime: k[0],
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            hlc3: (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3
        }));

        if (klines.length < 25) return { rsi: 'N/A', divergence: null, klines: [] };

        const rsiArr = technicalService.calculateFullRSI(klines, 14);
        const lastRsi = Math.round(rsiArr[rsiArr.length - 1]);
        const divergence = detectDivergence(klines, rsiArr, interval);

        return {
            rsi: lastRsi,
            divergence,
            klines
        };
    } catch (e) {
        return { rsi: 'N/A', divergence: null, klines: [] };
    }
}

// ==================== MAIN ANALYSIS ====================

async function checkCoin(symbol) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=100`);
        const klines = res.data.map(k => ({
            openTime: k[0],
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
        }));

        if (klines.length < 50) return false;

        const rsi = technicalService.calculateFullRSI(klines, 14);
        const stoch = technicalService.calculateFullStochRSI(klines, 14, 14, 3, 3);
        const adx = technicalService.calculateADX(klines, 14);

        const lastRsi = rsi[rsi.length - 1];
        const lastK = stoch.k[stoch.k.length - 1];
        const lastD = stoch.d[stoch.d.length - 1];
        const lastAdx = adx[adx.length - 1];

        const price = klines[klines.length - 1].close;
        const prev = klines[klines.length - 2].close;
        const rawBoost = Math.abs((price - prev) / prev * 100);
        const boost = `+${rawBoost.toFixed(2)}%`;

        let signalType = null;

        // SCALPER CRITERIA (Günlük Aşırı RSI Değerleri)
        if (lastRsi <= 20) signalType = 'Buy 🟢';
        else if (lastRsi >= 80) signalType = 'Sell 🔴';

        if (signalType) {
            const key = `${symbol}_${signalType}`;
            if (!processedSignals.has(key) || (Date.now() - processedSignals.get(key) > COOLDOWN_PERIOD)) {
                processedSignals.set(key, Date.now());

                const lastVol = klines[klines.length - 1].volume;
                const avgVol = klines.slice(-11, -1).reduce((s, k) => s + k.volume, 0) / 10;
                let volStatus = lastVol > (avgVol * 1.05) ? "🔥 YÜKSEK HACİM" : "Normal";
                let trendStatus = lastAdx > 25 ? "💪 Güçlü Trend" : "Zayıf Trend";

                // DEMA 9 & Yana Mum
                const closes = klines.map(k => k.close);
                const dema9 = calculateDEMA(closes, 9);
                const lastDema9 = dema9[dema9.length - 1];
                const lastCandle = klines[klines.length - 1];
                const prevCandle = klines[klines.length - 2];
                const isYanaMum = Math.abs(lastCandle.close - prevCandle.close) / prevCandle.close < 0.0008;
                const isNearDema = Math.abs(lastCandle.close - lastDema9) / lastDema9 < 0.0012;
                const demaAlert = isYanaMum && isNearDema;

                // 1H, 4H ve 1W periyotlarında RSI ve Uyumsuzluk Taraması
                const [analysis1h, analysis4h, analysis1w] = await Promise.all([
                    analyzeTimeframe(symbol, '1h'),
                    analyzeTimeframe(symbol, '4h'),
                    analyzeTimeframe(symbol, '1w')
                ]);

                const binanceService = require('../backend/services/binance.service');
                const supplyData = await binanceService.getSupplyData(symbol);
                let supplyStr = 'Bilinmiyor';
                if (supplyData) {
                    supplyStr = `%${supplyData.ratio}` + (supplyData.isMax ? ' !!!' : '');
                }

                await sendAlert(
                    symbol, signalType, boost, price, prev, lastRsi, lastK, lastD,
                    volStatus, trendStatus, demaAlert, analysis1h, analysis4h, analysis1w, supplyStr
                );
                return true;
            }
        }
    } catch (e) { return false; }
}

async function sendAlert(
    symbol, type, boost, price, prev, rsi, k, d, vol, trend, demaAlert,
    analysis1h, analysis4h, analysis1w, supplyStr = 'Bilinmiyor'
) {
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const binanceUrl = `https://www.binance.com/en/futures/${symbol}`;

    // RSI Yıldız Kuralları
    let rsiWarning = '';
    const roundedRsi = Math.round(rsi);
    if (type.includes('Buy')) {
        if (roundedRsi <= 17) rsiWarning = '⭐⭐';
        else if (roundedRsi <= 20) rsiWarning = '⭐';
    } else {
        if (roundedRsi >= 85) rsiWarning = '⭐⭐';
        else if (roundedRsi >= 80) rsiWarning = '⭐';
    }

    const cleanSymbol = symbol.replace(/[^\x00-\x7F]/g, '');

    // Periyot satırları
    let rsi1hLine = `• *1 Saatlik RSI:* ${analysis1h.rsi}`;
    if (analysis1h.divergence) {
        rsi1hLine += ` ${analysis1h.divergence.badge}`;
    }

    let rsi4hLine = `• *4 Saatlik RSI:* ${analysis4h.rsi}`;
    if (analysis4h.divergence) {
        rsi4hLine += ` ${analysis4h.divergence.badge}`;
    }

    let rsi1wLine = '';
    if (analysis1w && analysis1w.rsi !== 'N/A' && analysis1w.rsi !== null) {
        rsi1wLine = `• *Haftalık RSI:* ${analysis1w.rsi}`;
        if (analysis1w.divergence) {
            rsi1wLine += ` ${analysis1w.divergence.badge}`;
        }
        rsi1wLine += '\n';
    }

    const message = `${type.includes('Buy') ? '📈' : '📉'} *[1Gpro] #${cleanSymbol} ${type.toUpperCase()}*\n` +
        `──────────────────\n` +
        (demaAlert ? '🧘 *Yana Mum / DEMA Tespiti*\n' : '') +
        `• *Fiyat:* ${price.toFixed(4)}\n` +
        `• *Günlük RSI:* ${roundedRsi} ${rsiWarning} (Sinyal)\n` +
        `${rsi1hLine}\n` +
        `${rsi4hLine}\n` +
        (rsi1wLine ? `${rsi1wLine}` : '') +
        `• *Stoch:* ${Math.round(k)}(K)/${Math.round(d)}(D)\n` +
        `• *Hacim:* ${vol}\n` +
        `──────────────────\n` +
        `🔗 [Binance Futures](${binanceUrl}) | ⏰ ${now}`;

    console.log(`\n==============================================`);
    console.log(message.replace(/\*/g, ''));
    console.log(`==============================================\n`);

    // 1. Telegram Üzerinden Gönder (Eğer bot aktif ise)
    if (bot && chatIds.size > 0) {
        for (const id of chatIds) {
            try {
                await bot.sendMessage(id, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (tgErr) {
                console.error(`Telegram gönderim hatası (${id}):`, tgErr.message);
            }
        }
    }

    // 2. Local Web Dashboard REST API'ye Gönder
    try {
        const signalData = {
            timeframe: '1d',
            botType: '1Gpro',
            coin: symbol,
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            position: type.includes('Buy') ? 'Long' : 'Short',
            price,
            prevPrice: prev,
            boost: boost || `+${Math.abs((price - prev) / prev * 100).toFixed(2)}%`,
            rsi: Math.round(rsi),
            rsiWarning,
            rsi1h: analysis1h.rsi,
            rsi1hDiv: analysis1h.divergence ? analysis1h.divergence.badge : null,
            rsi4h: analysis4h.rsi,
            rsi4hDiv: analysis4h.divergence ? analysis4h.divergence.badge : null,
            rsi1w: analysis1w.rsi,
            rsi1wDiv: analysis1w.divergence ? analysis1w.divergence.badge : null,
            rsi1d: Math.round(rsi),
            stochK: Math.round(k),
            stochD: Math.round(d),
            volume: vol,
            trend,
            demaAlert,
            supplyStr
        };
        await axios.post('http://localhost:3000/api/signals/emit', signalData);
    } catch (err) {
        // Silently catch if dashboard is not running
    }
}

// Specific scalper helpers
function calculateEMA(data, period) {
    if (data.length === 0) return [];
    const k = 2 / (period + 1);
    let ema = [data[0]];
    for (let i = 1; i < data.length; i++) {
        ema.push(data[i] * k + ema[ema.length - 1] * (1 - k));
    }
    return ema;
}

function calculateDEMA(data, period) {
    if (data.length < period * 2) return new Array(data.length).fill(0);
    const ema1 = calculateEMA(data, period);
    const ema2 = calculateEMA(ema1, period);
    const dema = [];
    for (let i = 0; i < ema1.length; i++) {
        dema.push(2 * ema1[i] - ema2[i]);
    }
    return dema;
}

/**
 * Schedule scan: Run every hour
 */
function scheduleNextScan() {
    const intervalMs = 60 * 60 * 1000;
    console.log(`⏰ Bir sonraki 1Gpro taraması 1 saat sonra (${new Date(Date.now() + intervalMs).toLocaleTimeString()}) yapılacak.`);
    setTimeout(async () => {
        await performScan();
        scheduleNextScan();
    }, intervalMs);
}

async function init() {
    scheduleNextScan();
    await performScan();
}

init();
