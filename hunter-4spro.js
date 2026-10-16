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
                console.log(`📂 [4Spro Telegram] ${chatIds.size} abone yüklendi.`);
            } catch (e) { }
        }

        bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            if (!chatIds.has(chatId)) {
                chatIds.add(chatId);
                try {
                    fs.writeFileSync(subscribersPath, JSON.stringify(Array.from(chatIds)), 'utf8');
                } catch (e) { }
                console.log(`✅ [4Spro] Yeni Telegram Abonesi: ${chatId}`);
            }
            bot.sendMessage(chatId, "🚀 *4Spro (4 Saatlik Hunter & RSI SMA Cross & MTF Uyumsuzluk Botu) Aktif!* \n4 Saatlik RSI SMA kesişimleri ve 1H/1D/1W uyumsuzluk sinyalleri burada paylaşılacaktır.", { parse_mode: 'Markdown' });
        });

        console.log('🤖 [4Spro] Telegram Bot entegrasyonu aktif.');
    } catch (err) {
        console.warn('⚠️ [4Spro] Telegram başlatılamadı:', err.message);
    }
} else {
    console.log('ℹ️ [4Spro] Telegram token henüz eklenmedi. Sinyaller Konsola ve Dashboard API\'ye aktarılıyor.');
}

const processedSignals = new Map();
const COOLDOWN_PERIOD = 4 * 60 * 60 * 1000; // 4 hours cooldown for 4H signals
const TIMEFRAME = '4h';

console.log('⚡ CoinKe V2.0 (4Spro - 4 Saatlik RSI SMA Cross & Multi-Timeframe Hunter) Başlatıldı!');

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
        console.log(`🔍 [${new Date().toLocaleTimeString()}] 4Spro (4 Saatlik) Futures Taraması Başlıyor...`);
        const symbols = await getFuturesSymbols();
        console.log(`📈 Toplam ${symbols.length} aktif Futures çifti taranacak.`);

        for (const symbol of symbols) {
            await checkCoin(symbol);
            await new Promise(r => setTimeout(r, 60)); // API limitlerini korumak için küçük bekleme
        }
        console.log(`✅ [${new Date().toLocaleTimeString()}] 4Spro Taraması Tamamlandı.`);
    } catch (e) {
        console.error('Tarama Hatası:', e.message);
    }
}

// ==================== HELPER FUNCTIONS ====================

function calculateSMA(data, period = 14) {
    const sma = [];
    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            sma.push(null);
        } else {
            const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
            sma.push(sum / period);
        }
    }
    return sma;
}

function formatPrice(p) {
    if (typeof p !== 'number') p = parseFloat(p);
    if (isNaN(p)) return '0.00';
    if (p >= 1) return p.toFixed(4);
    if (p >= 0.01) return p.toFixed(6);
    return p.toFixed(8);
}

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

