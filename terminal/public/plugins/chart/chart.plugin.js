/**
 * ChartPlugin — TradingView Lightweight Charts (Binance Native Feel)
 *
 * 60 FPS Canvas/WebGL, anlık WebSocket tek-tick akışı, ultra akıcı mousewheel zoom & drag pan,
 * Binance renk paleti ve canlı taktik seviye çizgileri (TETİK, HEDEF, STOP).
 */
const ChartPlugin = (() => {
  let chart        = null;
  let candleSeries = null;
  let volumeSeries = null;
  let ema20Series  = null;
  let ema50Series  = null;

  // RSI 14 & SMA 9 Serileri
  let rsiChart     = null;
  let rsiSeries    = null;
  let rsiSmaSeries = null;
  let rsiData      = [];
  let rsiSmaData   = [];

  let currentSymbol   = '';
  let currentInterval = '15m';
  let klineData       = []; // { time, open, high, low, close, volume }

  const priceLines = {
    trigger: null,
    target:  null,
    stop:    null,
  };

  const indicators = {
    EMA20: true,
    EMA50: true,
    RSI:   true,
  };

  // ─── Lightweight Charts Başlat ────────────────────────────────
  function init(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    // Önceki içerikleri temizle
    container.innerHTML = '';

    chart = LightweightCharts.createChart(container, {
      width:  container.clientWidth  || 800,
      height: container.clientHeight || 450,
      layout: {
        background: { type: 'solid', color: '#0b0e11' },
        textColor: '#848e9c',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'Inter', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(255, 255, 255, 0.03)' },
        horzLines: { color: 'rgba(255, 255, 255, 0.03)' },
      },
      crosshair: {
        mode: LightweightCharts.CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(255, 255, 255, 0.25)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#1e2329',
        },
        horzLine: {
          color: 'rgba(255, 255, 255, 0.25)',
          width: 1,
          style: LightweightCharts.LineStyle.Dashed,
          labelBackgroundColor: '#1e2329',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        scaleMargins: {
          top: 0.08,
          bottom: 0.25, // Alttaki hacim histogramı için ferah alan (mumlar hacimle çakışmaz)
        },
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(255, 255, 255, 0.08)',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 9,
        minBarSpacing: 3,
        rightOffset: 12,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    // 1. Candlestick Serisi (Binance Canlı Renkleri)
    candleSeries = chart.addCandlestickSeries({
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

    if (typeof candleSeries.priceScale === 'function') {
      candleSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.08,
          bottom: 0.25,
        },
      });
    }

    // 2. Volume Histogram Serisi (En altta yarı şeffaf Binance stili)
    volumeSeries = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Ayrı görünmez overlay ekseni
      lastValueVisible: false, // Fiyat ekseninde hacim etiketi fiyatla karışmasın
      priceLineVisible: false,
    });

    // Hacim histogramı ölçeğini sadece en alt %20'lik alana sabitle (fiyat mumlarıyla çakışmayı önler)
    if (typeof volumeSeries.priceScale === 'function') {
      volumeSeries.priceScale().applyOptions({
        scaleMargins: {
          top: 0.80, // Hacim çubukları maksimum alttaki %20'lik alanda kalır
          bottom: 0,
        },
      });
    }

    // 3. EMA20 Serisi (Altın Sarısı)
    ema20Series = chart.addLineSeries({
      color: '#f0b90b',
      lineWidth: 1.5,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: indicators.EMA20,
    });

    // 4. EMA50 Serisi (Mavi)
    ema50Series = chart.addLineSeries({
      color: '#1890ff',
      lineWidth: 1.5,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      visible: indicators.EMA50,
    });

    // ─── RSI & SMA Sub-Chart Başlat ─────────────────────────────
    const rsiContainer = document.getElementById('rsi-chart-container');
    if (rsiContainer) {
      rsiContainer.innerHTML = '';
      rsiChart = LightweightCharts.createChart(rsiContainer, {
        width:  rsiContainer.clientWidth  || 800,
        height: rsiContainer.clientHeight || 110,
        layout: {
          background: { type: 'solid', color: '#0b0e11' },
          textColor: '#848e9c',
          fontSize: 10,
          fontFamily: "'JetBrains Mono', 'Inter', monospace",
        },
        grid: {
          vertLines: { color: 'rgba(255, 255, 255, 0.02)' },
          horzLines: { color: 'rgba(255, 255, 255, 0.02)' },
        },
        crosshair: {
          mode: LightweightCharts.CrosshairMode.Normal,
          vertLine: {
            color: 'rgba(255, 255, 255, 0.25)',
            width: 1,
            style: LightweightCharts.LineStyle.Dashed,
          },
          horzLine: {
            color: 'rgba(255, 255, 255, 0.25)',
            width: 1,
            style: LightweightCharts.LineStyle.Dashed,
          },
        },
        rightPriceScale: {
          borderColor: 'rgba(255, 255, 255, 0.08)',
          scaleMargins: {
            top: 0.08,
            bottom: 0.08,
          },
        },
        timeScale: {
          borderColor: 'rgba(255, 255, 255, 0.08)',
          timeVisible: true,
          secondsVisible: false,
          barSpacing: 9,
          minBarSpacing: 3,
          rightOffset: 12,
        },
        handleScroll: {
          mouseWheel: true,
          pressedMouseMove: true,
          horzTouchDrag: true,
          vertTouchDrag: true,
        },
        handleScale: {
          axisPressedMouseMove: true,
          mouseWheel: true,
          pinch: true,
        },
      });

      // RSI 14 Serisi (Eflatun/Mor)
      rsiSeries = rsiChart.addLineSeries({
        color: '#c084fc',
        lineWidth: 1.5,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        lastValueVisible: true,
        priceLineVisible: false,
        autoscaleInfoProvider: () => ({
          priceRange: {
            minValue: 0,
            maxValue: 100,
          },
        }),
      });

      // SMA 9 Serisi (Altın Sarısı)
      rsiSmaSeries = rsiChart.addLineSeries({
        color: '#f0b90b',
        lineWidth: 1.5,
        priceFormat: {
          type: 'price',
          precision: 2,
          minMove: 0.01,
        },
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        lastValueVisible: true,
        priceLineVisible: false,
      });

      // 70, 50, 30 Referans Çizgileri
      rsiSeries.createPriceLine({
        price: 70,
        color: 'rgba(246, 70, 93, 0.45)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '70',
      });
      rsiSeries.createPriceLine({
        price: 50,
        color: 'rgba(255, 255, 255, 0.15)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dotted,
        axisLabelVisible: false,
        title: '',
      });
      rsiSeries.createPriceLine({
        price: 30,
        color: 'rgba(14, 203, 129, 0.45)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '30',
      });

      // Zaman Skalalarını Senkronize Et (Sync visible logical range)
      let isSyncingRange = false;
      if (chart.timeScale && rsiChart.timeScale) {
        if (typeof chart.timeScale().subscribeVisibleLogicalRangeChange === 'function') {
          chart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (isSyncingRange || !rsiChart || !indicators.RSI || !range) return;
            isSyncingRange = true;
            if (typeof rsiChart.timeScale().setVisibleLogicalRange === 'function') {
              rsiChart.timeScale().setVisibleLogicalRange(range);
            }
            isSyncingRange = false;
          });
        }
        if (typeof rsiChart.timeScale().subscribeVisibleLogicalRangeChange === 'function') {
          rsiChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (isSyncingRange || !chart || !range) return;
            isSyncingRange = true;
            if (typeof chart.timeScale().setVisibleLogicalRange === 'function') {
              chart.timeScale().setVisibleLogicalRange(range);
            }
            isSyncingRange = false;
          });
        }
      }

      // RSI Chart Crosshair Dinleyici
      rsiChart.subscribeCrosshairMove(param => {
        if (!param || !param.time) {
          _updateRSILegendLast();
          return;
        }
        _updateRSILegendAt(param.time);
      });
    }

    // Otomatik Yeniden Boyutlandırma (ResizeObserver)
    const ro = new ResizeObserver(entries => {
      if (!entries || !entries.length) return;
      if (chart && container) {
        const { width, height } = container.getBoundingClientRect();
        if (width > 0 && height > 0) {
          chart.applyOptions({ width, height });
        }
      }
      if (rsiChart && rsiContainer) {
        const { width, height } = rsiContainer.getBoundingClientRect();
        if (width > 0 && height > 0) {
          rsiChart.applyOptions({ width, height });
        }
      }
    });
    ro.observe(container);
    if (rsiContainer) ro.observe(rsiContainer);

    _setupCrosshairLegend();
    _bindIndicatorToggles();
    _listenEvents();
  }

  // ─── Crosshair Legend (O: H: L: C: Vol: Takipçisi) ────────────
  function _setupCrosshairLegend() {
    chart.subscribeCrosshairMove(param => {
      if (!param || !param.time || !param.seriesData || !param.seriesData.get(candleSeries)) {
        _updateLegendLast();
        _updateRSILegendLast();
        return;
      }
      const data = param.seriesData.get(candleSeries);
      const volData = volumeSeries && param.seriesData.get(volumeSeries);
      if (data) {
        _renderLegend(data, volData ? volData.value : (data.volume || 0));
      }
      _updateRSILegendAt(param.time);
    });
  }

  function _updateLegendLast() {
    if (!klineData.length) return;
    const last = klineData[klineData.length - 1];
    _renderLegend(last, last ? last.volume : 0);
    _updateRSILegendLast();
  }

  function _renderLegend(c, vol) {
    const legendEl = document.getElementById('chart-ohlc-legend');
    if (!legendEl || !c) return;
    const isUp = c.close >= c.open;
    const colorClass = isUp ? 'up' : 'down';
    const fmt = v => {
      if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
        return PriceFormatter.format(v);
      }
      return String(v);
    };
    const vVal = vol !== undefined ? vol : (c.volume || 0);
    const fmtVol = v => {
      if (!v && v !== 0) return '—';
      if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return Number(v).toFixed(0);
    };

    legendEl.innerHTML = `
      <span>O: <span class="val ${colorClass}">${fmt(c.open)}</span></span>
      <span>H: <span class="val ${colorClass}">${fmt(c.high)}</span></span>
      <span>L: <span class="val ${colorClass}">${fmt(c.low)}</span></span>
      <span>C: <span class="val ${colorClass}">${fmt(c.close)}</span></span>
      <span>Hacim: <span class="val ${colorClass}">${fmtVol(vVal)}</span></span>
    `;
  }

  // ─── İndikatör Toggle Butonları ──────────────────────────────
  function _bindIndicatorToggles() {
    document.querySelectorAll('.ind-toggle').forEach(el => {
      const name = el.dataset.ind;
      const chk  = el.querySelector('input');
      if (!chk) return;

      el.addEventListener('click', (e) => {
        if (e.target !== chk) chk.checked = !chk.checked;
        const active = chk.checked;
        el.classList.toggle('active', active);
        indicators[name] = active;

        if (name === 'EMA20' && ema20Series) ema20Series.applyOptions({ visible: active });
        if (name === 'EMA50' && ema50Series) ema50Series.applyOptions({ visible: active });
        if (name === 'RSI') {
          const pane = document.getElementById('rsi-pane');
          if (pane) pane.classList.toggle('hidden', !active);
          const cEl = document.getElementById('echarts-container');
          const rEl = document.getElementById('rsi-chart-container');
          setTimeout(() => {
            if (chart && cEl) chart.applyOptions({ width: cEl.clientWidth, height: cEl.clientHeight });
            if (rsiChart && rEl) rsiChart.applyOptions({ width: rEl.clientWidth, height: rEl.clientHeight });
          }, 30);
        }
      });
    });
  }

  let chartGen = 0;

  // ─── EventBus Bağlantıları ───────────────────────────────────
  function _listenEvents() {
    EventBus.on('coin:change', ({ symbol, interval }) => {
      currentSymbol   = symbol;
      currentInterval = interval || currentInterval;
      _clearTacticalLines();
      loadKlines();
    });

    EventBus.on('interval:change', (interval) => {
      currentInterval = interval;
      if (currentSymbol) loadKlines();
    });

    EventBus.on('tactical:levels', (levels) => {
      _setTacticalLevels(levels || {});
    });

    // WebSocket'ten gelen canlı kline (0ms gecikme ile doğrudan series.update)
    EventBus.on('ws:kline', ({ symbol, kline }) => {
      if (symbol.toUpperCase() !== currentSymbol) return;
      if (!candleSeries || !volumeSeries) return;

      const timeSec = Math.floor(kline.openTime / 1000);
      const bar = {
        time:  timeSec,
        open:  kline.open,
        high:  kline.high,
        low:   kline.low,
        close: kline.close,
      };

      // Canlı mum güncellemesi (Binance hissi)
      candleSeries.update(bar);

      // Canlı hacim çubuğu güncellemesi
      volumeSeries.update({
        time:  timeSec,
        value: kline.volume,
        color: kline.close >= kline.open ? 'rgba(14,203,129,0.35)' : 'rgba(246,70,93,0.35)',
      });

      // Bellek güncellemesi
      const last = klineData[klineData.length - 1];
      if (last && last.time === timeSec) {
        last.high   = Math.max(last.high, kline.high);
        last.low    = Math.min(last.low, kline.low);
        last.close  = kline.close;
        last.volume = kline.volume;
      } else if (!last || timeSec > last.time) {
        klineData.push({ ...bar, volume: kline.volume });
      }

      // Canlı EMA güncellemesi (Mum her güncellendiğinde EMA noktaları da anlık ilerler)
      if (ema20Series) {
        const pt20 = _calcLastEMAPoint(klineData, 20);
        if (pt20) ema20Series.update(pt20);
      }
      if (ema50Series) {
        const pt50 = _calcLastEMAPoint(klineData, 50);
        if (pt50) ema50Series.update(pt50);
      }

      // Canlı RSI 14 & SMA 9 güncellemesi
      if (rsiSeries && rsiSmaSeries && klineData.length > 15) {
        rsiData = _calcRSI(klineData, 14);
        rsiSmaData = _calcSMA(rsiData, 9);
        rsiSeries.setData(rsiData);
        rsiSmaSeries.setData(rsiSmaData);
        _updateRSILegendLast();
      }

      _renderLegend(bar, kline.volume);
    });
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

  // ─── Kline Yükleme ───────────────────────────────────────────
  async function loadKlines() {
    if (!currentSymbol || !candleSeries) return;
    const myGen = ++chartGen;
    const targetSymbol = currentSymbol;
    const targetInterval = currentInterval;

    try {
      const raw = await BinanceAPI.getKlines(targetSymbol, targetInterval, 500);
      if (myGen !== chartGen || currentSymbol !== targetSymbol || currentInterval !== targetInterval) return;

      const map = new Map();

      raw.forEach(k => {
        const time = Math.floor(k[0] / 1000);
        map.set(time, {
          time,
          open:   parseFloat(k[1]),
          high:   parseFloat(k[2]),
          low:    parseFloat(k[3]),
          close:  parseFloat(k[4]),
          volume: parseFloat(k[5]),
        });
      });

      klineData = Array.from(map.values()).sort((a, b) => a.time - b.time);

      // Fiyat hassasiyetini belirle (SymbolRegistry resmi kontrat tickSize ve minMove)
      const precision = (typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getPrecision)
        ? SymbolRegistry.getPrecision(targetSymbol)
        : detectCoinPrecision(raw);
      const minMove = (typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getMinMove)
        ? SymbolRegistry.getMinMove(targetSymbol)
        : Number(Math.pow(10, -precision).toFixed(precision));
      candleSeries.applyOptions({
        priceFormat: { type: 'price', precision, minMove }
      });
      chart.applyOptions({
        localization: {
          priceFormatter: (val) => {
            if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
              return PriceFormatter.format(val, precision);
            }
            return typeof val === 'number' ? val.toFixed(precision) : String(val);
          }
        }
      });

      // 1. Candlestick verisi
      candleSeries.setData(klineData);

      // 2. Volume verisi
      const volumes = klineData.map(k => ({
        time:  k.time,
        value: k.volume,
        color: k.close >= k.open ? 'rgba(14,203,129,0.35)' : 'rgba(246,70,93,0.35)',
      }));
      volumeSeries.setData(volumes);

      // 3. EMA20 & EMA50 verisi
      ema20Series.setData(_calcEMAData(klineData, 20));
      ema50Series.setData(_calcEMAData(klineData, 50));

      // 4. RSI 14 & SMA 9 verisi
      rsiData = _calcRSI(klineData, 14);
      rsiSmaData = _calcSMA(rsiData, 9);
      if (rsiSeries) rsiSeries.setData(rsiData);
      if (rsiSmaSeries) rsiSmaSeries.setData(rsiSmaData);
      if (rsiChart) rsiChart.timeScale().fitContent();
      _updateRSILegendLast();

      // Grafiği sığdır
      chart.timeScale().fitContent();
      _updateLegendLast();

      // Verdict motoruna kline verisini ilet (otomatik seviye tespiti için)
      EventBus.emit('chart:klines', {
        symbol: currentSymbol,
        klines: klineData.map(k => ({
          openTime: k.time * 1000,
          open:     k.open,
          high:     k.high,
          low:      k.low,
          close:    k.close,
          volume:   k.volume,
        })),
      });

      // Taktik seviyeleri (Giriş, Tetik, Hedef, Stop) anında çiz
      _setTacticalLevels(savedLevels);

    } catch (err) {
      if (myGen !== chartGen || currentSymbol !== targetSymbol) return;
      console.error('[ChartPlugin] Kline yükleme hatası:', err);
      if (candleSeries) candleSeries.setData([]);
      if (volumeSeries) volumeSeries.setData([]);
      if (ema20Series)  ema20Series.setData([]);
      if (ema50Series)  ema50Series.setData([]);
      if (rsiSeries)    rsiSeries.setData([]);
      if (rsiSmaSeries) rsiSmaSeries.setData([]);
    }
  }

  // ─── EMA Hesaplama ───────────────────────────────────────────
  function _calcEMAData(candles, period) {
    if (candles.length < period) return [];
    const k = 2 / (period + 1);
    let ema = null;
    const result = [];

    for (let i = 0; i < candles.length; i++) {
      const price = candles[i].close;
      if (ema === null) {
        if (i + 1 >= period) {
          ema = candles.slice(0, i + 1).reduce((sum, item) => sum + item.close, 0) / period;
          result.push({ time: candles[i].time, value: ema });
        }
      } else {
        ema = price * k + ema * (1 - k);
        result.push({ time: candles[i].time, value: ema });
      }
    }
    return result;
  }

  function _calcLastEMAPoint(candles, period) {
    if (!candles || candles.length < period) return null;
    const k = 2 / (period + 1);
    let ema = null;
    for (let i = 0; i < candles.length; i++) {
      const price = candles[i].close;
      if (ema === null) {
        if (i + 1 >= period) {
          ema = candles.slice(0, i + 1).reduce((sum, item) => sum + item.close, 0) / period;
        }
      } else {
        ema = price * k + ema * (1 - k);
      }
    }
    return ema !== null ? { time: candles[candles.length - 1].time, value: ema } : null;
  }

  // ─── RSI (14) & SMA (9) Hesaplama ────────────────────────────
  function _calcRSI(klines, period = 14) {
    if (!klines || klines.length <= period) return [];
    const result = [];
    let gains = 0;
    let losses = 0;

    for (let i = 1; i <= period; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      if (diff >= 0) gains += diff;
      else losses -= diff;
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    let firstRsi = 100;
    if (avgLoss !== 0) {
      firstRsi = 100 - (100 / (1 + (avgGain / avgLoss)));
    } else if (avgGain === 0) {
      firstRsi = 50;
    }
    result.push({ time: klines[period].time, value: parseFloat(firstRsi.toFixed(2)) });

    for (let i = period + 1; i < klines.length; i++) {
      const diff = klines[i].close - klines[i - 1].close;
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? -diff : 0;

      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;

      let rsi = 100;
      if (avgLoss !== 0) {
        rsi = 100 - (100 / (1 + (avgGain / avgLoss)));
      } else if (avgGain === 0) {
        rsi = 50;
      }
      result.push({ time: klines[i].time, value: parseFloat(rsi.toFixed(2)) });
    }

    return result;
  }

  function _calcSMA(data, period = 9) {
    if (!data || data.length < period) return [];
    const result = [];
    let sum = 0;

    for (let i = 0; i < period; i++) {
      sum += data[i].value;
    }
    result.push({ time: data[period - 1].time, value: parseFloat((sum / period).toFixed(2)) });

    for (let i = period; i < data.length; i++) {
      sum += data[i].value - data[i - period].value;
      result.push({ time: data[i].time, value: parseFloat((sum / period).toFixed(2)) });
    }

    return result;
  }

  function _updateRSILegendAt(time) {
    const el = document.getElementById('rsi-legend-val');
    if (!el) return;
    const rPt = rsiData.find(p => p.time === time);
    const sPt = rsiSmaData.find(p => p.time === time);
    const rVal = rPt ? rPt.value.toFixed(2) : '—';
    const sVal = sPt ? sPt.value.toFixed(2) : '—';
    el.innerHTML = `RSI: <span class="val rsi-v">${rVal}</span> <span class="sep">|</span> SMA: <span class="val sma-v">${sVal}</span>`;
  }

  function _updateRSILegendLast() {
    const el = document.getElementById('rsi-legend-val');
    if (!el) return;
    const lastR = rsiData[rsiData.length - 1];
    const lastS = rsiSmaData[rsiSmaData.length - 1];
    const rVal = lastR ? lastR.value.toFixed(2) : '—';
    const sVal = lastS ? lastS.value.toFixed(2) : '—';
    el.innerHTML = `RSI: <span class="val rsi-v">${rVal}</span> <span class="sep">|</span> SMA: <span class="val sma-v">${sVal}</span>`;
  }

  // ─── Taktik Seviye Çizgileri (Price Lines) ───────────────────
  let savedLevels = {};

  function _clearTacticalLines() {
    if (!candleSeries) return;
    if (priceLines.trigger) { try { candleSeries.removePriceLine(priceLines.trigger); } catch(e){} priceLines.trigger = null; }
    if (priceLines.target)  { try { candleSeries.removePriceLine(priceLines.target);  } catch(e){} priceLines.target  = null; }
    if (priceLines.stop)    { try { candleSeries.removePriceLine(priceLines.stop);    } catch(e){} priceLines.stop    = null; }
    if (priceLines.entry)   { try { candleSeries.removePriceLine(priceLines.entry);   } catch(e){} priceLines.entry   = null; }
    savedLevels = (currentSymbol === 'SYNUSDT') ? { entry: 0.21948, trigger: 0.2250, target: 0.26100, stop: 0.2120 } : {};
  }

  function _setTacticalLevels(levels) {
    if (!candleSeries) return;
    savedLevels = { ...savedLevels, ...(levels || {}) };

    if (!savedLevels.entry) {
      const eVal = parseFloat(document.getElementById('btb-entry-input')?.value);
      if (!isNaN(eVal) && eVal > 0) savedLevels.entry = eVal;
    }

    _clearTacticalLines();

    if (savedLevels.entry) {
      priceLines.entry = candleSeries.createPriceLine({
        price: savedLevels.entry,
        color: '#1890ff',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🔵 GİRİŞİM',
      });
    }

    if (savedLevels.trigger) {
      priceLines.trigger = candleSeries.createPriceLine({
        price: savedLevels.trigger,
        color: '#0ecb81',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🎯 TETİK',
      });
    }

    if (savedLevels.target) {
      priceLines.target = candleSeries.createPriceLine({
        price: savedLevels.target,
        color: '#f0b90b',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🏆 HEDEF',
      });
    }

    if (savedLevels.stop) {
      priceLines.stop = candleSeries.createPriceLine({
        price: savedLevels.stop,
        color: '#f6465d',
        lineWidth: 2,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: '🛑 STOP',
      });
    }
  }

  return { init, loadKlines, setTacticalLevels: _setTacticalLevels };
})();
