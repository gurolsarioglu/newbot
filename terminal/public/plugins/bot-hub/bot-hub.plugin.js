/**
 * bot-hub.plugin.js — Çoklu Bot & Sinyal İstasyonu (Multi-Bot Station)
 * Hammer Pro, M1 Premium, M1-A, FR, Divergence ve V3-A (Hacim) motorları.
 * Dikey metalik bot şeridi ve interaktif sinyal kartları.
 */
const BotHubPlugin = (() => {
  let activeBot = 'hammerproplus'; // Hammer Pro Plus Botu aktif
  let hammerProPlusSignals = [];
  let hammerSignals = [];
  let m1Signals = [];
  let m1aSignals = [];
  let frSignals = [];
  let divSignals = [];
  let v3Signals = [];
  let fourSSignals = [];
  let fourSSniperSignals = [];
  let pollInterval = null;

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
    v3: {
      id: 'v3',
      title: 'V3-A',
      subtitle: 'Real-time volume monitoring',
      iconClass: 'green',
      iconText: 'V3',
      summaryStats: 'Real-time Volume Inflow  |  24h Base Volume  |  Instant Spikes',
    },
    div: {
      id: 'div',
      title: 'Divergence',
      subtitle: 'Momentum and price relationship analysis',
      iconClass: 'hammer',
      iconText: 'DIV',
      summaryStats: '1H RSI Divergence  |  RSI-SMA Crosses  |  1h/4h/1d HTF',
    },
    fr: {
      id: 'fr',
      title: 'FR',
      subtitle: 'Funding rate perspective, simulation & arbitrage alerts',
      iconClass: 'cyan',
      iconText: 'FR',
      summaryStats: 'Funding Flip: + to - ⚠️  |  Negative Rate Squeeze Watch',
    },
    m1a: {
      id: 'm1a',
      title: 'M1-A',
      subtitle: 'Focused insight on the smallest timeframe',
      iconClass: 'gold',
      iconText: 'M1',
      summaryStats: 'BTC Status: Normal  |  Stochastic (K/D) Tracking  |  Micro Drops',
    },
    m1premium: {
      id: 'm1premium',
      title: 'M1 Premium',
      subtitle: 'Enhanced minute-level analytics & divergence',
      iconClass: 'gold',
      iconText: 'M1P',
      summaryStats: 'Avg Boost: +1.56%  |  RSI 1m: >70 ❗  |  Div: 1m ✅',
    },
    hammerpro: {
      id: 'hammerpro',
      title: 'Hammer Pro',
      subtitle: 'Automated pattern analysis & reversal scanner',
      iconClass: 'hammer',
      iconText: '🔨',
      summaryStats: 'SRS: 1m.29 | 5m.0 ❗ | 1h.7 ❗  |  WT: 1m 🟢',
    }
  };

  async function fetchSignals() {
    try {
      const [hRes, hpRes, mRes, aRes, fRes, dRes, vRes, sRes, snRes] = await Promise.all([
        fetch('/api/signals?bot=hammerpro'),
        fetch('/api/signals?bot=hammerproplus'),
        fetch('/api/signals?bot=m1premium'),
        fetch('/api/signals?bot=m1a'),
        fetch('/api/signals?bot=fr'),
        fetch('/api/signals?bot=div'),
        fetch('/api/signals?bot=v3'),
        fetch('/api/signals?bot=4s'),
        fetch('/api/signals?bot=4ssniper')
      ]);

      if (hRes.ok) {
        const d = await hRes.json();
        hammerSignals = d.signals || [];
      }
      if (hpRes.ok) {
        const d = await hpRes.json();
        hammerProPlusSignals = d.signals || [];
      }
      if (mRes.ok) {
        const d = await mRes.json();
        m1Signals = d.signals || [];
      }
      if (aRes.ok) {
        const d = await aRes.json();
        m1aSignals = d.signals || [];
      }
      if (fRes.ok) {
        const d = await fRes.json();
        frSignals = d.signals || [];
      }
      if (dRes.ok) {
        const d = await dRes.json();
        divSignals = d.signals || [];
      }
      if (vRes.ok) {
        const d = await vRes.json();
        v3Signals = d.signals || [];
      }
      if (sRes.ok) {
        const d = await sRes.json();
        fourSSignals = d.signals || [];
      }
      if (snRes.ok) {
        const d = await snRes.json();
        fourSSniperSignals = d.signals || [];
      }
      updateBadgeCounts();
      renderFeed();
    } catch (e) {
      console.warn('[BotHub] fetch signals error:', e);
    }
  }

  function updateBadgeCounts() {
    const counts = {
      hammerpro: hammerSignals.length,
      hammerproplus: hammerProPlusSignals.length,
      m1premium: m1Signals.length,
      m1a: m1aSignals.length,
      fr: frSignals.length,
      div: divSignals.length,
      v3: v3Signals.length,
      '4s': fourSSignals.length,
      '4ssniper': fourSSniperSignals.length
    };

    document.querySelectorAll('.bot-badge-btn').forEach(btn => {
      const b = btn.dataset.bot;
      if (b && counts[b] !== undefined) {
        let badge = btn.querySelector('.bot-count-badge');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'bot-count-badge';
          btn.appendChild(badge);
        }
        badge.textContent = counts[b];
        badge.title = `${counts[b]} Aktif Sinyal`;
      }
    });
  }

  function renderFeed() {
    const listEl = document.getElementById('bot-signals-scroll');
    if (!listEl) return;

    let signals = [];
    if (activeBot === 'hammerproplus') signals = hammerProPlusSignals;
    else if (activeBot === '4ssniper') signals = fourSSniperSignals;
    else if (activeBot === '4s') signals = fourSSignals;
    else if (activeBot === 'v3') signals = v3Signals;
    else if (activeBot === 'div') signals = divSignals;
    else if (activeBot === 'fr') signals = frSignals;
    else if (activeBot === 'm1a') signals = m1aSignals;
    else if (activeBot === 'm1premium') signals = m1Signals;
    else signals = hammerSignals;

    if (!signals.length) {
      listEl.innerHTML = `<div style="text-align:center;color:#64748b;padding:20px;">Sinyal taranıyor...</div>`;
      return;
    }

    if (typeof BotRenderer !== 'undefined') {
      listEl.innerHTML = BotRenderer.generateSignalsHtml(activeBot, signals);
    }
  }

  function switchBot(botId) {
    activeBot = botId;
    const cfg = (typeof BotRenderer !== 'undefined' && BotRenderer.BOT_CONFIGS[botId])
      ? BotRenderer.BOT_CONFIGS[botId]
      : (BOT_CONFIGS[botId] || BOT_CONFIGS.v3);

    // Başlık ve İkon Güncelle
    const titleEl = document.getElementById('bot-header-title');
    const subEl = document.getElementById('bot-header-subtitle');
    const iconEl = document.getElementById('bot-header-icon');
    const statsEl = document.getElementById('bot-summary-stats');

    if (titleEl) titleEl.textContent = cfg.title;
    if (subEl) subEl.textContent = cfg.subtitle;
    if (iconEl) {
      if (cfg.iconHtml) {
        iconEl.innerHTML = cfg.iconHtml;
      } else {
        iconEl.textContent = cfg.iconText;
      }
      iconEl.className = 'bot-header-icon ' + (cfg.iconClass || '');
    }
    if (statsEl) statsEl.textContent = cfg.summaryStats;

    // Şerit butonlarının aktifliğini güncelle
    document.querySelectorAll('.bot-badge-btn').forEach(btn => {
      if (btn.dataset.bot === botId) btn.classList.add('active');
      else btn.classList.remove('active');
    });

    renderFeed();
  }

  function init() {
    // Sinyal listesinde herhangi bir karta tıklandığında sol grafikleri o coine geçir!
    const scrollEl = document.getElementById('bot-signals-scroll');
    if (scrollEl) {
      scrollEl.addEventListener('click', (e) => {
        const card = e.target.closest('.signal-card');
        if (!card) return;
        const sym = card.dataset.symbol;
        if (sym) {
          if (typeof WatchlistPlugin !== 'undefined') {
            WatchlistPlugin.setActiveSymbol(sym);
          }
          if (typeof BotRenderer !== 'undefined') {
            BotRenderer.broadcastSymbol(sym);
          }
        }
      });
    }

    // Şeritteki butonlara tıklama (Tek tık: Seç | Çift tık: 2. Ekrana Pencere Olarak Aç)
    document.querySelectorAll('.bot-badge-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const botId = btn.dataset.bot;
        if (botId) {
          switchBot(botId);
        }
      });

      btn.addEventListener('dblclick', () => {
        const botId = btn.dataset.bot;
        if (botId && typeof BotRenderer !== 'undefined') {
          BotRenderer.openBotWindow(botId);
        }
      });
    });

    // 2. Ekrana Pop-out Butonları
    const btnPopout = document.getElementById('btn-popout-active-bot');
    if (btnPopout) {
      btnPopout.addEventListener('click', () => {
        if (typeof BotRenderer !== 'undefined') {
          BotRenderer.openBotWindow(activeBot);
        }
      });
    }

    const btnPopoutAll = document.getElementById('btn-popout-all-bots');
    if (btnPopoutAll) {
      btnPopoutAll.addEventListener('click', () => {
        if (typeof BotRenderer !== 'undefined') {
          BotRenderer.openAllBotWindows();
        }
      });
    }

    switchBot(activeBot);
    fetchSignals();
    pollInterval = setInterval(fetchSignals, 4000);
  }

  return {
    init,
    switchBot,
    getActiveBot: () => activeBot
  };
})();
