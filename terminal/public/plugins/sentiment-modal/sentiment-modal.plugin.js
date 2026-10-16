/**
 * sentiment-modal.plugin.js — Seçili Coin Ticker Snapshot & Derin Piyasa Duyarlılık Modalı
 * Kırmızı okla gösterilen [◫] butonuna basıldığında açılan 4 barlı piyasa duyarlılık penceresi.
 */
const TickerSnapshot = (() => {
  let activeSymbol = 'BTWUSDT';
  let modalOpen = false;
  let updateTimer = null;

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

      if (tickerRes.status === 'fulfilled' && tickerRes.value.ok) {
        const t = await tickerRes.value.json();
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
    try {
      const res = await fetch(`/api/sentiment?symbol=${activeSymbol}`);
      if (!res.ok) return;
      const data = await res.json();

      // 1. ORDER BOOK (Depth)
      const ob = data.orderBook || { bidPct: 50, askPct: 50 };
      const obB = document.getElementById('modal-val-ob-b');
      const obS = document.getElementById('modal-val-ob-s');
      const obBar = document.getElementById('modal-bar-ob');
      if (obB && obS && obBar) {
        obB.textContent = `B ${ob.bidPct.toFixed(2)}%`;
        obS.textContent = `${ob.askPct.toFixed(2)}% S`;
        obBar.style.width = `${ob.bidPct}%`;
      }

      // 2. LONG/SHORT POSITIONS (Balina Net Pozisyon)
      const pos = data.topPosition || { longPct: 50, shortPct: 50 };
      const posL = document.getElementById('modal-val-pos-l');
      const posS = document.getElementById('modal-val-pos-s');
      const posBar = document.getElementById('modal-bar-pos');
      if (posL && posS && posBar) {
        posL.textContent = `L ${pos.longPct.toFixed(2)}%`;
        posS.textContent = `${pos.shortPct.toFixed(2)}% S`;
        posBar.style.width = `${pos.longPct}%`;
      }

      // Snapshot'taki ana L/S çubuğunu da senkronize et!
      const snapTrack = document.getElementById('snap-ls-fill');
      const snapL = document.getElementById('snap-ls-lbl-l');
      const snapS = document.getElementById('snap-ls-lbl-s');
      if (snapTrack && snapL && snapS) {
        snapTrack.style.width = `${pos.longPct}%`;
        snapL.textContent = `L ${pos.longPct.toFixed(2)}%`;
        snapS.textContent = `${pos.shortPct.toFixed(2)}% S`;
      }

      // 3. TRADER POSITIONING (Balina Hesap Oranı)
      const acc = data.topAccount || { longPct: 50, shortPct: 50 };
      const accL = document.getElementById('modal-val-acc-l');
      const accS = document.getElementById('modal-val-acc-s');
      const accBar = document.getElementById('modal-bar-acc');
      if (accL && accS && accBar) {
        accL.textContent = `L ${acc.longPct.toFixed(2)}%`;
        accS.textContent = `${acc.shortPct.toFixed(2)}% S`;
        accBar.style.width = `${acc.longPct}%`;
      }

      // 4. MARKET EXPOSURE (Perakende Dağılımı)
      const glob = data.globalExposure || { longPct: 50, shortPct: 50 };
      const globL = document.getElementById('modal-val-glob-l');
      const globS = document.getElementById('modal-val-glob-s');
      const globBar = document.getElementById('modal-bar-glob');
      if (globL && globS && globBar) {
        globL.textContent = `L ${glob.longPct.toFixed(2)}%`;
        globS.textContent = `${glob.shortPct.toFixed(2)}% S`;
        globBar.style.width = `${glob.longPct}%`;
      }
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
