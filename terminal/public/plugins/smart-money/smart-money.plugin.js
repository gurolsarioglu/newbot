/**
 * SmartMoneyPlugin — Gelişmiş Akıllı Para Kokpiti & Canlı Balina Radarı
 * 
 * 1. Akıllı Para Güç İbresi (Smart Money Index - 0 to 100)
 * 2. Top Trader Pozisyon + 15-25dk Delta Değişimi
 * 3. Top Trader Hesap + Delta
 * 4. Global L/S Perakende Ters Oran + Delta
 * 5. Taker Order Flow (Piyasa Alıcı vs Satıcı Baskısı)
 * 6. Canlı Balina & Likidasyon Akışı (WebSocket Radar)
 */
const SmartMoneyPlugin = (() => {
  let refreshTimer = null;
  let activeSymbol = '';
  const radarItems = [];
  const MAX_RADAR_ITEMS = 7;

  function init() {
    EventBus.on('coin:change', ({ symbol }) => {
      activeSymbol = symbol.toUpperCase();
      radarItems.length = 0;
      _renderRadar();
      _render(null);
      clearInterval(refreshTimer);
      _load(activeSymbol);
      refreshTimer = setInterval(() => _load(activeSymbol), 15000); // 15s güncel veri
    });

    // Anlık WebSocket Piyasa Emirleri (Balina Alış/Satışları)
    EventBus.on('ws:aggTrade', (trade) => {
      if (!trade || !trade.symbol || trade.symbol.toUpperCase() !== activeSymbol) return;
      // Eşik: $600 ve üzeri piyasa emirleri balina/büyük işlem radarına girer
      if (trade.val >= 600) {
        _addRadarItem({
          type: trade.isBuyerMaker ? 'sell' : 'buy',
          title: trade.isBuyerMaker ? '🐻 MARKET SELL' : '🐳 MARKET BUY',
          val: trade.val,
          qty: trade.qty,
          price: trade.price,
          time: trade.time || Date.now(),
        });
      }
    });

    // Anlık Likidasyon Akışı
    EventBus.on('ws:liquidation', (liq) => {
      if (!liq || !liq.symbol || liq.symbol.toUpperCase() !== activeSymbol) return;
      const isShortLiq = liq.side === 'BUY'; // Short pozisyon tasfiye olunca piyasadan BUY yapılır
      _addRadarItem({
        type: 'liq',
        title: isShortLiq ? '💥 SHORT PATLADI' : '⚡ LONG PATLADI',
        val: liq.val,
        qty: liq.qty,
        price: liq.price,
        time: liq.time || Date.now(),
      });
    });
  }

  let smGen = 0;

  async function _load(symbol) {
    const myGen = ++smGen;
    activeSymbol = symbol;
    try {
      const data = await BinanceAPI.getAllSmartMoney(symbol);
      if (myGen !== smGen || symbol !== activeSymbol) return;
      _render(data);
      EventBus.emit('smartmoney:data', data);
    } catch (err) {
      if (myGen !== smGen || symbol !== activeSymbol) return;
      console.error('[SmartMoneyPlugin] Hata:', err);
      _render(null);
    }
  }

  function _clearLSBar(id) {
    const ratioEl  = document.getElementById(`ls-ratio-${id}`);
    const longBar  = document.getElementById(`ls-long-bar-${id}`);
    const shortBar = document.getElementById(`ls-short-bar-${id}`);
    const longLbl  = document.getElementById(`ls-long-pct-${id}`);
    const shortLbl = document.getElementById(`ls-short-pct-${id}`);
    const noteEl   = document.getElementById(`ls-note-${id}`);
    const deltaEl  = document.getElementById(`ls-delta-${id}`);

    if (ratioEl) {
      ratioEl.textContent = '—';
      ratioEl.className = 'ls-ratio-value neutral';
    }
    if (longBar)  longBar.style.width  = '50%';
    if (shortBar) shortBar.style.width = '50%';
    if (longLbl)  longLbl.textContent  = 'L —';
    if (shortLbl) shortLbl.textContent = 'S —';
    if (deltaEl) {
      deltaEl.textContent = '—';
      deltaEl.className = 'ls-delta-badge neutral';
    }
    if (noteEl) noteEl.textContent = 'Veri yok / Bekleniyor...';
  }

  function _clearTakerBar() {
    const ratioEl  = document.getElementById('ls-ratio-taker');
    const longBar  = document.getElementById('ls-long-bar-taker');
    const shortBar = document.getElementById('ls-short-bar-taker');
    const longLbl  = document.getElementById('ls-long-pct-taker');
    const shortLbl = document.getElementById('ls-short-pct-taker');
    const noteEl   = document.getElementById('ls-note-taker');
    const deltaEl  = document.getElementById('ls-delta-taker');

    if (ratioEl) {
      ratioEl.textContent = '—';
      ratioEl.className = 'ls-ratio-value neutral';
    }
    if (longBar)  longBar.style.width  = '50%';
    if (shortBar) shortBar.style.width = '50%';
    if (longLbl)  longLbl.textContent  = 'Alıcı —';
    if (shortLbl) shortLbl.textContent = 'Satıcı —';
    if (deltaEl) {
      deltaEl.textContent = '—';
      deltaEl.className = 'ls-delta-badge neutral';
    }
    if (noteEl) noteEl.textContent = 'Veri yok / Bekleniyor...';
  }

  function _render(data) {
    if (!data) {
      _clearLSBar('pos');
      _clearLSBar('acc');
      _clearLSBar('global');
      _clearTakerBar();
      _renderSmartMoneyIndex(null);
      return;
    }

    // 1. Top Trader Positions
    if (data.posRatio && data.posRatio.longShortRatio) {
      const longPct  = parseFloat(data.posRatio.longAccount) * 100;
      const shortPct = parseFloat(data.posRatio.shortAccount) * 100;
      const ratio    = parseFloat(data.posRatio.longShortRatio);
      const delta    = _calcDelta(data.posHist);
      _updateLSBar('pos', longPct, shortPct, ratio, delta);
    } else {
      _clearLSBar('pos');
    }

    // 2. Top Trader Accounts
    if (data.accRatio && data.accRatio.longShortRatio) {
      const longPct  = parseFloat(data.accRatio.longAccount) * 100;
      const shortPct = parseFloat(data.accRatio.shortAccount) * 100;
      const ratio    = parseFloat(data.accRatio.longShortRatio);
      const delta    = _calcDelta(data.accHist);
      _updateLSBar('acc', longPct, shortPct, ratio, delta);
    } else {
      _clearLSBar('acc');
    }

    // 3. Global L/S (Perakende)
    if (data.globalLS && data.globalLS.longShortRatio) {
      const longPct  = parseFloat(data.globalLS.longAccount) * 100;
      const shortPct = parseFloat(data.globalLS.shortAccount) * 100;
      const ratio    = parseFloat(data.globalLS.longShortRatio);
      const delta    = _calcDelta(data.globalHist);
      _updateLSBar('global', longPct, shortPct, ratio, delta);
    } else {
      _clearLSBar('global');
    }

    // 4. Taker Order Flow (Piyasa Baskısı)
    if (data.takerRatio && data.takerRatio.buySellRatio) {
      const buyVol   = parseFloat(data.takerRatio.buyVol || data.takerRatio.buySellRatio || 1);
      const sellVol  = parseFloat(data.takerRatio.sellVol || 1);
      const ratio    = parseFloat(data.takerRatio.buySellRatio);
      const total    = buyVol + sellVol;
      const buyPct   = total > 0 ? (buyVol / total) * 100 : (ratio / (ratio + 1)) * 100;
      const sellPct  = 100 - buyPct;
      const delta    = _calcDelta(data.takerHist);
      _updateTakerBar(buyPct, sellPct, ratio, delta);
    } else {
      _clearTakerBar();
    }

    // 5. Akıllı Para Güç İbresi (Smart Money Index: 0 - 100)
    _renderSmartMoneyIndex(data);
  }

  // ── Delta Hesaplama (15-25dk önceki ilk çubukla son çubuk farkı) ──
  function _calcDelta(hist) {
    if (!hist || !Array.isArray(hist) || hist.length < 2) return null;
    const oldest = hist[0];
    const newest = hist[hist.length - 1];
    const oldVal = parseFloat(oldest.longShortRatio || oldest.buySellRatio || 0);
    const newVal = parseFloat(newest.longShortRatio || newest.buySellRatio || 0);
    if (!oldVal) return null;

    const diff = newVal - oldVal;
    const diffPct = (diff / oldVal) * 100;
    return {
      diff,
      diffPct,
      isUp: diff >= 0,
      text: `${diff >= 0 ? '▲ +' : '▼ '}${diff.toFixed(2)} (${diff >= 0 ? '+' : ''}${diffPct.toFixed(1)}%)`,
    };
  }

  function _updateLSBar(id, longPct, shortPct, ratio, delta) {
    const ratioEl  = document.getElementById(`ls-ratio-${id}`);
    const longBar  = document.getElementById(`ls-long-bar-${id}`);
    const shortBar = document.getElementById(`ls-short-bar-${id}`);
    const longLbl  = document.getElementById(`ls-long-pct-${id}`);
    const shortLbl = document.getElementById(`ls-short-pct-${id}`);
    const noteEl   = document.getElementById(`ls-note-${id}`);
    const deltaEl  = document.getElementById(`ls-delta-${id}`);

    if (!ratioEl) return;

    const isBull = ratio >= 1.1;
    const isBear = ratio < 0.9;

    ratioEl.textContent = ratio.toFixed(2);
    ratioEl.className = `ls-ratio-value ${isBull ? 'bull' : isBear ? 'bear' : 'neutral'}`;

    if (longBar)  longBar.style.width  = `${longPct.toFixed(1)}%`;
    if (shortBar) shortBar.style.width = `${shortPct.toFixed(1)}%`;
    if (longLbl)  longLbl.textContent  = `L ${longPct.toFixed(1)}%`;
    if (shortLbl) shortLbl.textContent = `S ${shortPct.toFixed(1)}%`;

    if (deltaEl && delta) {
      deltaEl.textContent = delta.text;
      deltaEl.className = `ls-delta-badge ${delta.isUp ? 'bull' : 'bear'}`;
    }

    if (noteEl) {
      const notes = {
        pos:    isBull ? 'Balinalar Long biriktiriyor 🐳' : isBear ? 'Balinalar Short ağırlıklı 🐻' : 'Denge bölgesinde ⚖️',
        acc:    isBull ? 'Elit hesaplar Longda ✅'     : isBear ? 'Hesap sayısı Shortta ⚠️'     : 'Nötr dağılım ⚖️',
        global: isBear ? 'Perakende terste sıkışıyor (Short) 🔴' : isBull ? 'Perakende Long coşkusu (Risk!) 🚨' : 'Perakende dengeli ⚖️',
      };
      noteEl.textContent = notes[id] || '';
    }
  }

  function _updateTakerBar(buyPct, sellPct, ratio, delta) {
    const ratioEl  = document.getElementById('ls-ratio-taker');
    const longBar  = document.getElementById('ls-long-bar-taker');
    const shortBar = document.getElementById('ls-short-bar-taker');
    const longLbl  = document.getElementById('ls-long-pct-taker');
    const shortLbl = document.getElementById('ls-short-pct-taker');
    const noteEl   = document.getElementById('ls-note-taker');
    const deltaEl  = document.getElementById('ls-delta-taker');

    if (!ratioEl) return;

    const isBull = ratio >= 1.05;
    const isBear = ratio < 0.95;

    ratioEl.textContent = ratio.toFixed(2);
    ratioEl.className = `ls-ratio-value ${isBull ? 'bull' : isBear ? 'bear' : 'neutral'}`;

    if (longBar)  longBar.style.width  = `${buyPct.toFixed(1)}%`;
    if (shortBar) shortBar.style.width = `${sellPct.toFixed(1)}%`;
    if (longLbl)  longLbl.textContent  = `Alıcı ${buyPct.toFixed(1)}%`;
    if (shortLbl) shortLbl.textContent = `Satıcı ${sellPct.toFixed(1)}%`;

    if (deltaEl && delta) {
      deltaEl.textContent = delta.text;
      deltaEl.className = `ls-delta-badge ${delta.isUp ? 'bull' : 'bear'}`;
    }

    if (noteEl) {
      noteEl.textContent = isBull
        ? 'Boğalar piyasa emirleriyle tahtayı süpürüyor 🚀'
        : isBear
        ? 'Ayılar satış emirleri kusuyor 🐻'
        : 'Piyasa alıcı/satıcı dengede ⚖️';
    }
  }

  // ── Akıllı Para Güç İbresi (SMI: 0 - 100) ──────────────────
  function _renderSmartMoneyIndex(data) {
    const scoreEl = document.getElementById('smi-score');
    const fillEl  = document.getElementById('smi-meter-fill');
    const badgeEl = document.getElementById('smi-status-badge');
    if (!scoreEl || !fillEl || !badgeEl) return;

    const hasAnyMetric = data && (
      data.posRatio || data.globalLS || data.takerRatio || (data.funding && data.funding.lastFundingRate !== undefined)
    );

    if (!hasAnyMetric) {
      scoreEl.textContent = '--%';
      fillEl.style.width  = '0%';
      fillEl.style.background = '#848e9c';
      badgeEl.textContent = '⚪ VERİ YOK / BEKLENİYOR';
      badgeEl.className   = 'smi-status-badge neutral';
      return;
    }

    let score = 50; // Başlangıç nötr

    // 1. Top Trader Pozisyon Etkisi (+-20)
    if (data.posRatio) {
      const p = parseFloat(data.posRatio.longShortRatio);
      if (p >= 1.6) score += 20;
      else if (p >= 1.3) score += 14;
      else if (p >= 1.1) score += 7;
      else if (p < 0.8) score -= 18;
      else if (p < 0.95) score -= 8;
    }

    // 2. Global Perakende Ters Orantı (+-20)
    // Perakende ne kadar short ise balina o kadar long patlatır (Boğa yakıtı)
    if (data.globalLS) {
      const g = parseFloat(data.globalLS.longShortRatio);
      if (g <= 0.6) score += 20; // Büyük short squeeze yakıtı!
      else if (g <= 0.85) score += 10;
      else if (g >= 1.5) score -= 20; // Perakende longda kalabalık, dump riski
      else if (g >= 1.2) score -= 10;
    }

    // 3. Taker Buy/Sell Hacim Baskısı (+-15)
    if (data.takerRatio) {
      const t = parseFloat(data.takerRatio.buySellRatio);
      if (t >= 1.3) score += 15;
      else if (t >= 1.05) score += 8;
      else if (t < 0.8) score -= 15;
      else if (t < 0.95) score -= 7;
    }

    // 4. Funding Oranı Etkisi (+-10)
    if (data.funding && data.funding.lastFundingRate !== undefined) {
      const f = parseFloat(data.funding.lastFundingRate) * 100;
      if (f <= 0) score += 10; // Eksi fonlama = shortlar faiz ödüyor = yukarı patlama
      else if (f >= 0.03) score -= 10; // Aşırı pozitif = longlar şişmiş
    }

    // Sınırla [5, 98]
    score = Math.max(5, Math.min(98, Math.round(score)));

    scoreEl.textContent = `${score}%`;
    fillEl.style.width  = `${score}%`;

    let statusText = 'NÖTR / DENGELİ';
    let statusClass = 'neutral';
    let fillGradient = 'linear-gradient(90deg, #f0b90b, #0ecb81)';

    if (score >= 80) {
      statusText = '🦁 AŞIRI BOĞA (SHORT SQUEEZE POTANSİYELİ)';
      statusClass = 'bull-extreme';
      fillGradient = 'linear-gradient(90deg, #0ecb81, #00f0ff)';
    } else if (score >= 65) {
      statusText = '🟢 BOĞA AĞIRLIKLI BİRİKİM';
      statusClass = 'bull';
      fillGradient = 'linear-gradient(90deg, #f0b90b, #0ecb81)';
    } else if (score <= 25) {
      statusText = '🔴 AŞIRI AYI / SERT SATIŞ BASKISI';
      statusClass = 'bear-extreme';
      fillGradient = 'linear-gradient(90deg, #f6465d, #b3002d)';
    } else if (score <= 40) {
      statusText = '🐻 AYI AĞIRLIKLI DAĞITIM';
      statusClass = 'bear';
      fillGradient = 'linear-gradient(90deg, #f0b90b, #f6465d)';
    } else {
      statusText = '⚖️ DENGELİ / YÖN ARAYIŞI';
      statusClass = 'neutral';
      fillGradient = 'linear-gradient(90deg, #848e9c, #f0b90b)';
    }

    fillEl.style.background = fillGradient;
    badgeEl.textContent = statusText;
    badgeEl.className   = `smi-status-badge ${statusClass}`;
  }

  // ── Canlı Balina & Likidasyon Radarı Listesi ────────────────
  function _addRadarItem(item) {
    radarItems.unshift(item);
    if (radarItems.length > MAX_RADAR_ITEMS) {
      radarItems.pop();
    }
    _renderRadar();
  }

  function _renderRadar() {
    const listEl = document.getElementById('whale-radar-list');
    if (!listEl) return;

    if (!radarItems.length) {
      listEl.innerHTML = '<div class="whale-item empty">Büyük işlemler dinleniyor...</div>';
      return;
    }

    const fmtMoney = v => {
      if (v >= 1e6) return `$${(v/1e6).toFixed(2)}M`;
      if (v >= 1e3) return `$${(v/1e3).toFixed(1)}K`;
      return `$${v.toFixed(0)}`;
    };

    const fmtTime = ts => {
      const d = new Date(ts);
      return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
    };

    const fmtPrice = p => {
      if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
        return PriceFormatter.format(p);
      }
      return String(p);
    };

    listEl.innerHTML = radarItems.map(item => {
      const isBuy  = item.type === 'buy';
      const isLiq  = item.type === 'liq';
      const badgeCls = isLiq ? 'badge-liq' : isBuy ? 'badge-buy' : 'badge-sell';
      const amtStr = fmtMoney(item.val);
      const timeStr = fmtTime(item.time);
      const prcStr = fmtPrice(item.price);

      return `
        <div class="whale-item ${badgeCls}">
          <span class="whale-time">${timeStr}</span>
          <span class="whale-badge">${item.title}</span>
          <span class="whale-amt">${amtStr}</span>
          <span class="whale-price">@${prcStr}</span>
        </div>
      `;
    }).join('');
  }

  return { init };
})();
