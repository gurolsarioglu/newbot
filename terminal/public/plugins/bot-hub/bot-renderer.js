/**
 * bot-renderer.js — Çoklu Ekran (Multi-Monitor) ve Bot Kartları Ortak Motoru
 * Alpha Terminal
 *
 * Özellikler:
 * 1. 9 Botun (M1-A, M1P, FR, V3, Hammer Pro, Pro+, 4S, 4S Sniper, DIV) tüm görsel kart şablonlarını ve konfigürasyonunu merkezi yönetir.
 * 2. Çift Ekran (Dual Monitor) Canlı Senkronizasyonu (BroadcastChannel):
 *    - 2. ekrandaki bir karta tıklandığında 1. ekrandaki 4'lü grafik kokpitini anında o coine kilitler.
 * 3. Bağımsız Pop-out Pencereleri Yönetimi: İstenen botu veya tüm botları 2. ekrana serbest boyutlandırılabilir (resizable) pencerelerde açar.
 */

const BotRenderer = (() => {
  const CHANNEL_NAME = 'alpha_terminal_sync_channel';
  let channel = null;

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(CHANNEL_NAME);
    }
  } catch (e) {
    console.warn('[BotRenderer] BroadcastChannel desteklenmiyor:', e);
  }

  const BOT_CONFIGS = {
    'hammerproplus': {
      id: 'hammerproplus',
      title: 'Hammer Pro Plus',
      subtitle: 'Advanced structural pattern framework',
      iconClass: 'proplus',
      iconHtml: '<span style="font-size:11px;">🔨</span><span style="font-size:6px;font-weight:900;color:#fdba74;line-height:1;">PRO+</span>',
      iconText: '🔨+',
      summaryStats: 'Advanced structural pattern framework  |  Today',
    },
    '4ssniper': {
      id: '4ssniper',
      title: '4S Sniper',
      subtitle: 'Multi-angle view of the 4H structure',
      iconClass: 'bronze',
      iconText: '4S',
      summaryStats: 'Multi-angle view of the 4H structure  |  Today',
    },
    '4s': {
      id: '4s',
      title: '4S',
      subtitle: 'Multi-angle view of the 4H structure',
      iconClass: 'red',
      iconText: '4S',
      summaryStats: 'Multi-angle view of the 4H structure  |  Today',
    },
    'v3': {
      id: 'v3',
      title: 'V3-A',
      subtitle: 'Real-time volume monitoring',
      iconClass: 'green',
      iconText: 'V3',
      summaryStats: 'Real-time Volume Inflow  |  24h Base Volume  |  Instant Spikes',
    },
    'div': {
      id: 'div',
      title: 'Divergence',
      subtitle: 'Momentum and price relationship analysis',
      iconClass: 'div',
      iconText: 'DIV',
      summaryStats: '1H RSI Divergence  |  RSI-SMA Crosses  |  1h/4h/1d HTF',
    },
    'fr': {
      id: 'fr',
      title: 'FR',
      subtitle: 'Funding rate perspective, simulation & arbitrage alerts',
      iconClass: 'cyan',
      iconText: 'FR',
      summaryStats: 'Funding Flip: + to - ⚠️  |  Negative Rate Squeeze Watch',
    },
    'm1a': {
      id: 'm1a',
      title: 'M1-A',
      subtitle: 'Focused insight on the smallest timeframe',
      iconClass: 'gold',
      iconText: 'M1-A',
      summaryStats: 'BTC Status: Normal  |  Stochastic (K/D) Tracking  |  Micro Drops',
    },
    'm1premium': {
      id: 'm1premium',
      title: 'M1 Premium',
      subtitle: 'Enhanced minute-level analytics & divergence',
      iconClass: 'gold',
      iconText: 'M1P',
      summaryStats: 'Avg Boost: +1.56%  |  RSI 1m: >70 ❗  |  Div: 1m ✅',
    },
    'hammerpro': {
      id: 'hammerpro',
      title: 'Hammer Pro',
      subtitle: 'Automated pattern analysis & reversal scanner',
      iconClass: 'hammer',
      iconText: '🔨',
      summaryStats: 'SRS: 1m.29 | 5m.0 ❗ | 1h.7 ❗  |  WT: 1m 🟢',
    }
  };

  /**
   * Çift Ekran Senkronizasyonu: Coini tüm açık pencerelere yayınlar
   */
  function broadcastSymbol(symbol) {
    if (!symbol) return;
    const clean = symbol.toUpperCase();

    if (channel) {
      try {
        channel.postMessage({ type: 'SELECT_SYMBOL', symbol: clean, ts: Date.now() });
      } catch (err) {}
    }

    if (window.opener && !window.opener.closed) {
      try {
        window.opener.postMessage({ type: 'SELECT_SYMBOL', symbol: clean }, '*');
      } catch (err) {}
    }

    try {
      localStorage.setItem('alpha_active_symbol_broadcast', JSON.stringify({ symbol: clean, ts: Date.now() }));
    } catch (e) {}

    // 4. Backend HTTP Sync (Farklı profil / izole pencereler için)
    try {
      fetch(`/api/sync/active-symbol?symbol=${encodeURIComponent(clean)}`).catch(() => {});
    } catch (_) {}
  }

  /**
   * Çift Ekran Senkronizasyonu Dinleyicisi
   */
  function onSymbolBroadcast(callback) {
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data && event.data.type === 'SELECT_SYMBOL' && event.data.symbol) {
          callback(event.data.symbol);
        }
      };
    }

    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'SELECT_SYMBOL' && event.data.symbol) {
        callback(event.data.symbol);
      }
    });

    window.addEventListener('storage', (e) => {
      if (e.key === 'alpha_active_symbol_broadcast' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.symbol) callback(parsed.symbol);
        } catch (err) {}
      }
    });

    // Farklı browser/profil pencereleri arası HTTP sync dinleyicisi
    let lastKnownTs = Date.now();
    setInterval(async () => {
      try {
        const res = await fetch('/api/sync/active-symbol');
        if (res.ok) {
          const data = await res.json();
          if (data && data.ts && data.ts > lastKnownTs && data.symbol) {
            lastKnownTs = data.ts;
            callback(data.symbol);
          }
        }
      } catch (_) {}
    }, 1000);
  }

  /**
   * İkinci ekranda bağımsız boyutlandırılabilir bot penceresi açar
   */
  function openBotWindow(botId = 'div') {
    const cleanId = (botId || 'div').toLowerCase();
    const cfg = BOT_CONFIGS[cleanId] || BOT_CONFIGS.div;
    const w = 460;
    const h = 820;

    const screenW = window.screen.availWidth || 1920;
    const left = screenW > 1920 ? (screenW / 2) + 60 : screenW + 40;
    const top = 60;
    const winName = 'AlphaBotWindow_' + cleanId;

    const win = window.open(
      `/bot-window.html?bot=${cleanId}`,
      winName,
      `popup=yes,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},left=${left},top=${top}`
    );

    if (win) {
      try { win.focus(); } catch (_) {}
    } else {
      alert('Pencere açılması tarayıcınız tarafından engellendi. Lütfen adres çubuğundaki kilit/açılır pencere simgesinden "Her zaman izin ver"i seçin.');
    }
    return win;
  }

  /**
   * Tüm 9 botu 2. ekranda basamaklı/ayrı pencereler olarak açar
   */
  function openAllBotWindows() {
    const botKeys = ['div', '4ssniper', 'v3', 'hammerproplus', 'm1a', 'm1premium', 'fr', '4s', 'hammerpro'];
    const screenW = window.screen.availWidth || 1920;

    botKeys.forEach((key, idx) => {
      const w = 430;
      const h = 760;
      const left = screenW + (idx * 35);
      const top = 50 + (idx * 25);
      const win = window.open(
        `/bot-window.html?bot=${key}`,
        'AlphaBotWindow_' + key,
        `popup=yes,toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${w},height=${h},left=${left},top=${top}`
      );
      if (win) {
        try { win.focus(); } catch (_) {}
      }
    });
  }

  /**
   * Sinyal tarih ve saatini deterministik olarak gün.ay.yıl saat:dakika formatlar.
   * Format: "DD.MM.YYYY HH:mm" (Örn: "13.10.2026 15:25" veya "07.10.2026 17:30")
   */
  function formatSignalDateTime(s) {
    if (!s) return '';

    let datePart = '';
    let timePart = '';

    // 1. Tarih tespiti (gün.ay.yıl - DD.MM.YYYY)
    if (s.dateStr && /^\d{2}\.\d{2}\.\d{4}$/.test(s.dateStr)) {
      datePart = s.dateStr;
    } else if (s.timestamp) {
      const d = new Date(Number(s.timestamp));
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        datePart = `${dd}.${mm}.${yyyy}`;
      }
    } else if (s.isoDate) {
      const d = new Date(s.isoDate);
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        datePart = `${dd}.${mm}.${yyyy}`;
      }
    }

    if (!datePart && s.dateLabel && /^\d{2}\.\d{2}\.\d{4}$/.test(s.dateLabel)) {
      datePart = s.dateLabel;
    }

    if (!datePart) {
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yyyy = now.getFullYear();
      datePart = `${dd}.${mm}.${yyyy}`;
    }

    // 2. Saat tespiti (SS:DD - HH:mm)
    if (s.time && typeof s.time === 'string' && /^\d{1,2}:\d{2}/.test(s.time)) {
      timePart = s.time.trim();
    } else if (s.timestamp) {
      const d = new Date(Number(s.timestamp));
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timePart = `${hh}:${min}`;
      }
    } else if (s.isoDate) {
      const d = new Date(s.isoDate);
      if (!isNaN(d.getTime())) {
        const hh = String(d.getHours()).padStart(2, '0');
        const min = String(d.getMinutes()).padStart(2, '0');
        timePart = `${hh}:${min}`;
      }
    } else {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      timePart = `${hh}:${min}`;
    }

    if (datePart && timePart) {
      return `${datePart} ${timePart}`;
    }
    return datePart || timePart || '';
  }

  function getSignalDateLabel(s) {
    if (!s) return '';
    if (s.dateStr && /^\d{2}\.\d{2}\.\d{4}$/.test(s.dateStr)) return s.dateStr;
    if (s.timestamp) {
      const d = new Date(Number(s.timestamp));
      if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const yyyy = d.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
      }
    }
    if (s.dateLabel) return s.dateLabel;
    return '';
  }

  /**
   * Verilen botId ve sinyal listesi için tam HTML kartlarını üretir
   */
  function generateSignalsHtml(botId, signals) {
    if (!signals || !signals.length) {
      return `<div style="text-align:center;color:#64748b;padding:24px;font-size:12px;">Sinyal taranıyor...</div>`;
    }

    // ─── 1. Hammer Pro Plus ──────────────────────────────────────────
    if (botId === 'hammerproplus') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const dot = s.dot || '🟢';
        const titleColor = '#38bdf8';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${titleColor}; font-weight:700;">
                ${dot} <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span> ${s.stars ? `<span class="card-star" style="color:#fbbf24;margin-left:4px;">${s.stars}</span>` : ''}
              </span>
            </div>
            ${s.strategy ? `
            <div class="card-field-row" style="margin-top: 4px;">
              <span>Strategy:</span>
              <span class="card-field-val" style="color: #fff; font-weight: 700;">${s.strategy}</span>
            </div>` : ''}
            <div class="card-field-row">
              <span>Boost Value:</span>
              <span class="card-field-val" style="color: #0ecb81; font-weight: 700;">${s.boostValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-field-row">
              <span>RSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1m.${s.rsi.m1}</strong> | <strong>5m.${s.rsi.m5}</strong> | <strong>1h.${s.rsi.h1}</strong>
              </span>
            </div>
            <div class="card-field-row">
              <span>SRSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1m.${s.srsi.m1}</strong> | <strong>5m.${s.srsi.m5}</strong> | <strong>1h.${s.srsi.h1}</strong>
              </span>
            </div>
            ${s.wt ? `
            <div class="card-field-row">
              <span>WT:</span>
              <span class="card-field-val" style="font-weight: 600;">${s.wt}</span>
            </div>` : ''}
            ${s.pivot ? `
            <div class="card-field-row">
              <span>Pivot:</span>
              <span class="card-field-val" style="color: #f59e0b; font-weight: 600;">${s.pivot}</span>
            </div>` : ''}
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 2. 4S Sniper ───────────────────────────────────────────────
    if (botId === '4ssniper') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const dot = s.dot || '🟢';
        const titleColor = '#38bdf8';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${titleColor}; font-weight:700;">
                ${dot} <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.displaySymbol || s.symbol}</span>
              </span>
            </div>
            <div class="card-field-row" style="margin-top: 4px;">
              <span>Strategy:</span>
              <span class="card-field-val" style="color: #fff; font-weight: 700;">${s.strategy || 'NW UP'}</span>
            </div>
            <div class="card-field-row">
              <span>Boost Value:</span>
              <span class="card-field-val" style="color: #0ecb81; font-weight: 700;">${s.boostValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-field-row">
              <span>RSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1h.${s.rsi.h1}</strong> | <strong>4h.${s.rsi.h4}</strong> | <strong>1d.${s.rsi.d1}</strong>
              </span>
            </div>
            <div class="card-field-row">
              <span>SRSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1h.${s.srsi.h1}</strong> | <strong>4h.${s.srsi.h4}</strong> | <strong>1d.${s.srsi.d1}</strong>
              </span>
            </div>
            <div class="card-field-row">
              <span>Trader Positioning:</span>
              <span class="card-field-val" style="font-weight: 600;">
                ${s.traderPositioning} <span style="font-size: 10px;">${s.traderDot || '🟢'}</span>
              </span>
            </div>
            <div class="card-field-row">
              <span>Market Exposure:</span>
              <span class="card-field-val" style="font-weight: 600;">
                ${s.marketExposure} <span style="font-size: 10px;">${s.exposureDot || '🟢'}</span>
              </span>
            </div>
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 3. 4S Structure ────────────────────────────────────────────
    if (botId === '4s') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const dot = s.dot || '🔴';
        const titleColor = '#38bdf8';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${titleColor}; font-weight:700;">
                ${dot} <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span>
              </span>
            </div>
            <div class="card-field-row" style="margin-top: 4px;">
              <span>Market:</span>
              <span class="card-field-val" style="color: #94a3b8; font-weight: 600;">${s.market || 'FUTURES'}</span>
            </div>
            <div class="card-field-row">
              <span>Boost Value:</span>
              <span class="card-field-val" style="color: #0ecb81; font-weight: 700;">${s.boostValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-field-row">
              <span>RSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1h.${s.rsi.h1}</strong> | <strong>4h.${s.rsi.h4}</strong> | <strong>1d.${s.rsi.d1}</strong>
              </span>
            </div>
            <div class="card-field-row">
              <span>SRSI:</span>
              <span class="card-field-val" style="font-size: 11px;">
                <strong>1h.${s.srsi.h1}</strong> | <strong>4h.${s.srsi.h4}</strong> | <strong>1d.${s.srsi.d1}</strong>
              </span>
            </div>
            <div class="card-field-row">
              <span>Trader Positioning:</span>
              <span class="card-field-val" style="font-weight: 600;">
                ${s.traderPositioning} <span style="font-size: 10px;">${s.traderDot || '🟢'}</span>
              </span>
            </div>
            <div class="card-field-row">
              <span>Market Exposure:</span>
              <span class="card-field-val" style="font-weight: 600;">
                ${s.marketExposure} <span style="font-size: 10px;">${s.exposureDot || '🟢'}</span>
              </span>
            </div>
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 4. V3-A Hacim ──────────────────────────────────────────────
    if (botId === 'v3') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const isSuperSurge = parseFloat(String(s.hacimChange || '').replace(/[^0-9.]/g, '')) >= 80;

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: #38bdf8; font-weight: 700;">
                <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span> ${isSuperSurge ? '<span title="Ekstrem Hacim Girişi" style="font-size:12px;margin-left:4px;">🔥</span>' : ''}
              </span>
            </div>
            <div class="card-field-row" style="margin-top: 4px;">
              <span>Hacim:</span>
              <span style="color: var(--green); font-weight: 700;">${s.hacimChange}</span>
            </div>
            <div class="card-field-row">
              <span>24s Hacim:</span>
              <span class="card-field-val">${s.hacim24s}</span>
            </div>
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Binance</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 5. Divergence (DIV) ────────────────────────────────────────
    if (botId === 'div') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const dot = s.dot ? `${s.dot} ` : '';
        const titleColor = s.dot === '🔴' ? '#f87171' : '#38bdf8';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${titleColor}; font-weight:700;">
                ${dot}<span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span>
              </span>
            </div>
            <div class="card-field-row">
              <span>Strategy:</span>
              <span style="color: #38bdf8; font-weight: 700;">${s.strategy}</span>
            </div>
            <div class="card-field-row">
              <span>Boost Value:</span>
              <span class="card-boost-val">${s.boostValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-multi-indicator">
              RSI: <strong>1h.${s.rsi.h1}</strong> | <strong>4h.${s.rsi.h4}</strong> | <strong>1d.${s.rsi.d1}</strong>
            </div>
            <div class="card-multi-indicator">
              SRSI: <strong>1h.${s.srsi.h1}</strong> | <strong>4h.${s.srsi.h4}</strong> | <strong>1d.${s.srsi.d1}</strong>
            </div>
            ${s.pivot ? `
              <div class="card-alert-line">
                <span>Pivot: ${s.pivot}</span>
              </div>
            ` : ''}
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 6. Funding Rate (FR) ───────────────────────────────────────
    if (botId === 'fr') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const dot = s.dot ? `${s.dot} ` : '';
        const titleColor = s.dot === '🔴' ? '#f87171' : '#38bdf8';
        const cleanAlert = s.alertText ? String(s.alertText).replace(/^[⚠️\s]+/, '').trim() : '';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${titleColor}; font-weight: 700;">
                ${dot}<span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span>
              </span>
            </div>
            ${cleanAlert ? `
              <div class="card-alert-line" style="color: #fbbf24; margin-bottom: 5px; font-size: 11px;">
                <span>⚠️ ${cleanAlert}</span>
              </div>
            ` : ''}
            <div class="card-field-row">
              <span>Funding Rate:</span>
              <span class="card-field-val" style="color: ${String(s.fundingRate).startsWith('-') ? 'var(--red)' : 'var(--green)'}; font-weight:700;">
                ${s.fundingRate}
              </span>
            </div>
            ${s.previousFunding !== undefined ? `
              <div class="card-field-row">
                <span>Previous Funding:</span>
                <span class="card-field-val">${s.previousFunding}</span>
              </div>
            ` : ''}
            ${s.difference !== undefined ? `
              <div class="card-field-row">
                <span>Difference:</span>
                <span class="card-field-val" style="color: ${String(s.difference).startsWith('-') ? 'var(--red)' : 'var(--text-main)'}; font-weight:600;">
                  ${s.difference}
                </span>
              </div>
            ` : ''}
            <div class="card-field-row" style="margin-top: 2px;">
              <span>Time Remaining:</span>
              <span style="color: #94a3b8; font-weight: 600;">${s.timeRemaining}</span>
            </div>
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 7. M1-A Micro Drop ─────────────────────────────────────────
    if (botId === 'm1a') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }
        const isDrop = (s.type === 'drop') || (s.dropValue && s.dropValue.startsWith('-'));
        const dot = isDrop ? '🔴' : '🟢';
        const valColor = isDrop ? 'var(--red)' : 'var(--green)';
        const label = isDrop ? 'Drop Value:' : 'Boost Value:';

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: ${isDrop ? '#f87171' : '#38bdf8'}; font-weight: 700;">
                ${dot} <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span>
              </span>
            </div>
            <div class="card-field-row">
              <span>${label}</span>
              <span style="color: ${valColor}; font-weight: 700;">${s.dropValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Volume:</span>
              <span style="color: ${typeof s.volume === 'string' && s.volume.startsWith('-') ? 'var(--red)' : 'var(--green)'}; font-weight: 600;">
                ${typeof s.volume === 'object' && s.volume ? (s.volume.m1 || JSON.stringify(s.volume)) : (s.volume || '—')}
              </span>
            </div>
            <div class="card-field-row">
              <span>RSI:</span>
              <span style="font-weight: 700; color: ${typeof s.rsi === 'string' && s.rsi.includes('77') ? 'var(--gold)' : 'var(--text-main)'};">
                ${typeof s.rsi === 'object' && s.rsi ? (s.rsi.h1 || s.rsi.m1 || JSON.stringify(s.rsi)) : (s.rsi || '—')}
              </span>
            </div>
            <div class="card-field-row">
              <span>Stochastic (K/D):</span>
              <span style="font-weight: 700; color: #fff;">${s.stochastic}</span>
            </div>
            <div class="card-field-row">
              <span>BTC Status:</span>
              <span style="color: #94a3b8; font-weight: 600;">${s.btcStatus || 'Normal'}</span>
            </div>
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 8. M1 Premium ──────────────────────────────────────────────
    if (botId === 'm1premium') {
      let html = '';
      let lastDate = null;

      signals.forEach(s => {
        const dateTag = getSignalDateLabel(s);
        if (dateTag && dateTag !== lastDate) {
          lastDate = dateTag;
          html += `<div class="signal-date-divider"><span>${lastDate}</span></div>`;
        }

        html += `
          <div class="signal-card" data-symbol="${s.symbol}">
            <div class="card-top-row">
              <span class="card-symbol" style="color: #38bdf8; font-weight: 700;">
                🟢 <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span> ${s.isFavorite ? '<span class="card-star" style="color:#fbbf24;margin-left:4px;">⭐</span>' : ''}
              </span>
            </div>
            <div class="card-field-row">
              <span>Boost Value:</span>
              <span class="card-boost-val">${s.boostValue}</span>
            </div>
            <div class="card-field-row">
              <span>Current Price:</span>
              <span class="card-field-val">${s.currentPrice}</span>
            </div>
            <div class="card-field-row">
              <span>Previous Price:</span>
              <span class="card-field-val">${s.prevPrice}</span>
            </div>
            <div class="card-multi-indicator">
              RSI: <strong>1m.${s.rsi.m1}</strong> | <strong>5m.${s.rsi.m5}</strong> | <strong>1h.${s.rsi.h1}</strong>
            </div>
            <div class="card-multi-indicator">
              SRSI: <strong>1m.${s.srsi.m1}</strong> | <strong>5m.${s.srsi.m5}</strong> | <strong>1h.${s.srsi.h1}</strong>
            </div>
            ${s.divergence ? `
              <div class="card-alert-line" style="color:var(--green);">
                <span>Divergence: ${s.divergence}</span>
              </div>
            ` : ''}
            <div class="card-footer">
              <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
              <span class="card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>
        `;
      });
      return html;
    }

    // ─── 9. Hammer Pro (#W1 Reversal) ───────────────────────────────
    return signals.map(s => `
      <div class="signal-card" data-symbol="${s.symbol}">
        <div class="card-top-row">
          <span class="card-symbol">🟢 <span class="card-coin-tag" data-coin="${s.symbol}" title="Son 60 günlük sinyal geçmişini aç">#${s.symbol}</span></span>
        </div>
        <div class="card-field-row">
          <span>Strategy:</span>
          <span style="color:#38bdf8;font-weight:700;">${s.strategy}</span>
        </div>
        <div class="card-field-row">
          <span>Boost Value:</span>
          <span class="card-boost-val">${s.boostValue}</span>
        </div>
        <div class="card-field-row">
          <span>Current Price:</span>
          <span class="card-field-val">${s.currentPrice}</span>
        </div>
        <div class="card-field-row">
          <span>Previous Price:</span>
          <span class="card-field-val">${s.prevPrice}</span>
        </div>
        <div class="card-multi-indicator">
          RSI: <strong>1m.${s.rsi.m1}</strong> | <strong>5m.${s.rsi.m5}</strong> | <strong>1h.${s.rsi.h1}</strong>
        </div>
        <div class="card-multi-indicator">
          SRSI: <strong>1m.${s.srsi.m1}</strong> | <strong>5m.${s.srsi.m5}</strong> | <strong>1h.${s.srsi.h1}</strong>
        </div>
        <div class="card-field-row" style="margin-top:3px;">
          <span>WT:</span>
          <span style="font-weight:700;">${s.wt || '—'}</span>
        </div>
        ${s.pivot ? `
          <div class="card-alert-line">
            <span>Pivot: ${s.pivot}</span>
          </div>
        ` : ''}
        ${s.ema200 ? `
          <div class="card-alert-line">
            <span>4H.E200: ${s.ema200}</span>
          </div>
        ` : ''}
        <div class="card-footer">
          <span class="card-link-icon" title="1. Ekranda Aç">↗ Grafikte Göster</span>
          <span class="card-time">${formatSignalDateTime(s)}</span>
        </div>
      </div>
    `).join('');
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (e) => {
      const coinTag = e.target.closest('.card-coin-tag');
      if (coinTag) {
        e.preventDefault();
        e.stopPropagation();
        const coin = coinTag.dataset.coin;
        if (coin && typeof CoinHistoryModal !== 'undefined') {
          CoinHistoryModal.open(coin);
        }
      }
    }, true);
  }

  return {
    BOT_CONFIGS,
    broadcastSymbol,
    onSymbolBroadcast,
    openBotWindow,
    openAllBotWindows,
    generateSignalsHtml,
    formatSignalDateTime,
    getSignalDateLabel
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BotRenderer;
}
