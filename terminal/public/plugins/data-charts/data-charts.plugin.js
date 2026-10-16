/**
 * DataChartsPlugin — 6 Mini Time-Series Grafik
 * Binance'in Data sekmesi tarzında: OI, L/S Pozisyon, L/S Hesap,
 * Taker Buy/Sell, Global L/S, Funding Rate geçmişi
 *
 * Dinlenen: 'coin:change'
 */
const DataChartsPlugin = (() => {
  const charts = {};
  let refreshTimer = null;

  const PERIOD = '5m';
  const LIMIT  = 288; // 24 saat

  function init() {
    EventBus.on('coin:change', ({ symbol }) => {
      clearInterval(refreshTimer);
      _loadAll(symbol);
      refreshTimer = setInterval(() => _loadAll(symbol), 60000);
    });
    window.addEventListener('resize', () => {
      Object.values(charts).forEach(c => c && c.resize());
    });
  }

  let loadGen = 0;
  let activeSymbol = '';

  // ─── Tüm verileri paralel çek ────────────────────────────────
  async function _loadAll(symbol) {
    const myGen = ++loadGen;
    activeSymbol = symbol;

    const [oiRes, posRes, accRes, takerRes, globalRes, fundingRes] = await Promise.allSettled([
      BinanceAPI.getOpenInterestHist(symbol, PERIOD, LIMIT),
      BinanceAPI.getTopTraderPositionRatio(symbol, PERIOD, LIMIT),
      BinanceAPI.getTopTraderAccountRatio(symbol, PERIOD, LIMIT),
      BinanceAPI.getTakerRatio(symbol, PERIOD, LIMIT),
      BinanceAPI.getGlobalLSRatio(symbol, PERIOD, LIMIT),
      BinanceAPI.getFundingRateHist(symbol, 100),
    ]);

    if (myGen !== loadGen || symbol !== activeSymbol) return;

    const coin = symbol.replace('USDT','').replace('BUSD','');

    if (oiRes.status     === 'fulfilled') _renderOI(oiRes.value, coin);
    if (posRes.status    === 'fulfilled') _renderRatioLine('ls-pos', posRes.value,    '🐳 L/S POZİSYON (Balina)',  '#f0b90b');
    if (accRes.status    === 'fulfilled') _renderRatioLine('ls-acc', accRes.value,    '👥 L/S HESAP (Balina)',      '#1890ff');
    if (takerRes.status  === 'fulfilled') _renderTaker(takerRes.value, coin);
    if (globalRes.status === 'fulfilled') _renderRatioLine('global-ls', globalRes.value, '🌐 GLOBAL L/S Perakende',  '#9b59b6');
    if (fundingRes.status === 'fulfilled') _renderFunding(fundingRes.value);
  }

  // ─── ECharts instance yöneticisi ─────────────────────────────
  function _chart(id) {
    if (!charts[id]) {
      const el = document.getElementById(`mini-chart-${id}`);
      if (!el) return null;
      charts[id] = echarts.init(el, null, { renderer: 'canvas' });
    }
    return charts[id];
  }

  // ─── Temel ECharts seçenekleri (tüm minigramlar paylaşır) ─────
  function _base(times, yFmt) {
    return {
      animation: false,
      backgroundColor: 'transparent',
      grid:  { top: 8, left: 50, right: 10, bottom: 22 },
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: {
          color: '#474d57', fontSize: 9,
          formatter: v => {
            const d = new Date(v);
            return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
          },
          interval: Math.floor(times.length / 4),
        },
        axisLine:  { lineStyle: { color: '#1e2329' } },
        axisTick:  { show: false },
        splitLine: { show: false },
        boundaryGap: false,
      },
      yAxis: {
        scale: true,
        axisLabel: { color: '#474d57', fontSize: 9, formatter: yFmt || (v => v) },
        splitLine: { lineStyle: { color: '#1e2329', type: 'dashed', opacity: .5 } },
        axisLine:  { show: false },
        axisTick:  { show: false },
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', lineStyle: { color: '#474d57', width: 1 } },
        backgroundColor: '#161a1f',
        borderColor: '#2c3038',
        textStyle: { color: '#eaecef', fontSize: 10 },
        padding: [6, 10],
      },
    };
  }

  // ─── Header güncelleme ────────────────────────────────────────
  function _setHeader(id, valStr, deltaStr, deltaClass) {
    const valEl   = document.getElementById(`mini-val-${id}`);
    const deltaEl = document.getElementById(`mini-delta-${id}`);
    if (valEl)   valEl.textContent  = valStr;
    if (deltaEl) { deltaEl.textContent = deltaStr; deltaEl.className = `mini-delta ${deltaClass}`; }
  }

  // ─── Sayı formatlayıcılar ─────────────────────────────────────
  const fmtOI = v => v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v.toFixed(0);

  // ─── 1. Open Interest (Bar + Notional Line) ───────────────────
  function _renderOI(data, coin) {
    const c = _chart('oi');
    if (!c || !data?.length) return;

    const times    = data.map(d => new Date(d.timestamp).toISOString());
    const oiVals   = data.map(d => parseFloat(d.sumOpenInterest));
    const notional = data.map(d => parseFloat(d.sumOpenInterestValue));

    const cur  = oiVals[oiVals.length - 1];
    const prev = oiVals[oiVals.length - 2] || cur;
    const pct  = ((cur - prev) / (prev || 1)) * 100;

    _setHeader('oi',
      `${fmtOI(cur)} ${coin}`,
      `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      pct >= 0 ? 'up' : 'down'
    );

    const opt = {
      ..._base(times, fmtOI),
      yAxis: [
        { scale: true, axisLabel: { color: '#474d57', fontSize: 9, formatter: fmtOI }, splitLine: { lineStyle: { color: '#1e2329', type: 'dashed', opacity: .5 } }, axisLine: { show: false }, axisTick: { show: false } },
        { scale: true, axisLabel: { show: false }, splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false } },
      ],
      series: [
        {
          name: `OI (${coin})`, type: 'bar',
          yAxisIndex: 0,
          data: oiVals,
          barMaxWidth: 5,
          itemStyle: { color: 'rgba(240,185,11,0.55)', borderColor: '#f0b90b', borderWidth: 0 },
          emphasis: { itemStyle: { color: '#f0b90b' } },
        },
        {
          name: 'Notional ($)', type: 'line',
          yAxisIndex: 1,
          data: notional,
          smooth: true, symbol: 'none',
          lineStyle: { color: 'rgba(255,255,255,0.55)', width: 1.5 },
        },
      ],
    };
    c.setOption(opt, { notMerge: true });
  }

  // ─── 2/3/5. Oran Çizgi Grafikleri (L/S Pos, L/S Acc, Global) ─
  function _renderRatioLine(id, data, title, color) {
    const c = _chart(id);
    if (!c || !data?.length) return;

    const times  = data.map(d => new Date(d.timestamp).toISOString());
    const values = data.map(d => parseFloat(d.longShortRatio));

    const cur  = values[values.length - 1];
    const prev = values[values.length - 2] || cur;
    const diff = cur - prev;

    _setHeader(id,
      cur.toFixed(3),
      `${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(3)}`,
      diff >= 0 ? 'up' : 'down'
    );

    const gradColor = color;
    const opt = {
      ..._base(times, v => v.toFixed(2)),
      series: [{
        name: title, type: 'line',
        data: values,
        smooth: 0.3, symbol: 'none',
        lineStyle: { color: gradColor, width: 2 },
        areaStyle: {
          color: {
            type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: gradColor.replace(')', ', 0.25)').replace('rgb', 'rgba') || `${gradColor}40` },
              { offset: 1, color: 'transparent' },
            ],
          }
        },
      }],
    };
    // Gradyan için hex rengi rgba'ya çevir
    opt.series[0].areaStyle.color.colorStops[0].color = _hexToRgba(gradColor, 0.2);
    c.setOption(opt, { notMerge: true });
  }

  function _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  // ─── 4. Taker Buy/Sell (Pozitif/Negatif Bar) ─────────────────
  function _renderTaker(data, coin) {
    const c = _chart('taker');
    if (!c || !data?.length) return;

    const times   = data.map(d => new Date(d.timestamp).toISOString());
    const buyVol  = data.map(d =>  parseFloat(d.buyVol));
    const sellVol = data.map(d => -parseFloat(d.sellVol)); // Negatife al
    const ratio   = data.map(d =>  parseFloat(d.buySellRatio));

    const curRatio = ratio[ratio.length - 1];
    const prevRatio = ratio[ratio.length - 2] || curRatio;
    const diff = curRatio - prevRatio;

    const isBuyerDominant = curRatio >= 1.0;
    const tag = isBuyerDominant
      ? (diff >= 0 ? '▲ Alıcı baskısı artıyor' : '▼ Alıcı üstün (ivme azaldı)')
      : (diff <= 0 ? '▼ Satıcı baskısı artıyor' : '▲ Satıcı üstün (tepki alımı)');

    _setHeader('taker',
      `${curRatio.toFixed(3)}`,
      tag,
      isBuyerDominant ? 'up' : 'down'
    );

    const opt = {
      ..._base(times, v => fmtOI(Math.abs(v))),
      series: [
        {
          name: `Alış (${coin})`, type: 'bar',
          stack: 'taker',
          data: buyVol,
          barMaxWidth: 5,
          itemStyle: { color: 'rgba(14,203,129,0.7)' },
          emphasis: { itemStyle: { color: '#0ecb81' } },
        },
        {
          name: `Satış (${coin})`, type: 'bar',
          stack: 'taker',
          data: sellVol,
          barMaxWidth: 5,
          itemStyle: { color: 'rgba(246,70,93,0.7)' },
          emphasis: { itemStyle: { color: '#f6465d' } },
        },
      ],
    };
    c.setOption(opt, { notMerge: true });
  }

  // ─── 6. Funding Rate (8 saatlik barlar) ──────────────────────
  function _renderFunding(data) {
    const c = _chart('funding');
    if (!c || !data?.length) return;

    const times = data.map(d => new Date(d.fundingTime).toISOString());
    const rates = data.map(d => parseFloat(d.fundingRate) * 100);

    const cur = rates[rates.length - 1];
    _setHeader('funding',
      `${cur >= 0 ? '+' : ''}${cur.toFixed(4)}%`,
      cur >= 0 ? 'Long ödüyor 🔺' : 'Short ödüyor 🔻',
      cur >= 0 ? 'down' : 'up'
    );

    const opt = {
      ..._base(times, v => `${v.toFixed(4)}%`),
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: {
          color: '#474d57', fontSize: 9,
          formatter: v => {
            const d = new Date(v);
            return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
          },
          interval: Math.floor(times.length / 5),
        },
        axisLine:  { lineStyle: { color: '#1e2329' } },
        axisTick:  { show: false },
        splitLine: { show: false },
        boundaryGap: true,
      },
      series: [{
        name: 'Funding Rate', type: 'bar',
        data: rates.map(r => ({
          value: r,
          itemStyle: { color: r >= 0 ? 'rgba(246,70,93,0.7)' : 'rgba(14,203,129,0.7)' }
        })),
        barMaxWidth: 8,
        emphasis: { itemStyle: { borderWidth: 0 } },
      }],
    };
    c.setOption(opt, { notMerge: true });
  }

  return { init };
})();
