/**
 * sentiment-modal.plugin.js — Seçili Coin Ticker Snapshot & Derin Piyasa Duyarlılık Modalı
 * Kırmızı okla gösterilen [◫] butonuna basıldığında açılan 4 barlı piyasa duyarlılık penceresi.
 */
const TickerSnapshot = (() => {
  let activeSymbol = 'BTWUSDT';
  let modalOpen = false;
  let updateTimer = null;
  let requestGeneration = 0;
  let modalGeneration = 0;

  function formatPrice(val) {
    if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
      return PriceFormatter.format(val);
    }
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) {
      return val.trim();
    }
    const num = Number(val);
    if (isNaN(num)) return '—';
    const abs = Math.abs(num);
    if (abs < 0.0001) return num.toFixed(8);
    if (abs < 0.01) return num.toFixed(6);
    if (abs < 1) return num.toFixed(5);
    if (abs < 100) return num.toFixed(4);
    return num.toFixed(2);
  }

  function formatNumber(num) {
    if (isNaN(num)) return '—';
    return Number(num).toLocaleString('en-US');
  }

  async function updateSymbol(symbol) {
    activeSymbol = symbol.toUpperCase();
    const targetSymbol = activeSymbol;
    const generation = ++requestGeneration;
    const isCurrent = () => generation === requestGeneration && targetSymbol === activeSymbol;

    const symEl = document.getElementById('snap-symbol');
    if (symEl) symEl.textContent = `${activeSymbol}.P`;

    const modalTitle = document.getElementById('modal-title-text');
    if (modalTitle) modalTitle.textContent = `${activeSymbol} — MARKET SENTIMENT & EXPOSURE`;

    // 1. Ticker ve Fonlama Verisi
    try {
      const [tickerRes, fundingRes, oiRes] = await Promise.allSettled([
        fetch(`/api/fapi/v1/ticker/24hr?symbol=${activeSymbol}`),
        fetch(`/api/fapi/v1/premiumIndex?symbol=${activeSymbol}`),
        fetch(`/api/fapi/v1/openInterest?symbol=${activeSymbol}`)
      ]);
      if (!isCurrent()) return;

      if (tickerRes.status === 'fulfilled' && tickerRes.value.ok) {
        const t = await tickerRes.value.json();
        if (!isCurrent()) return;
        const rawPrice = t.lastPrice !== undefined && t.lastPrice !== null ? String(t.lastPrice) : '0';
        const chg = parseFloat(t.priceChangePercent || 0);

        const priceEl = document.getElementById('snap-price');
        const chgEl = document.getElementById('snap-chg');

        if (priceEl) {
          priceEl.textContent = formatPrice(rawPrice);
          priceEl.className = `snapshot-price-big ${chg >= 0 ? 'up' : 'down'}`;
        }
        if (chgEl) {
          chgEl.textContent = `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`;
          chgEl.className = `snapshot-chg-pill ${chg >= 0 ? 'up' : 'down'}`;
        }
      }

      if (fundingRes.status === 'fulfilled' && fundingRes.value.ok) {
        const f = await fundingRes.value.json();
        if (!isCurrent()) return;
        const frVal = parseFloat(f.lastFundingRate || 0) * 100;
        const frEl = document.getElementById('snap-funding-val');
        if (frEl) {
          frEl.textContent = `${(frVal >= 0 ? '+' : '')}${frVal.toFixed(4)}% ↗`;
          frEl.style.color = frVal >= 0 ? 'var(--green)' : 'var(--red)';
        }

        // Geri sayım
        if (f.nextFundingTime) {
          const diff = Math.max(0, f.nextFundingTime - Date.now());
          const hrs = Math.floor(diff / 3600000);
          const mins = Math.floor((diff % 3600000) / 60000);
          const secs = Math.floor((diff % 60000) / 1000);
          const cdEl = document.getElementById('snap-countdown');
          if (cdEl) {
            cdEl.textContent = `⏳ ${String(hrs).padStart(2,'0')}:${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
          }
        }
      }

      if (oiRes.status === 'fulfilled' && oiRes.value.ok) {
        const oi = await oiRes.value.json();
        if (!isCurrent()) return;
        const oiEl = document.getElementById('snap-oi-num');
        if (oiEl) {
          oiEl.textContent = formatNumber(Math.round(parseFloat(oi.openInterest || 0)));
        }
      }
    } catch (e) {
      console.warn('[TickerSnapshot] update error:', e);
    }

    // Modal açıksa onu da güncelle
    if (modalOpen) {
      fetchAndRenderModalData();
    }
  }

  // ─── Modal Verilerini Çek ve Barları Güncelle ───────────────────
  async function fetchAndRenderModalData() {
    const targetSymbol = activeSymbol;
    const generation = ++modalGeneration;
    try {
      const res = await fetch(`/api/sentiment?symbol=${targetSymbol}`);
      if (!res.ok) return;
      const data = await res.json();
      if (generation !== modalGeneration || targetSymbol !== activeSymbol) return;

      function renderRatio(values, leftKey, rightKey, leftId, rightId, barId, leftLabel = 'L', rightLabel = 'S') {
        const left = values?.[leftKey], right = values?.[rightKey];
        const available = typeof left === 'number' && Number.isFinite(left) && typeof right === 'number' && Number.isFinite(right);
        const leftEl = document.getElementById(leftId), rightEl = document.getElementById(rightId), barEl = document.getElementById(barId);
        if (leftEl) leftEl.textContent = available ? `${leftLabel} ${left.toFixed(2)}%` : 'VERİ YOK';
        if (rightEl) rightEl.textContent = available ? `${right.toFixed(2)}% ${rightLabel}` : '—';
        if (barEl) barEl.style.width = available ? `${left}%` : '0%';
      }
      renderRatio(data.orderBook, 'bidPct', 'askPct', 'modal-val-ob-b', 'modal-val-ob-s', 'modal-bar-ob', 'B', 'S');
      renderRatio(data.topPosition, 'longPct', 'shortPct', 'modal-val-pos-l', 'modal-val-pos-s', 'modal-bar-pos');
      renderRatio(data.topPosition, 'longPct', 'shortPct', 'snap-ls-lbl-l', 'snap-ls-lbl-s', 'snap-ls-fill');
      renderRatio(data.topAccount, 'longPct', 'shortPct', 'modal-val-acc-l', 'modal-val-acc-s', 'modal-bar-acc');
      renderRatio(data.globalExposure, 'longPct', 'shortPct', 'modal-val-glob-l', 'modal-val-glob-s', 'modal-bar-glob');
    } catch (e) {
      console.warn('[ModalData] fetch error:', e);
    }
  }

  function openModal() {
    const backdrop = document.getElementById('sentiment-modal-backdrop');
    if (!backdrop) return;
    backdrop.classList.add('open');
    modalOpen = true;
    fetchAndRenderModalData();
  }

  function closeModal() {
    const backdrop = document.getElementById('sentiment-modal-backdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    modalOpen = false;
  }

  function init() {
    const triggerBtn = document.getElementById('sentiment-modal-trigger-btn');
    if (triggerBtn) {
      triggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openModal();
      });
    }

    const closeBtn = document.getElementById('modal-close-btn');
    if (closeBtn) closeBtn.addEventListener('click', closeModal);

    const backdrop = document.getElementById('sentiment-modal-backdrop');
    if (backdrop) {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeModal();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalOpen) closeModal();
    });

    updateSymbol(activeSymbol);
    updateTimer = setInterval(() => {
      updateSymbol(activeSymbol);
    }, 3000);
  }

  return {
    init,
    updateSymbol,
    openModal,
    closeModal,
  };
})();
