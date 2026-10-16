/**
 * coin-history-modal.js — Seçili Coin Son 60 Günlük Sinyal Geçmişi Modalı
 * Alpha Terminal
 * 
 * Sinyal kartlarındaki #COIN_ADI tıklandığında açılır.
 * O coine son 60 gün içinde tüm 9 bot tarafından üretilen tüm sinyalleri
 * tarih tarih, eksiksiz fiyat ve indikatör değerleriyle listeler.
 */

const CoinHistoryModal = (() => {
  let modalEl = null;
  let currentSymbol = '';
  let abortController = null;

  const BOT_ICONS = {
    hammerproplus: { icon: '🔨+', name: 'Hammer Pro Plus', color: '#fdba74' },
    hammerpro:     { icon: '🔨',  name: 'Hammer Pro',      color: '#fb923c' },
    '4ssniper':    { icon: '🎯',  name: '4S Sniper',        color: '#ca8a04' },
    '4s':          { icon: '🛡️', name: '4S Structure',    color: '#f87171' },
    v3:            { icon: '📊',  name: 'V3-A Volume',      color: '#34d399' },
    div:           { icon: '📐',  name: 'Divergence',       color: '#38bdf8' },
    fr:            { icon: '💰',  name: 'Funding Rate',     color: '#22d3ee' },
    m1a:           { icon: '🔴',  name: 'M1-A Drop',        color: '#f43f5e' },
    m1premium:     { icon: '⚡',  name: 'M1 Premium',       color: '#facc15' }
  };

  function formatSignalDateTime(s) {
    if (typeof BotRenderer !== 'undefined' && typeof BotRenderer.formatSignalDateTime === 'function') {
      return BotRenderer.formatSignalDateTime(s);
    }
    if (!s) return '';
    const datePart = s.dateStr || (s.timestamp ? new Date(Number(s.timestamp)).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    const timePart = s.time || (s.timestamp ? new Date(Number(s.timestamp)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '');
    if (datePart && timePart) return `${datePart} ${timePart}`;
    return datePart || timePart || '';
  }

  function ensureModalDOM() {
    if (modalEl) return modalEl;

    modalEl = document.getElementById('coin-history-modal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'coin-history-modal';
      modalEl.className = 'ch-modal-backdrop hidden';
      modalEl.innerHTML = `
        <div class="ch-modal-box">
          <header class="ch-modal-header">
            <div class="ch-header-title-wrap">
              <span class="ch-header-icon">📜</span>
              <div>
                <h3 class="ch-header-title" id="ch-modal-title">#COIN — Son 60 Günlük Sinyal Geçmişi</h3>
                <span class="ch-header-subtitle" id="ch-modal-subtitle">Tüm botların arşivlenmiş geçmiş kayıtları</span>
              </div>
            </div>
            <div class="ch-header-actions">
              <span class="ch-count-badge" id="ch-modal-badge">0 Sinyal</span>
              <button class="ch-close-btn" id="ch-btn-close" title="Kapat (ESC)">✕</button>
            </div>
          </header>

          <div class="ch-stats-bar" id="ch-stats-bar">
            <!-- Dinamik bot dağılım rozetleri -->
          </div>

          <main class="ch-modal-body" id="ch-modal-content">
            <div class="ch-loading">Geçmiş sinyaller yükleniyor...</div>
          </main>
        </div>
      `;
      document.body.appendChild(modalEl);

      // Event listener'lar
      const closeBtn = modalEl.querySelector('#ch-btn-close');
      if (closeBtn) closeBtn.addEventListener('click', close);

      modalEl.addEventListener('click', (e) => {
        if (e.target === modalEl) close();
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
          close();
        }
      });
    }

    return modalEl;
  }

  async function open(symbol) {
    if (!symbol) return;
    currentSymbol = symbol.toUpperCase().trim();
    ensureModalDOM();

    const titleEl = document.getElementById('ch-modal-title');
    const badgeEl = document.getElementById('ch-modal-badge');
    const statsBar = document.getElementById('ch-stats-bar');
    const contentEl = document.getElementById('ch-modal-content');

    if (titleEl) titleEl.textContent = `#${currentSymbol} — Son 60 Günlük Sinyal Geçmişi`;
    if (badgeEl) badgeEl.textContent = 'Yükleniyor...';
    if (statsBar) statsBar.innerHTML = '';
    if (contentEl) contentEl.innerHTML = '<div class="ch-loading">60 günlük arşiv verisi çekiliyor...</div>';

    modalEl.classList.remove('hidden');

    if (abortController) abortController.abort();
    abortController = new AbortController();

    try {
      const res = await fetch(`/api/signals/coin-history?symbol=${currentSymbol}&days=60`, {
        signal: abortController.signal
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      renderHistory(data);
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[CoinHistoryModal] Veri çekme hatası:', err);
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="ch-empty">
            <span style="font-size:32px;">⚠️</span>
            <p>Geçmiş sinyaller yüklenirken hata oluştu.</p>
            <small style="color:#64748b;">${err.message}</small>
          </div>
        `;
      }
    }
  }

  function renderHistory(data) {
    const badgeEl = document.getElementById('ch-modal-badge');
    const statsBar = document.getElementById('ch-stats-bar');
    const contentEl = document.getElementById('ch-modal-content');

    const signals = data.signals || [];
    const stats = data.stats || {};

    if (badgeEl) {
      badgeEl.textContent = `${signals.length} Sinyal`;
    }

    // İstatistik ve Dağılım Bandı
    if (statsBar && stats.botDistribution) {
      let pillsHtml = '';
      const dist = stats.botDistribution;
      Object.keys(dist).forEach(bName => {
        pillsHtml += `<span class="ch-bot-pill"><strong>${bName}:</strong> ${dist[bName]}</span>`;
      });
      if (stats.firstSignal && stats.lastSignal) {
        pillsHtml += `<span class="ch-date-range">📅 ${stats.firstSignal} ➔ ${stats.lastSignal}</span>`;
      }
      statsBar.innerHTML = pillsHtml || '<span style="color:#64748b;font-size:11px;">Son 60 günde sinyal bulunuyor</span>';
    }

    if (!signals.length) {
      if (contentEl) {
        contentEl.innerHTML = `
          <div class="ch-empty">
            <span style="font-size:32px;">📭</span>
            <p><strong>#${currentSymbol}</strong> için son 60 günde kayıtlı sinyal bulunamadı.</p>
            <small style="color:#64748b;">Yeni sinyaller oluştukça bu panelde kronolojik olarak listelenecektir.</small>
          </div>
        `;
      }
      return;
    }

    // Tarihe Göre Gruplama
    let html = '';
    let lastDate = null;

    signals.forEach(s => {
      const dateLabel = s.dateStr || s.dateLabel || 'Tarih Belirtilmedi';
      if (dateLabel !== lastDate) {
        lastDate = dateLabel;
        html += `<div class="ch-date-separator"><span>📅 ${lastDate}</span></div>`;
      }

      const botMeta = BOT_ICONS[s.botId] || { icon: '🤖', name: s.botName || s.botId, color: '#38bdf8' };
      const dot = s.dot || '🟢';
      const curPrice = (typeof PriceFormatter !== 'undefined') ? PriceFormatter.format(s.currentPrice) : (s.currentPrice || '—');
      const prevPrice = (typeof PriceFormatter !== 'undefined') ? PriceFormatter.format(s.prevPrice) : (s.prevPrice || '—');

      html += `
        <div class="ch-card">
          <div class="ch-card-top">
            <div class="ch-card-bot-tag" style="border-color:${botMeta.color}; color:${botMeta.color};">
              <span>${botMeta.icon}</span>
              <span>${botMeta.name}</span>
            </div>
            <div class="ch-card-time-wrap">
              <span class="ch-card-dot">${dot}</span>
              <span class="ch-card-time">${formatSignalDateTime(s)}</span>
            </div>
          </div>

          <div class="ch-card-grid">
            ${s.strategy ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Strateji:</span>
                <span class="ch-field-val strong-white">${s.strategy} ${s.stars ? `<span style="color:#fbbf24">${s.stars}</span>` : ''}</span>
              </div>
            ` : ''}

            ${s.boostValue ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Boost:</span>
                <span class="ch-field-val ${String(s.boostValue).startsWith('-') ? 'val-down' : 'val-up'}">${s.boostValue}</span>
              </div>
            ` : ''}

            ${s.dropValue ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Drop Değeri:</span>
                <span class="ch-field-val val-down">${s.dropValue}</span>
              </div>
            ` : ''}

            <div class="ch-field">
              <span class="ch-field-lbl">Fiyat:</span>
              <span class="ch-field-val ch-price-val">${curPrice}</span>
            </div>

            ${prevPrice && prevPrice !== '0.00' && prevPrice !== '—' ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Önceki:</span>
                <span class="ch-field-val">${prevPrice}</span>
              </div>
            ` : ''}

            ${s.rsi ? `
              <div class="ch-field full-width">
                <span class="ch-field-lbl">RSI:</span>
                <span class="ch-field-val mono">${formatRsiField(s.rsi)}</span>
              </div>
            ` : ''}

            ${s.srsi ? `
              <div class="ch-field full-width">
                <span class="ch-field-lbl">SRSI:</span>
                <span class="ch-field-val mono">${formatRsiField(s.srsi)}</span>
              </div>
            ` : ''}

            ${s.pivot ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Pivot:</span>
                <span class="ch-field-val" style="color:#f59e0b">${s.pivot}</span>
              </div>
            ` : ''}

            ${s.wt ? `
              <div class="ch-field">
                <span class="ch-field-lbl">WaveTrend:</span>
                <span class="ch-field-val" style="color:#34d399">${s.wt}</span>
              </div>
            ` : ''}

            ${s.fundingRate ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Funding:</span>
                <span class="ch-field-val ${String(s.fundingRate).startsWith('-') ? 'val-down' : 'val-up'}">${s.fundingRate}</span>
              </div>
            ` : ''}

            ${s.hacimChange ? `
              <div class="ch-field">
                <span class="ch-field-lbl">Hacim Girişi:</span>
                <span class="ch-field-val val-up">${s.hacimChange}</span>
              </div>
            ` : ''}
          </div>

          <div class="ch-card-footer">
            <button class="ch-btn-view-chart" data-coin="${s.symbol}">
              ↗ Grafikte Göster
            </button>
          </div>
        </div>
      `;
    });

    if (contentEl) {
      contentEl.innerHTML = html;

      // Grafikte göster butonları
      contentEl.querySelectorAll('.ch-btn-view-chart').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const coin = btn.dataset.coin;
          if (typeof BotRenderer !== 'undefined' && BotRenderer.broadcastSymbol) {
            BotRenderer.broadcastSymbol(coin);
          } else if (typeof EventBus !== 'undefined' && EventBus.emit) {
            EventBus.emit('coin:change', { symbol: coin });
          }
          close();
        });
      });
    }
  }

  function formatRsiField(rsiObj) {
    if (!rsiObj) return '—';
    if (typeof rsiObj === 'string') return rsiObj;
    const parts = [];
    if (rsiObj.m1) parts.push(`1m: <strong>${rsiObj.m1}</strong>`);
    if (rsiObj.m5) parts.push(`5m: <strong>${rsiObj.m5}</strong>`);
    if (rsiObj.h1) parts.push(`1h: <strong>${rsiObj.h1}</strong>`);
    if (rsiObj.h4) parts.push(`4h: <strong>${rsiObj.h4}</strong>`);
    if (rsiObj.d1) parts.push(`1d: <strong>${rsiObj.d1}</strong>`);
    return parts.join(' | ') || JSON.stringify(rsiObj);
  }

  function close() {
    if (modalEl) modalEl.classList.add('hidden');
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
  }

  return {
    open,
    close
  };
})();

if (typeof window !== 'undefined') {
  window.CoinHistoryModal = CoinHistoryModal;
}
