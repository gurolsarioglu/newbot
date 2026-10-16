const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const technicalService = require('../backend/services/technical.service');

// Load config
dotenv.config({ path: path.join(__dirname, '.env') });

const processedSignals = new Map();
const COOLDOWN_PERIOD = 6 * 60 * 60 * 1000; // 6 hours cooldown for 1D signals
const TIMEFRAME = '1d';

console.log('⚡ CoinKe V2.0 (1G / Günlük & Futures) Aktif! (NewBot - 1G Hunter)');

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
        console.log(`🔍 [${new Date().toLocaleTimeString()}] 1G (Günlük) Futures Taraması Başlıyor...`);
        const symbols = await getFuturesSymbols();
        console.log(`📈 Toplam ${symbols.length} aktif Futures çifti taranacak.`);

        for (const symbol of symbols) {
            await checkCoin(symbol);
            await new Promise(r => setTimeout(r, 60)); // API limitlerini korumak için küçük bekleme
        }
        console.log(`✅ [${new Date().toLocaleTimeString()}] 1G Tarama Tamamlandı.`);
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

                // Alt ve üst zaman dilimleri analizi (1H, 4H, 1W)
                const detail4h = await getMTFDetail(symbol, '4h');
                const detail1w = await getMTFDetail(symbol, '1w');

                const rsi1h = await getMTFRSI(symbol, '1h');
                const rsi4h = detail4h ? detail4h.rsi : await getMTFRSI(symbol, '4h');
                const rsi1w = detail1w ? detail1w.rsi : await getMTFRSI(symbol, '1w');

                const swingComment = generateSwingComment(signalType, detail4h, detail1w);

                const binanceService = require('../backend/services/binance.service');
                const supplyData = await binanceService.getSupplyData(symbol);
                let supplyStr = 'Bilinmiyor';
                if (supplyData) {
                    supplyStr = `%${supplyData.ratio}` + (supplyData.isMax ? ' !!!' : '');
                }

                await sendAlert(symbol, signalType, boost, price, prev, lastRsi, lastK, lastD, volStatus, trendStatus, demaAlert, rsi1h, rsi4h, rsi1w, swingComment, supplyStr);
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
 * Bir zaman dilimi için tam gösterge detayı döner
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
            wtCross:         wt.cross
        };
    } catch (e) { return null; }
}

/**
 * 4h ve 1w detaylarından Türkçe swing yorumu üretir
 */
function generateSwingComment(signalType, d4h, d1w) {
    if (!d4h && !d1w) return null;
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

    // ─── 1W (Haftalık) satırı ───
    if (d1w) {
        const stochEmoji1w = d1w.stochColor === 'kırmızı' ? '🔴' : '🟢';
        const obStr        = d1w.periodsOB >= 2 ? ` (${d1w.periodsOB} muddur)` : '';
        const obLabel      = (isShort && d1w.rsi >= 70) ? ` OB${obStr}` : (!isShort && d1w.rsi <= 30) ? ` OS${obStr}` : '';
        const wtStr1w      = d1w.wtCross ? ` | WT ${d1w.wtLevel} (${d1w.wtCross.includes('Düşüş') ? 'cross kırmızı' : 'cross yeşil'})` : ` | WT ${d1w.wtLevel}`;
        let line1w         = `📅 1W: RSI ${d1w.rsi}${d1w.rsiDir}${obLabel} | SRSI ${stochEmoji1w} (K:${d1w.stochK}/D:${d1w.stochD})${wtStr1w}`;
        if (d1w.stochJustFlipped) line1w += d1w.stochColor === 'kırmızı' ? ' ⚡kırmızıya döndü' : ' ⚡yeşile döndü';
        lines.push(line1w);
    }

    // ─── Genel değerlendirme ───
    const strongSignals = [];
    if (isShort) {
        if (d1w && d1w.rsi >= 75 && d1w.rsiDir === '↓')     strongSignals.push('1W RSI aşağı kıvrılıyor');
        if (d4h && d4h.rsiDir === '↓' && d4h.rsi >= 55)      strongSignals.push('4H momentum kırılıyor');
        if (d4h && d4h.wtCross && d4h.wtCross.includes('Düşüş')) strongSignals.push('4H WT kırmızı cross');
    } else {
        if (d1w && d1w.rsi <= 25 && d1w.rsiDir === '↑')     strongSignals.push('1W RSI yukarı kıvrılıyor');
        if (d4h && d4h.rsiDir === '↑' && d4h.rsi <= 45)      strongSignals.push('4H momentum dönüyor');
        if (d4h && d4h.wtCross && d4h.wtCross.includes('Yükseliş')) strongSignals.push('4H WT yeşil cross');
    }

    if (strongSignals.length >= 2) {
        lines.push(`⚠️ Güçlü ${isShort ? 'short' : 'long'}: ${strongSignals.join(' + ')}`);
    } else if (strongSignals.length >= 1) {
        lines.push(`💡 ${strongSignals.join(' + ')}`);
    }

    return lines.length > 0 ? lines.join('\n') : null;
}

async function sendAlert(symbol, type, boost, price, prev, rsi, k, d, vol, trend, demaAlert, rsi1h, rsi4h, rsi1w, swingComment = null, supplyStr = 'Bilinmiyor') {
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

    const message = `${type.includes('Buy') ? '📈' : '📉'} *[1G] #${cleanSymbol} ${type.toUpperCase()}*\n` +
        `──────────────────\n` +
        (demaAlert ? '🧘 *Yana Mum / DEMA Tespiti*\n' : '') +
        `• *Fiyat:* ${price.toFixed(4)}\n` +
        `• *Günlük RSI:* ${roundedRsi} ${rsiWarning} (Sinyal)\n` +
        `• *1 Saatlik RSI:* ${rsi1h}\n` +
        `• *4 Saatlik RSI:* ${rsi4h}\n` +
        (rsi1w !== 'N/A' && rsi1w ? `• *Haftalık RSI:* ${rsi1w}\n` : '') +
        `• *Stoch:* ${Math.round(k)}(K)/${Math.round(d)}(D)\n` +
        `• *Hacim:* ${vol}\n` +
        `──────────────────\n` +
        `🔗 [Binance Futures](${binanceUrl}) | ⏰ ${now}`;

    console.log(`\n==============================================`);
    console.log(message.replace(/\*/g, ''));
    console.log(`==============================================\n`);

    // Broadcast to Local Web Dashboard via REST API
    try {
        const signalData = {
            timeframe: '1d',
            botType: '1g',
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
            rsi1d: Math.round(rsi),
            stochK: Math.round(k),
            stochD: Math.round(d),
            volume: vol,
            trend,
            demaAlert,
            swingComment,
            supplyStr
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
 * Schedule scan: Run every hour and at daily candle boundary
 */
function scheduleNextScan() {
    const intervalMs = 60 * 60 * 1000; // Her saat başı veya her 1 saatte bir güncelle
    console.log(`⏰ Bir sonraki 1G taraması 1 saat sonra (${new Date(Date.now() + intervalMs).toLocaleTimeString()}) yapılacak.`);
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
