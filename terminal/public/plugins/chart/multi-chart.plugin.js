/**
 * multi-chart.plugin.js — 4'lü Senkronize Çoklu Zaman Dilimli Grafik Motoru (1m, 5m, 1h, 1D)
 * Lightweight Charts ile 60 FPS, Bollinger Bantları, Hacim ve alt RSI Osilatörü.
 */
const MultiChartPlugin = (() => {
  const TIMEFRAMES = [
    { id: '1m', name: '1m', limit: 150 },
    { id: '5m', name: '5m', limit: 150 },
    { id: '1h', name: '1H', limit: 150 },
    { id: '1d', name: '1D', limit: 150 }
  ];

  let currentSymbol = 'BTWUSDT';
  const instances = []; // 4 charts instances

  // ─── Matematiksel İndikatör Hesaplayıcılar ─────────────────────
  function calculateBollingerBands(klines, period = 20, multiplier = 2) {
    const upper = [];
    const middle = [];
    const lower = [];

    for (let i = 0; i < klines.length; i++) {
      if (i < period - 1) continue;
      const slice = klines.slice(i - period + 1, i + 1);
      const closes = slice.map(k => k.close);
      const sma = closes.reduce((a, b) => a + b, 0) / period;
      const variance = closes.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period;
      const stdDev = Math.sqrt(variance);

      const time = klines[i].time;
      middle.push({ time, value: sma });
      upper.push({ time, value: sma + (multiplier * stdDev) });
      lower.push({ time, value: sma - (multiplier * stdDev) });
    }

    return { upper, middle, lower };
  }

  function calculateRSI(klines, period = 14) {
    if (klines.length <= period) return [];
    const rsiData = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    let rsi = 100 - (100 / (1 + rs));
    rsiData.push({ time: klines[period].time, value: +rsi.toFixed(2) });

    for (let i = period + 1; i < klines.length; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
      rsiData.push({ time: klines[i].time, value: +rsi.toFixed(2) });
    }

    return rsiData;
  }

  // RSI tabanlı SMA (TradingView Standardı: 14 Period Simple Moving Average)
  function calculateSMA(data, period = 14) {
    if (!data || data.length < period) return [];
    const smaData = [];
    for (let i = period - 1; i < data.length; i++) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j].value;
      }
      smaData.push({
        time: data[i].time,
        value: +(sum / period).toFixed(2),
      });
    }
    return smaData;
  }

  // ─── Grafik Hücresini İnşa Et ──────────────────────────────────
  function createChartCell(index, tfConfig, containerEl) {
    const cellEl = document.createElement('div');
    cellEl.className = 'chart-cell';
    cellEl.id = `chart-cell-${index}`;

    cellEl.innerHTML = `
      <div class="chart-cell-header">
        <div class="cell-info-left">
          <div class="cell-dot"></div>
          <span class="cell-symbol" id="cell-symbol-${index}">${currentSymbol}.P</span>
          <span class="cell-tf">${tfConfig.name}</span>
          <span class="cell-vol" id="cell-vol-${index}">Vol —</span>
        </div>
        <div class="cell-ind-badge">BB</div>
      </div>
      <div class="cell-candle-container" id="cell-candle-${index}"></div>
      <div class="cell-rsi-container" id="cell-rsi-${index}">
        <div class="rsi-sub-header">
          <div class="rsi-labels-wrap">
            <span style="color:#a855f7;font-weight:700;">RSI 14</span>
            <span id="rsi-val-${index}" style="color:#a855f7;font-weight:700;font-family:monospace;margin-left:4px;">—</span>
            <span style="color:#facc15;font-weight:700;margin-left:10px;">SMA 14</span>
            <span id="sma-val-${index}" style="color:#facc15;font-weight:700;font-family:monospace;margin-left:4px;">—</span>
          </div>
          <div class="rsi-levels-hint" style="color:rgba(255,255,255,0.3);font-size:8.5px;">70 / 50 / 30</div>
        </div>
        <div class="rsi-sub-chart" id="cell-rsi-chart-${index}"></div>
      </div>
    `;

    containerEl.appendChild(cellEl);

    const candleContainer = cellEl.querySelector(`#cell-candle-${index}`);
    const rsiContainer = cellEl.querySelector(`#cell-rsi-chart-${index}`);

    // Ana Mum Grafiği
    const mainChart = LightweightCharts.createChart(candleContainer, {
      layout: {
        background: { type: 'solid', color: '#080a0c' },
        textColor: '#848e9c',
        fontSize: 10,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.1, bottom: 0.22 },
        autoScale: true,
        minimumWidth: 58,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
      },
    });

    const candleSeries = mainChart.addCandlestickSeries({
      upColor: '#0ecb81',
      downColor: '#f6465d',
      borderUpColor: '#0ecb81',
      borderDownColor: '#f6465d',
      wickUpColor: '#0ecb81',
      wickDownColor: '#f6465d',
      priceFormat: {
        type: 'price',
        precision: 5,
        minMove: 0.00001,
      },
    });

    const volumeSeries = mainChart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });

    if (volumeSeries.priceScale) {
      volumeSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });
    }

    // Bollinger Bantları Serileri
    const bbUpperSeries = mainChart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Solid,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const bbMiddleSeries = mainChart.addLineSeries({
      color: '#f0b90b',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    const bbLowerSeries = mainChart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Solid,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    // Alt RSI & SMA Grafiği
    const rsiChart = LightweightCharts.createChart(rsiContainer, {
      layout: {
        background: { type: 'solid', color: '#080a0c' },
        textColor: '#848e9c',
        fontSize: 9,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.04)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: { top: 0.12, bottom: 0.12 },
        autoScale: true,
        minimumWidth: 58,
      },
      timeScale: {
        visible: false,
      },
    });

    // 1. RSI Çizgisi (Mor - TradingView Stili)
    const rsiSeries = rsiChart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (val) => val.toFixed(1),
      },
      autoscaleInfoProvider: (original) => {
        const res = original();
        if (res !== null && res.priceRange !== null) {
          return {
            priceRange: {
              minValue: Math.min(25, res.priceRange.minValue),
              maxValue: Math.max(75, res.priceRange.maxValue),
            },
          };
        }
        return {
          priceRange: {
            minValue: 20,
            maxValue: 80,
          },
        };
      },
    });

    // 2. RSI Tabanlı Hareketli Ortalama (SMA 14 - Canlı Altın Sarısı)
    const smaSeries = rsiChart.addLineSeries({
      color: '#facc15',
      lineWidth: 1.5,
      priceFormat: {
        type: 'custom',
        formatter: (val) => val.toFixed(1),
      },
    });

    // 70 Seviyesi (Aşırı Alım - Kırmızı Kesikli)
    rsiSeries.createPriceLine({
      price: 70,
      color: 'rgba(246, 70, 93, 0.65)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '70',
    });

    // 50 Seviyesi (Orta Çizgi - Beyaz Noktalı)
    rsiSeries.createPriceLine({
      price: 50,
      color: 'rgba(255, 255, 255, 0.25)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dotted,
      axisLabelVisible: false,
      title: '50',
    });

    // 30 Seviyesi (Aşırı Satım - Yeşil Kesikli)
    rsiSeries.createPriceLine({
      price: 30,
      color: 'rgba(14, 203, 129, 0.65)',
      lineWidth: 1,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: '30',
    });

    // Zaman Skalası Senkronizasyonu (Main Chart & RSI Chart)
    let isSyncing = false;
    mainChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncing || !range) return;
      isSyncing = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      isSyncing = false;
    });

    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (isSyncing || !range) return;
      isSyncing = true;
      mainChart.timeScale().setVisibleLogicalRange(range);
      isSyncing = false;
    });

    // Resize Observer
    const ro = new ResizeObserver(() => {
      mainChart.applyOptions({
        width: candleContainer.clientWidth,
        height: candleContainer.clientHeight,
      });
      rsiChart.applyOptions({
        width: rsiContainer.clientWidth,
        height: rsiContainer.clientHeight,
      });
    });
    ro.observe(candleContainer);
    ro.observe(rsiContainer);

    const instObj = {
      index,
      tf: tfConfig.id,
      name: tfConfig.name,
      limit: tfConfig.limit,
      mainChart,
      candleSeries,
      volumeSeries,
      bbUpperSeries,
      bbMiddleSeries,
      bbLowerSeries,
      rsiChart,
      rsiSeries,
      smaSeries,
      rawKlines: [],
      rsiMap: new Map(),
      smaMap: new Map(),
      lastRsi: null,
      lastSma: null,
    };

    // Crosshair Sync: Fare ile mum üzerine gelindiğinde anlık RSI ve SMA değerlerini güncelle
    mainChart.subscribeCrosshairMove((param) => {
      const valEl = document.getElementById(`rsi-val-${index}`);
      const smaEl = document.getElementById(`sma-val-${index}`);
      if (!valEl || !smaEl) return;

      if (!param || !param.time) {
        if (instObj.lastRsi != null) {
          valEl.textContent = instObj.lastRsi.toFixed(1);
          valEl.style.color = instObj.lastRsi <= 30 ? '#0ecb81' : instObj.lastRsi >= 70 ? '#f6465d' : '#a855f7';
        }
        if (instObj.lastSma != null) smaEl.textContent = instObj.lastSma.toFixed(1);
        return;
      }

      const rVal = instObj.rsiMap ? instObj.rsiMap.get(param.time) : null;
      if (rVal != null) {
        valEl.textContent = rVal.toFixed(1);
        valEl.style.color = rVal <= 30 ? '#0ecb81' : rVal >= 70 ? '#f6465d' : '#a855f7';
      }
      const sVal = instObj.smaMap ? instObj.smaMap.get(param.time) : null;
      if (sVal != null) {
        smaEl.textContent = sVal.toFixed(1);
      }
    });

    return instObj;
  }

  // ─── Coinin Gerçek Ondalık Hassasiyetini Tespit Et ───────────────
  function detectCoinPrecision(rawData) {
    if (!Array.isArray(rawData) || !rawData.length) return 2;

    const samplePrice = parseFloat(rawData[0][4] || rawData[0][1] || 0);
    let minByMag = 2;
    if (samplePrice < 0.0001) minByMag = 8;
    else if (samplePrice < 0.01) minByMag = 6;
    else if (samplePrice < 1) minByMag = 4;
    else minByMag = 2;

    let maxSignificantDecimals = 2;
    const sampleCount = Math.min(35, rawData.length);
    for (let i = 0; i < sampleCount; i++) {
      const row = rawData[i];
      for (let c = 1; c <= 4; c++) {
        const pStr = String(row[c] || '').replace(/0+$/, '');
        if (pStr.includes('.')) {
          const dec = pStr.split('.')[1].length;
          if (dec > maxSignificantDecimals) maxSignificantDecimals = dec;
        }
      }
    }
    return Math.min(8, Math.max(minByMag, maxSignificantDecimals));
  }

  // ─── Tek Bir Hücrenin Verisini Çek ve Güncelle ─────────────────
  async function fetchAndRenderCell(inst, symbol) {
    try {
      const res = await fetch(`/api/fapi/v1/klines?symbol=${symbol}&interval=${inst.tf}&limit=${inst.limit}`);
      if (!res.ok) return;
      const rawData = await res.json();
      if (!Array.isArray(rawData) || !rawData.length) return;

      // Hassasiyet (Tick Precision): SymbolRegistry resmi kontrat tanımı
      const precision = (typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getPrecision)
        ? SymbolRegistry.getPrecision(symbol)
        : detectCoinPrecision(rawData);
      const minMove = (typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getMinMove)
        ? SymbolRegistry.getMinMove(symbol)
        : Number(Math.pow(10, -precision).toFixed(precision));

      inst.precision = precision;
      inst.minMove = minMove;

      const priceFormatOpts = {
        type: 'price',
        precision: precision,
        minMove: minMove,
      };

      inst.candleSeries.applyOptions({ priceFormat: priceFormatOpts });
      inst.bbUpperSeries.applyOptions({ priceFormat: priceFormatOpts });
      inst.bbMiddleSeries.applyOptions({ priceFormat: priceFormatOpts });
      inst.bbLowerSeries.applyOptions({ priceFormat: priceFormatOpts });

      inst.mainChart.applyOptions({
        localization: {
          priceFormatter: (val) => {
            if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
              return PriceFormatter.format(val, precision);
            }
            if (typeof val !== 'number' || isNaN(val)) return '—';
            return val.toFixed(precision);
          }
        }
      });

      const klines = rawData.map(d => ({
        time: Math.floor(d[0] / 1000),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4]),
        volume: parseFloat(d[5]),
      }));

      inst.rawKlines = klines;

      // 1. Mumlar
      inst.candleSeries.setData(klines);

      // 2. Hacim
      const volData = klines.map(k => ({
        time: k.time,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)',
      }));
      inst.volumeSeries.setData(volData);

      // 3. Bollinger Bantları
      const bb = calculateBollingerBands(klines, 20, 2);
      inst.bbUpperSeries.setData(bb.upper);
      inst.bbMiddleSeries.setData(bb.middle);
      inst.bbLowerSeries.setData(bb.lower);

      // 4. RSI (14) & SMA (14)
      const rsi = calculateRSI(klines, 14);
      inst.rsiSeries.setData(rsi);

      const rsiSma = calculateSMA(rsi, 14);
      inst.smaSeries.setData(rsiSma);

      inst.rsiMap = new Map(rsi.map(p => [p.time, p.value]));
      inst.smaMap = new Map(rsiSma.map(p => [p.time, p.value]));

      if (rsi.length) {
        inst.lastRsi = rsi[rsi.length - 1].value;
        const valEl = document.getElementById(`rsi-val-${inst.index}`);
        if (valEl) {
          valEl.textContent = inst.lastRsi.toFixed(1);
          valEl.style.color = inst.lastRsi <= 30 ? '#0ecb81' : inst.lastRsi >= 70 ? '#f6465d' : '#a855f7';
        }
      }

      if (rsiSma.length) {
        inst.lastSma = rsiSma[rsiSma.length - 1].value;
        const smaEl = document.getElementById(`sma-val-${inst.index}`);
        if (smaEl) {
          smaEl.textContent = inst.lastSma.toFixed(1);
        }
      }

      // Hacim etiketi
      const volEl = document.getElementById(`cell-vol-${inst.index}`);
      if (volEl && klines.length) {
        const lastVol = klines[klines.length - 1].volume;
        volEl.textContent = `Vol ${(lastVol > 1000 ? (lastVol / 1000).toFixed(1) + 'K' : lastVol.toFixed(1))}`;
      }

      // Başlık güncelle
      const symEl = document.getElementById(`cell-symbol-${inst.index}`);
      if (symEl) symEl.textContent = `${symbol}.P`;

      inst.mainChart.timeScale().fitContent();
      inst.rsiChart.timeScale().fitContent();
    } catch (err) {
      console.warn(`[MultiChart] ${inst.tf} kline fetch error:`, err);
    }
  }

  // ─── Tüm 4 Grafiği Yeni Bir Coine Geçir ────────────────────────
  async function loadSymbol(symbol) {
    currentSymbol = symbol.toUpperCase();
    const tasks = instances.map(inst => fetchAndRenderCell(inst, currentSymbol));
    await Promise.allSettled(tasks);
  }

  // ─── Başlatıcı ────────────────────────────────────────────────
  function init(containerId = 'charts-viewport') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    instances.length = 0;

    TIMEFRAMES.forEach((tf, idx) => {
      const inst = createChartCell(idx, tf, container);
      instances.push(inst);
    });

    loadSymbol(currentSymbol);

    // Canlı WebSocket kline dinlemesi (özellikle 1m ve anlık güncellemeler)
    if (typeof EventBus !== 'undefined') {
      EventBus.on('ws:kline', (data) => {
        if (!data || !data.symbol || data.symbol.toUpperCase() !== currentSymbol) return;
        const inst = instances.find(i => i.tf === data.interval);
        if (!inst || !data.kline) return;

        const k = data.kline;
        const barTime = Math.floor(k.openTime / 1000);
        const candle = {
          time: barTime,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
        };

        try {
          inst.candleSeries.update(candle);
          inst.volumeSeries.update({
            time: barTime,
            value: k.volume,
            color: k.close >= k.open ? 'rgba(14, 203, 129, 0.35)' : 'rgba(246, 70, 93, 0.35)',
          });
        } catch (e) {}
      });
    }
  }

  return {
    init,
    loadSymbol,
    getCurrentSymbol: () => currentSymbol,
  };
})();