function formatTime1d(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function formatTime1w(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function detectDivergence(klines, rsiArr, interval) {
    if (!klines || klines.length < 20 || !rsiArr || rsiArr.length < 20) return null;

    const lookback = (interval === '1w' || interval === '1d') ? 1 : 2;
    const recentCount = Math.min(50, klines.length);
    const sliceKlines = klines.slice(-recentCount);
    const sliceRsi = rsiArr.slice(-recentCount);

    // 1. Pozitif (Boğa) Uyumsuzluk: Fiyat daha düşük dip, RSI daha yüksek dip
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
                else if (interval === '1d') timeStr = formatTime1d(prev.openTime);
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

    // 2. Negatif (Ayı) Uyumsuzluk: Fiyat daha yüksek tepe, RSI daha düşük tepe
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
                else if (interval === '1d') timeStr = formatTime1d(prev.openTime);
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

        if (klines.length < 25) return { rsi: 'N/A', divergence: null };

        const rsiArr = technicalService.calculateFullRSI(klines, 14);
        const lastRsi = Math.round(rsiArr[rsiArr.length - 1]);
        const divergence = detectDivergence(klines, rsiArr, interval);

        return {
            rsi: lastRsi,
            divergence
        };
    } catch (e) {
        return { rsi: 'N/A', divergence: null };
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

        const rsiArr = technicalService.calculateFullRSI(klines, 14);
        const rsiSmaArr = calculateSMA(rsiArr, 14);
        const stoch = technicalService.calculateFullStochRSI(klines, 14, 14, 3, 3);
        const adx = technicalService.calculateADX(klines, 14);

        const lastRsi = rsiArr[rsiArr.length - 1];
        const prevRsi = rsiArr[rsiArr.length - 2];
        const lastSma = rsiSmaArr[rsiSmaArr.length - 1];
        const prevSma = rsiSmaArr[rsiSmaArr.length - 2];

        const lastK = stoch.k[stoch.k.length - 1];
        const lastD = stoch.d[stoch.d.length - 1];
        const lastAdx = adx[adx.length - 1];

        const price = klines[klines.length - 1].close;
        const prev = klines[klines.length - 2].close;

        // Boost Value hesaplaması: Mutlak değer ile her zaman pozitif (+)
        const rawBoost = Math.abs((price - prev) / prev * 100);
        const boost = `+${rawBoost.toFixed(2)}%`;

        // 4H RSI SMA Kesişimleri
        const isBullCross = prevSma !== null && lastSma !== null && prevRsi <= prevSma && lastRsi > lastSma;
        const isBearCross = prevSma !== null && lastSma !== null && prevRsi >= prevSma && lastRsi < lastSma;

        let signalType = null;

        if (isBullCross || lastRsi <= 25) {
            signalType = 'Buy 🟢';
        } else if (isBearCross || lastRsi >= 75) {
            signalType = 'Sell 🔴';
        }

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

                // 1H, 1D ve 1W periyotlarında RSI ve Uyumsuzluk Taraması
                const [analysis1h, analysis1d, analysis1w] = await Promise.all([
                    analyzeTimeframe(symbol, '1h'),
                    analyzeTimeframe(symbol, '1d'),
                    analyzeTimeframe(symbol, '1w')
                ]);

                const binanceService = require('../backend/services/binance.service');
                const supplyData = await binanceService.getSupplyData(symbol);
                let supplyStr = 'Bilinmiyor';
                if (supplyData) {
                    supplyStr = `%${supplyData.ratio}` + (supplyData.isMax ? ' !!!' : '');
                }

                // Top Trader Positioning & Market Exposure (4h)
                const topTraderData = await getTraderPositioningAndExposure(symbol, '4h');

                await sendAlert(
                    symbol, signalType, boost, price, prev, lastRsi, lastSma, lastK, lastD,
                    volStatus, trendStatus, demaAlert, analysis1h, analysis1d, analysis1w, supplyStr,
                    topTraderData.traderPositioning, topTraderData.marketExposure
                );
                return true;
            }
        }
    } catch (e) { return false; }
}

const RATIO_THRESHOLD = 55; // Eşik: %55 ve üzeri yönlü (🟢/🔴), %50-%54.99 arası nötr (⚪)

/**
 * Binance Futures Top Trader Long/Short Account & Position oranlarını çeker
 */
