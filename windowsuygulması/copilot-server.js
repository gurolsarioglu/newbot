const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BinanceClient = require('./binance-client');
const GeminiCoPilot = require('./gemini-copilot');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.COPILOT_PORT || 4200;

app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Konfigürasyon Yükleyici & Saklayıcı
const CONFIG_FILE = path.join(__dirname, 'config.json');
let config = {
  binanceApiKey: process.env.BINANCE_READ_API_KEY || '',
  binanceApiSecret: process.env.BINANCE_READ_API_SECRET || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: 'gemini-2.0-flash',
  autoIntervalMinutes: 5, // 5 dakikada bir otomatik analiz
  proactiveEnabled: true,
  manualSymbol: '' // API anahtarı yoksa test için manuel sembol girebilme
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    config = { ...config, ...saved };
  } catch (e) {
    console.error('[Config] Okuma hatası:', e.message);
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// İstemcileri başlat
let binance = new BinanceClient(config.binanceApiKey, config.binanceApiSecret);
let gemini = new GeminiCoPilot(config.geminiApiKey, config.geminiModel);

function reinitClients() {
  binance = new BinanceClient(config.binanceApiKey, config.binanceApiSecret);
  gemini = new GeminiCoPilot(config.geminiApiKey, config.geminiModel);
}

// WebSocket Yayıncı
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// ─── Durum Yönetimi ──────────────────────────────────────────
let currentPosition = null;
let lastAnalysisTime = 0;
let isAnalyzing = false;
let messageHistory = [];

// ─── Arka Plan Pozisyon & 5dk Proaktif Analiz Döngüsü ──────────
async function monitoringLoop() {
  try {
    let positions = await binance.getActivePositions();

    // Eğer Binance API anahtarı yoksa ama kullanıcı arayüzden test sembolü girdiyse simüle et
    if ((!positions || positions.length === 0) && config.manualSymbol) {
      try {
        const klines = await binance.getMultiTimeframeKlines(config.manualSymbol);
        const lastPrice = klines['5m']?.lastClose || 10;
        positions = [{
          symbol: config.manualSymbol,
          positionAmt: 1,
          entryPrice: lastPrice * 0.99,
          markPrice: lastPrice,
          unRealizedProfit: lastPrice * 0.01 * 5,
          liquidationPrice: lastPrice * 0.8,
          leverage: 5,
          marginType: 'isolated',
          isLong: true,
          pnlPercent: '5.00'
        }];
      } catch (err) {
        // yoksay
      }
    }

    const active = positions && positions.length > 0 ? positions[0] : null;
    currentPosition = active;

    // Canlı Türev & Para Akışı Verilerini Çek
    let derivativesData = null;
    const trackingSymbol = active?.symbol || config.manualSymbol;
    if (trackingSymbol) {
      derivativesData = await binance.getDerivativesMetrics(trackingSymbol);
    }

    // Canlı radar durumunu frontend'e gönder
    broadcast('POSITION_RADAR', {
      position: active,
      derivatives: derivativesData,
      hasKey: !!(config.binanceApiKey && config.binanceApiSecret)
    });

    if (active && config.proactiveEnabled) {
      const now = Date.now();
      const intervalMs = config.autoIntervalMinutes * 60 * 1000;

      // İlk tespit edildiğinde veya 5 dakikalık süre dolduğunda otomatik analiz yap!
      if (!isAnalyzing && (now - lastAnalysisTime >= intervalMs || lastAnalysisTime === 0)) {
        await runProactiveAnalysis(active);
      }
    }
  } catch (err) {
    console.error('[Monitoring] Hata:', err.message);
  }
}

// Otomatik Proaktif Analiz Koşucu
async function runProactiveAnalysis(position) {
  if (isAnalyzing) return;
  isAnalyzing = true;
  lastAnalysisTime = Date.now();

  broadcast('ANALYSIS_START', { symbol: position.symbol });

  try {
    const [multiTf, depth, derivatives] = await Promise.all([
      binance.getMultiTimeframeKlines(position.symbol),
      binance.getOrderBookDepth(position.symbol),
      binance.getDerivativesMetrics(position.symbol)
    ]);

    const result = await gemini.analyzeProactive(position, multiTf, depth, derivatives);

    const chatMessage = {
      id: Date.now().toString(),
      sender: 'co-pilot',
      type: 'proactive_5m',
      title: `⚡ [${new Date().toLocaleTimeString('tr-TR')}] 5dk Proaktif Analiz: ${position.symbol}`,
      text: result.text,
      time: new Date().toLocaleTimeString('tr-TR'),
      symbol: position.symbol,
      pnl: position.pnlPercent,
      isLong: position.isLong
    };

    messageHistory.push(chatMessage);
    if (messageHistory.length > 50) messageHistory.shift();

    broadcast('NEW_COPILOT_MESSAGE', chatMessage);
  } catch (err) {
    console.error('[Proactive Analysis] Hata:', err.message);
  } finally {
    isAnalyzing = false;
  }
}

// Döngü her 5 saniyede bir pozisyonu kontrol eder
setInterval(monitoringLoop, 5000);

// ─── REST API Endpoint'leri ─────────────────────────────────

// Kullanıcı Soru Soruyor
app.post('/api/ask', async (req, res) => {
  const { question, imageBase64 } = req.body;
  if (!question && !imageBase64) {
    return res.status(400).json({ error: 'Soru veya görsel belirtilmelidir.' });
  }

  try {
    const symbol = currentPosition?.symbol || config.manualSymbol || 'BTCUSDT';
    const [multiTf, depth, derivatives] = await Promise.all([
      binance.getMultiTimeframeKlines(symbol),
      binance.getOrderBookDepth(symbol),
      binance.getDerivativesMetrics(symbol)
    ]);

    const response = await gemini.answerUserQuestion(
      question || 'Ekranı analiz et ve tavsiye ver.',
      currentPosition,
      multiTf,
      depth,
      derivatives,
      imageBase64
    );

    const answerMessage = {
      id: Date.now().toString(),
      sender: 'co-pilot',
      type: 'user_reply',
      title: `🎯 Co-Pilot Yanıtı (${symbol})`,
      text: response.text,
      time: new Date().toLocaleTimeString('tr-TR')
    };

    messageHistory.push(answerMessage);
    res.json({ success: true, answer: answerMessage });
  } catch (err) {
    console.error('[API /ask] Hata:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Ayarları Getir & Güncelle
app.get('/api/settings', (req, res) => {
  res.json({
    hasBinanceKey: !!config.binanceApiKey,
    hasBinanceSecret: !!config.binanceApiSecret,
    hasGeminiKey: !!config.geminiApiKey,
    geminiModel: config.geminiModel,
    autoIntervalMinutes: config.autoIntervalMinutes,
    proactiveEnabled: config.proactiveEnabled,
    manualSymbol: config.manualSymbol
  });
});

app.post('/api/settings', (req, res) => {
  const { binanceApiKey, binanceApiSecret, geminiApiKey, geminiModel, autoIntervalMinutes, proactiveEnabled, manualSymbol } = req.body;

  if (binanceApiKey !== undefined) config.binanceApiKey = binanceApiKey;
  if (binanceApiSecret !== undefined) config.binanceApiSecret = binanceApiSecret;
  if (geminiApiKey !== undefined) config.geminiApiKey = geminiApiKey;
  if (geminiModel !== undefined) config.geminiModel = geminiModel;
  if (autoIntervalMinutes !== undefined) config.autoIntervalMinutes = parseInt(autoIntervalMinutes, 10);
  if (proactiveEnabled !== undefined) config.proactiveEnabled = !!proactiveEnabled;
  if (manualSymbol !== undefined) config.manualSymbol = manualSymbol.toUpperCase().trim();

  saveConfig();
  reinitClients();

  res.json({ success: true, message: 'Ayarlar başarıyla güncellendi!' });
});

// Manuel Analiz Tetikle (Hemen Şimdi Analiz Et)
app.post('/api/analyze-now', async (req, res) => {
  if (currentPosition) {
    runProactiveAnalysis(currentPosition);
    return res.json({ success: true, message: 'Analiz başlatıldı.' });
  } else if (config.manualSymbol) {
    const klines = await binance.getMultiTimeframeKlines(config.manualSymbol);
    const lastPrice = klines['5m']?.lastClose || 10;
    const fakePos = {
      symbol: config.manualSymbol,
      positionAmt: 1,
      entryPrice: lastPrice,
      markPrice: lastPrice,
      unRealizedProfit: 0,
      liquidationPrice: lastPrice * 0.8,
      leverage: 5,
      marginType: 'isolated',
      isLong: true,
      pnlPercent: '0.00'
    };
    runProactiveAnalysis(fakePos);
    return res.json({ success: true, message: 'Manuel sembol için analiz başlatıldı.' });
  }
  res.status(400).json({ error: 'Aktif bir pozisyon bulunamadı.' });
});

// Geçmiş Mesajlar
app.get('/api/history', (req, res) => {
  res.json({ messages: messageHistory });
});

// Sunucuyu başlat
server.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 AI Trading Co-Pilot Masaüstü Sunucusu Aktif!`);
  console.log(`📡 URL: http://localhost:${PORT}`);
  console.log(`⏱️ 5dk Proaktif Mod: ${config.proactiveEnabled ? 'AÇIK' : 'KAPALI'}`);
  console.log(`======================================================\n`);
});
