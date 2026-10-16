const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const technicalService = require('../backend/services/technical.service');

// Load config
dotenv.config({ path: path.join(__dirname, '.env') });

const processedSignals = new Map();
const COOLDOWN_PERIOD = 45 * 60 * 1000; // Cooldown for 15m signals
const TIMEFRAME = '15m';

console.log('⚡ CoinKe V2.0 (15dk & Futures) Aktif! (NewBot - 15m Hunter)');

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
        console.log(`🔍 [${new Date().toLocaleTimeString()}] 15dk Futures Taraması Başlıyor...`);
        const symbols = await getFuturesSymbols();
        console.log(`📈 Toplam ${symbols.length} aktif Futures çifti taranacak.`);

        for (const symbol of symbols) {
            await checkCoin(symbol);
            await new Promise(r => setTimeout(r, 60)); // API limitlerini korumak için küçük bekleme
        }
        console.log(`✅ [${new Date().toLocaleTimeString()}] Tarama Tamamlandı.`);
    } catch (e) {
        console.error('Tarama Hatası:', e.message);
    }
}

async function checkCoin(symbol) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${TIMEFRAME}&limit=100`);
        const klines = res.data.map(k => ({
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
        const boost = ((price - prev) / prev * 100).toFixed(2);

        let signalType = null;

        // SCALPER CRITERIA (Focused ONLY on Extreme RSI Values)
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

                // Multi-Timeframe detaylı analiz
                const detail4h = await getMTFDetail(symbol, '4h');
                const detail1d = await getMTFDetail(symbol, '1d');

                const rsi1h = await getMTFRSI(symbol, '1h');
                const rsi4h = detail4h ? detail4h.rsi : 'N/A';
                const rsi1d = detail1d ? detail1d.rsi : 'N/A';

                const swingComment = generateSwingComment(signalType, detail4h, detail1d);

                const binanceService = require('../backend/services/binance.service');
                const supplyData = await binanceService.getSupplyData(symbol);
                let supplyStr = 'Bilinmiyor';
                if (supplyData) {
                    supplyStr = `%${supplyData.ratio}` + (supplyData.isMax ? ' !!!' : '');
                }

                // Top Trader Positioning & Market Exposure (15m)
                const topTraderData = await getTraderPositioningAndExposure(symbol, '15m');

                await sendAlert(
                    symbol, signalType, boost, price, prev, lastRsi, lastK, lastD,
                    volStatus, trendStatus, demaAlert, rsi1h, rsi4h, rsi1d,
                    swingComment, supplyStr, topTraderData.traderPositioning, topTraderData.marketExposure
                );
                return true;
            }
        }
    } catch (e) { return false; }
}

async function getMTFRSI(symbol, interval) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`);
        const klines = res.data.map(k => ({ close: parseFloat(k[4]) }));
        if (klines.length < 50) return null;
        const rsi = technicalService.calculateFullRSI(klines, 14);
        return Math.round(rsi[rsi.length - 1]);
    } catch (e) { return 'N/A'; }
}

/**
 * Bir zaman dilimi için tam gösterge detayı döner (swing analizi için)
 */