async function getTraderPositioningAndExposure(symbol, period = '4h') {
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

async function sendAlert(
    symbol, type, boost, price, prev, rsi, sma, k, d, vol, trend, demaAlert,
    analysis1h, analysis1d, analysis1w, supplyStr = 'Bilinmiyor',
    traderPositioning = 'Bilinmiyor', marketExposure = 'Bilinmiyor'
) {
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const binanceUrl = `https://www.binance.com/en/futures/${symbol}`;

    // RSI Yıldız Kuralları
    let rsiWarning = '';
    const roundedRsi = Math.round(rsi);
    const roundedSma = sma !== null ? Math.round(sma) : 'N/A';
    if (type.includes('Buy')) {
        if (roundedRsi <= 25) rsiWarning = '⭐⭐';
        else if (roundedRsi <= 35) rsiWarning = '⭐';
    } else {
        if (roundedRsi >= 75) rsiWarning = '⭐⭐';
        else if (roundedRsi >= 65) rsiWarning = '⭐';
    }

    const cleanSymbol = symbol.replace(/[^\x00-\x7F]/g, '');

    // Periyot satırları
    let rsi1hLine = `• *1 Saatlik RSI:* ${analysis1h.rsi}`;
    if (analysis1h.divergence) {
        rsi1hLine += ` ${analysis1h.divergence.badge}`;
    }

    let rsi1dLine = `• *Günlük RSI:* ${analysis1d.rsi}`;
    if (analysis1d.divergence) {
        rsi1dLine += ` ${analysis1d.divergence.badge}`;
    }

    let rsi1wLine = '';
    if (analysis1w && analysis1w.rsi !== 'N/A' && analysis1w.rsi !== null) {
        rsi1wLine = `• *Haftalık RSI:* ${analysis1w.rsi}`;
        if (analysis1w.divergence) {
            rsi1wLine += ` ${analysis1w.divergence.badge}`;
        }
        rsi1wLine += '\n';
    }

    const smaComparison = sma !== null ? `(RSI: ${roundedRsi} ${roundedRsi >= roundedSma ? '>' : '<'} SMA: ${roundedSma})` : '';

    const message = `${type.includes('Buy') ? '📈' : '📉'} *[4S] #${cleanSymbol} ${type.toUpperCase()}*\n` +
        `──────────────────\n` +
        `Strategy: 4H RSI SMA CROSSED\n` +
        `Boost Value: ${boost}\n` +
        `Current Price: ${formatPrice(price)}\n` +
        `Previous Price: ${formatPrice(prev)}\n` +
        `──────────────────\n` +
        (demaAlert ? '🧘 *Yana Mum / DEMA Tespiti*\n' : '') +
        `• *Fiyat:* ${formatPrice(price)}\n` +
        `• *4 Saatlik RSI:* ${roundedRsi} ${rsiWarning} ${smaComparison} (Sinyal)\n` +
        `${rsi1hLine}\n` +
        `${rsi1dLine}\n` +
        (rsi1wLine ? `${rsi1wLine}` : '') +
        `• *Stoch:* ${Math.round(k)}(K)/${Math.round(d)}(D)\n` +
        `• *Hacim:* ${vol}\n` +
        `• *Trader Positioning:* ${traderPositioning}\n` +
        `• *Market Exposure:* ${marketExposure}\n` +
        `──────────────────\n` +
        `🔗 [Binance Futures](${binanceUrl}) | ⏰ ${now}`;

    console.log(`\n==============================================`);
    console.log(message.replace(/\*/g, ''));
    console.log(`==============================================\n`);

    // 1. Telegram Gönderimi (Token eklenmişse)
    if (bot && chatIds.size > 0) {
        for (const id of chatIds) {
            try {
                await bot.sendMessage(id, message, { parse_mode: 'Markdown', disable_web_page_preview: true });
            } catch (tgErr) {
                console.error(`Telegram gönderim hatası (${id}):`, tgErr.message);
            }
        }
    }

    // 2. Local Web Dashboard REST API'ye Gönderim
    try {
        const signalData = {
            timeframe: '4h',
            botType: '4Spro',
            coin: symbol,
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            position: type.includes('Buy') ? 'Long' : 'Short',
            price,
            prevPrice: prev,
            boost,
            rsi: roundedRsi,
            rsiWarning,
            rsi4h: roundedRsi,
            rsiSma: roundedSma,
            rsi1h: analysis1h.rsi,
            rsi1hDiv: analysis1h.divergence ? analysis1h.divergence.badge : null,
            rsi1d: analysis1d.rsi,
            rsi1dDiv: analysis1d.divergence ? analysis1d.divergence.badge : null,
            rsi1w: analysis1w.rsi,
            rsi1wDiv: analysis1w.divergence ? analysis1w.divergence.badge : null,
            stochK: Math.round(k),
            stochD: Math.round(d),
            volume: vol,
            trend,
            demaAlert,
            supplyStr,
            traderPositioning,
            marketExposure
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
 * Schedule scan: Run every 30 minutes
 */
function scheduleNextScan() {
    const intervalMs = 30 * 60 * 1000;
    console.log(`⏰ Bir sonraki 4Spro taraması 30 dakika sonra (${new Date(Date.now() + intervalMs).toLocaleTimeString()}) yapılacak.`);
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