async function getMTFDetail(symbol, interval) {
    try {
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=100`);
        const klines = res.data.map(k => ({
            high:   parseFloat(k[2]),
            low:    parseFloat(k[3]),
            close:  parseFloat(k[4]),
            hlc3:   (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3
        }));
        if (klines.length < 50) return null;

        const rsiArr   = technicalService.calculateFullRSI(klines, 14);
        const stoch    = technicalService.calculateFullStochRSI(klines, 14, 14, 3, 3);
        const wt       = technicalService.calculateWaveTrend(klines);

        const lastRsi  = rsiArr[rsiArr.length - 1];
        const prevRsi1 = rsiArr[rsiArr.length - 2];
        const prevRsi2 = rsiArr[rsiArr.length - 3];

        // RSI yönü (son 2 mum eğimi)
        const rsiSlope = lastRsi - prevRsi1;
        const rsiDir   = rsiSlope > 1 ? '↑' : rsiSlope < -1 ? '↓' : '→';

        // Kaç mumdur OB (>70) veya OS (<30) bölgesinde
        let periodsOB = 0;
        for (let i = rsiArr.length - 1; i >= 0; i--) {
            if (lastRsi >= 70 && rsiArr[i] >= 70) periodsOB++;
            else if (lastRsi <= 30 && rsiArr[i] <= 30) periodsOB++;
            else break;
        }

        const lastK = stoch.k[stoch.k.length - 1];
        const lastD = stoch.d[stoch.d.length - 1];
        const stochColor = lastK < lastD ? 'kırmızı' : 'yeşil';

        // StochRSI yeni kırmızıya döndü mü? (önceki mum yeşildi, şimdi kırmızı)
        const prevK = stoch.k[stoch.k.length - 2];
        const prevD = stoch.d[stoch.d.length - 2];
        const stochJustFlipped = (prevK >= prevD && lastK < lastD) || (prevK <= prevD && lastK > lastD);

        return {
            rsi:             Math.round(lastRsi),
            rsiDir,
            periodsOB,
            stochK:          Math.round(lastK),
            stochD:          Math.round(lastD),
            stochColor,
            stochJustFlipped,
            wtLevel:         Math.round(wt.wt1),
            wtCross:         wt.cross  // 'Yükseliş 🟢' | 'Düşüş 🔴' | null
        };
    } catch (e) { return null; }
}

/**
 * 4h ve 1d detaylarından Türkçe swing yorumu üretir
 */
function generateSwingComment(signalType, d4h, d1d) {
    if (!d4h && !d1d) return null;
    const isShort = signalType.toLowerCase().includes('sell');
    const lines   = [];

    // ─── 4H satırı ───
    if (d4h) {
        const stochEmoji4h = d4h.stochColor === 'kırmızı' ? '🔴' : '🟢';
        const wtStr4h      = d4h.wtCross ? ` | WT ${d4h.wtLevel} (${d4h.wtCross.includes('Düşüş') ? 'cross kırmızı' : 'cross yeşil'})` : ` | WT ${d4h.wtLevel}`;
        let line4h         = `📊 4H: RSI ${d4h.rsi}${d4h.rsiDir} | SRSI ${stochEmoji4h} (K:${d4h.stochK}/D:${d4h.stochD})${wtStr4h}`;
        if (d4h.stochJustFlipped) line4h += d4h.stochColor === 'kırmızı' ? ' ⚡kırmızıya döndü' : ' ⚡yeşile döndü';
        lines.push(line4h);
    }

    // ─── 1D satırı ───
    if (d1d) {
        const stochEmoji1d = d1d.stochColor === 'kırmızı' ? '🔴' : '🟢';
        const obStr        = d1d.periodsOB >= 2 ? ` (${d1d.periodsOB} muddur)` : '';
        const obLabel      = (isShort && d1d.rsi >= 70) ? ` OB${obStr}` : (!isShort && d1d.rsi <= 30) ? ` OS${obStr}` : '';
        const wtStr1d      = d1d.wtCross ? ` | WT ${d1d.wtLevel} (${d1d.wtCross.includes('Düşüş') ? 'cross kırmızı' : 'cross yeşil'})` : ` | WT ${d1d.wtLevel}`;
        let line1d         = `📅 1D: RSI ${d1d.rsi}${d1d.rsiDir}${obLabel} | SRSI ${stochEmoji1d} (K:${d1d.stochK}/D:${d1d.stochD})${wtStr1d}`;
        if (d1d.stochJustFlipped) line1d += d1d.stochColor === 'kırmızı' ? ' ⚡kırmızıya döndü' : ' ⚡yeşile döndü';
        lines.push(line1d);
    }

    // ─── Genel değerlendirme ───
    const strongSignals = [];
    if (isShort) {
        if (d1d && d1d.rsi >= 75 && d1d.rsiDir === '↓')     strongSignals.push('1D RSI aşağı kıvrılıyor');
        if (d1d && d1d.stochColor === 'kırmızı')             strongSignals.push('1D SRSI kırmızı');
        if (d1d && d1d.periodsOB >= 3)                       strongSignals.push(`1D ${d1d.periodsOB} muddur OB bölgesinde`);
        if (d4h && d4h.rsiDir === '↓' && d4h.rsi >= 55)      strongSignals.push('4H momentum kırılıyor');
        if (d4h && d4h.wtCross && d4h.wtCross.includes('Düşüş')) strongSignals.push('4H WT kırmızı cross');
        if (d1d && d1d.wtCross && d1d.wtCross.includes('Düşüş')) strongSignals.push('1D WT kırmızı cross');
    } else {
        if (d1d && d1d.rsi <= 25 && d1d.rsiDir === '↑')     strongSignals.push('1D RSI yukarı kıvrılıyor');
        if (d1d && d1d.stochColor === 'yeşil')               strongSignals.push('1D SRSI yeşil');
        if (d1d && d1d.periodsOB >= 3)                       strongSignals.push(`1D ${d1d.periodsOB} muddur OS bölgesinde`);
        if (d4h && d4h.rsiDir === '↑' && d4h.rsi <= 45)      strongSignals.push('4H momentum dönüyor');
        if (d4h && d4h.wtCross && d4h.wtCross.includes('Yükseliş')) strongSignals.push('4H WT yeşil cross');
        if (d1d && d1d.wtCross && d1d.wtCross.includes('Yükseliş')) strongSignals.push('1D WT yeşil cross');
    }

    if (strongSignals.length >= 3) {
        lines.push(`⚠️ Güçlü ${isShort ? 'short' : 'long'}: ${strongSignals.join(' + ')}`);
    } else if (strongSignals.length >= 1) {
        lines.push(`💡 ${strongSignals.join(' + ')}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
}

const RATIO_THRESHOLD = 55; // Eşik: %55 ve üzeri yönlü (🟢/🔴), %50-%54.99 arası nötr (⚪)

/**
 * Binance Futures Top Trader Long/Short Account & Position oranlarını çeker
 */
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

async function sendAlert(
    symbol, type, boost, price, prev, rsi, k, d, vol, trend, demaAlert,
    rsi1h, rsi4h, rsi1d, swingComment = null, supplyStr = 'Bilinmiyor',
    traderPositioning = 'Bilinmiyor', marketExposure = 'Bilinmiyor'
) {
    const now = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const binanceUrl = `https://www.binance.com/en/futures/${symbol}`;

    // RSI Star & Exclamation Rules
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

    const message = `${type.includes('Buy') ? '📈' : '📉'} *[15DK] #${cleanSymbol} ${type.toUpperCase()}*\n` +
        `──────────────────\n` +
        (demaAlert ? '🧘 *Yana Mum / DEMA Tespiti*\n' : '') +
        `• *Fiyat:* ${price.toFixed(4)}\n` +
        `• *15dk RSI:* ${roundedRsi} ${rsiWarning} (Sinyal)\n` +
        `• *1 Saatlik RSI:* ${rsi1h}\n` +
        `• *4 Saatlik RSI:* ${rsi4h}\n` +
        `• *Günlük RSI:* ${rsi1d}\n` +
        `• *Stoch:* ${Math.round(k)}(K)/${Math.round(d)}(D)\n` +
        `• *Hacim:* ${vol}\n` +
        `• *Trader Positioning:* ${traderPositioning}\n` +
        `• *Market Exposure:* ${marketExposure}\n` +
        `──────────────────\n` +
        `🔗 [Binance Futures](${binanceUrl}) | ⏰ ${now}`;

    console.log(`\n==============================================`);
    console.log(message.replace(/\*/g, ''));
    console.log(`==============================================\n`);

    // Broadcast to Local Web Dashboard via REST API
    try {
        const signalData = {
            timeframe: '15m',
            botType: '15m',
            coin: symbol,
            date: new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' }),
            time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
            position: type.includes('Buy') ? 'Long' : 'Short',
            price,
            prevPrice: prev,
            boost: `+${Math.abs(parseFloat(boost || 0)).toFixed(2)}%`,
            rsi: Math.round(rsi),
            rsiWarning,
            rsi1h,
            rsi4h,
            rsi1d,
            stochK: Math.round(k),
            stochD: Math.round(d),
            volume: vol,
            trend,
            demaAlert,
            swingComment,
            supplyStr,
            traderPositioning,
            marketExposure
        };
        await axios.post('http://localhost:3000/api/signals/emit', signalData);
    } catch (err) {
        // Silently catch if dashboard is not currently running
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
 * Schedule scan to run exactly at the beginning of every 15-minute candle
 */
function scheduleNextScan() {
    const now = Date.now();
    const intervalMs = 15 * 60 * 1000;
    const nextScan = Math.ceil(now / intervalMs) * intervalMs;
    // Delay slightly (5s) after the candle opens to ensure exchange data is ready
    const delay = nextScan - now + 5000;

    console.log(`⏰ Bir sonraki 15dk tarama ${new Date(nextScan).toLocaleTimeString()} saatinde yapılacak.`);
    setTimeout(async () => {
        await performScan();
        scheduleNextScan();
    }, delay);
}

async function init() {
    scheduleNextScan();
    await performScan();
}

init();
