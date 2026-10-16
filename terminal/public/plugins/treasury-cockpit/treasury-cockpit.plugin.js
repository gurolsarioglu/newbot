/**
 * treasury-cockpit.plugin.js — Bot Takip Ekranı & Kasa Yönetimi Alanı Modülü
 * Alpha Terminal 2.0 (Stop-Loss'suz Kasa Yönetimi & Marjin/Likidasyon Kontrolü)
 * 
 * Trader İlkesi:
 * - Stop-Loss KULLANILMAZ.
 * - Risk, her işleme ayrılan sınırlı Kasa Teminatı (Margin Allocation %) ve düşük kaldıraçla yönetilir.
 * - Güvenlik, Likidasyon Fiyatı Mesafesi (% Liq Distance Buffer) ile takip edilir.
 * - Kâr alımları (TP1, TP2, TP3) ve kademeli kâr realization (%50 TP) ile kasa büyütülür.
 */

const TreasuryCockpitPlugin = (() => {
  const STORAGE_KEY_SETTINGS = 'alpha_treasury_settings_v2';
  const STORAGE_KEY_POSITIONS = 'alpha_treasury_positions_v2';

  let state = {
    totalEquity: 10000.00,           // Toplam Kasa (USDT)
    marginAllocPerTradePct: 2.00,    // İşlem Başı Kasa Teminatı % (Varsayılan %2 = $200)
    maxPositionMarginPct: 5.00,      // Tek Coine Max İzin Verilen Teminat % (Varsayılan %5 = $500)
    dailyRealizedPnl: 348.50,        // Günlük Gerçekleşen Kâr ($)
    selectedSymbol: 'BTCUSDT',       // Aktif Seçili Coin
    selectedPrice: 83500.00,         // Anlık Fiyat
    targetTpPct: 2.50,               // Hedef Kâr % (Varsayılan %2.5)
    positions: [],                   // Aktif Pozisyonlar
    bots: [
      { id: 'm1a', badge: 'M1-A', name: 'M1-A Drop', color: 'gold', strategy: '1m Ani Düşüş', allocPct: 10, count: 0, lastSignal: null, active: true },
      { id: 'm1premium', badge: 'M1P', name: 'M1 Premium', color: 'gold', strategy: '1m Momentum & Sıçrama', allocPct: 15, count: 0, lastSignal: null, active: true },
      { id: 'hammerpro', badge: 'PRO', name: 'Hammer Pro', color: 'cyan', strategy: '#W1 Dip Dönüş', allocPct: 15, count: 0, lastSignal: null, active: true },
      { id: 'hammerproplus', badge: 'PRO+', name: 'Hammer Pro+', color: 'bronze', strategy: 'Yapısal Mum Çerçevesi', allocPct: 20, count: 0, lastSignal: null, active: true },
      { id: '4s', badge: '4S', name: '4S Multi-Angle', color: 'red', strategy: '4H Yapı & Trend', allocPct: 10, count: 0, lastSignal: null, active: true },
      { id: '4ssniper', badge: 'SNIPER', name: '4S Sniper', color: 'bronze', strategy: 'NW UP Balina Reversal', allocPct: 10, count: 0, lastSignal: null, active: true },
      { id: 'div', badge: 'DIV', name: 'Divergence', color: 'purple', strategy: 'RSI Uyumsuzluk & Kesişim', allocPct: 10, count: 0, lastSignal: null, active: true },
      { id: 'fr', badge: 'FR', name: 'Funding Rate', color: 'cyan', strategy: 'Ekstrem Squeeze & FR', allocPct: 5, count: 0, lastSignal: null, active: true },
      { id: 'v3', badge: 'V3', name: 'V3-A Hacim', color: 'green', strategy: 'Real-Time Volume Spike', allocPct: 5, count: 0, lastSignal: null, active: true }
    ]
  };

  let containerEl = null;

  // ─── Kalıcı Bellek Yönetimi ────────────────────────────────────
  function loadFromStorage() {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY_SETTINGS);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.totalEquity) state.totalEquity = parseFloat(parsed.totalEquity);
        if (parsed.marginAllocPerTradePct) state.marginAllocPerTradePct = parseFloat(parsed.marginAllocPerTradePct);
        if (parsed.maxPositionMarginPct) state.maxPositionMarginPct = parseFloat(parsed.maxPositionMarginPct);
        if (parsed.dailyRealizedPnl !== undefined) state.dailyRealizedPnl = parseFloat(parsed.dailyRealizedPnl);
        if (parsed.targetTpPct) state.targetTpPct = parseFloat(parsed.targetTpPct);
      }

      const savedPositions = localStorage.getItem(STORAGE_KEY_POSITIONS);
      if (savedPositions) {
        state.positions = JSON.parse(savedPositions);
      } else {
        // Gerçekçi başlangıç pozisyonları (Stop-Loss'suz, Likidasyon Korumalı)
        state.positions = [
          {
            id: 'pos_btc_1',
            symbol: 'BTCUSDT',
            botId: '4ssniper',
            botBadge: '4S SNIPER',
            side: 'LONG',
            entryPrice: 83120.00,
            curPrice: 83520.00,
            amount: 0.06,
            margin: 500.00,
            leverage: 10,
            liqPrice: 75223.00,
            tp1: 85200.00,
            openTime: '13:23'
          },
          {
            id: 'pos_eth_2',
            symbol: 'ETHUSDT',
            botId: 'hammerproplus',
            botBadge: 'PRO+',
            side: 'LONG',
            entryPrice: 2488.50,
            curPrice: 2505.20,
            amount: 1.0,
            margin: 500.00,
            leverage: 5,
            liqPrice: 2003.20,
            tp1: 2560.00,
            openTime: '13:23'
          },
          {
            id: 'pos_spcx_3',
            symbol: 'SPCXUSDT',
            botId: '4ssniper',
            botBadge: '4S SNIPER',
            side: 'LONG',
            entryPrice: 154.20,
            curPrice: 157.39,
            amount: 5.8,
            margin: 300.00,
            leverage: 3,
            liqPrice: 104.50,
            tp1: 165.00,
            openTime: '13:23'
          }
        ];
        savePositionsToStorage();
      }
    } catch (e) {
      console.warn('[TreasuryCockpit] Storage yukleme hatasi:', e);
    }
  }

  function saveSettingsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_SETTINGS, JSON.stringify({
        totalEquity: state.totalEquity,
        marginAllocPerTradePct: state.marginAllocPerTradePct,
        maxPositionMarginPct: state.maxPositionMarginPct,
        dailyRealizedPnl: state.dailyRealizedPnl,
        targetTpPct: state.targetTpPct
      }));
    } catch (e) {}
  }

  function savePositionsToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY_POSITIONS, JSON.stringify(state.positions));
    } catch (e) {}
  }

  // ─── Formatlayıcılar ───────────────────────────────────────────
  function formatMoney(val) {
    const num = parseFloat(val) || 0;
    return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function formatPercent(val) {
    const num = parseFloat(val) || 0;
    const sign = num > 0 ? '+' : '';
    return `${sign}${num.toFixed(2)}%`;
  }

  // ─── Likidasyon Hesaplayıcı ────────────────────────────────────
  function calculateLiqPrice(entry, leverage, side = 'LONG') {
    const lev = Math.max(1, parseInt(leverage, 10) || 1);
    if (lev <= 1) return 0; // 1x Spot / Sıfır Likidasyon
    const m = 0.95; // %0.5 - %1 sürdürme teminatı payı
    if (side === 'LONG') {
      return Math.max(0, +(entry * (1 - (1 / lev) * m)).toFixed(4));
    } else {
      return +(entry * (1 + (1 / lev) * m)).toFixed(4);
    }
  }

  function calculateLiqDistancePct(curPrice, liqPrice, side = 'LONG') {
    if (!liqPrice || liqPrice <= 0) return 100; // Likidasyon yok
    if (side === 'LONG') {
      return -Math.abs(((curPrice - liqPrice) / curPrice) * 100);
    } else {
      return +Math.abs(((liqPrice - curPrice) / curPrice) * 100);
    }
  }

  // ─── Kasa İstatistik Hesaplamaları ─────────────────────────────
  function getInTradeMargin() {
    return state.positions.reduce((sum, p) => sum + (parseFloat(p.margin) || 0), 0);
  }

  function getAvailableMargin() {
    return Math.max(0, state.totalEquity - getInTradeMargin());
  }

  function getUnrealizedPnl() {
    let total = 0;
    state.positions.forEach(p => {
      const entry = parseFloat(p.entryPrice) || 0;
      const cur = parseFloat(p.curPrice) || entry;
      const amt = parseFloat(p.amount) || 0;
      if (entry > 0) {
        const diff = p.side === 'LONG' ? (cur - entry) : (entry - cur);
        total += diff * amt;
      }
    });
    return total;
  }

  // ─── 9 Bot Sinyal Verilerini API'den Çekme ─────────────────────
  async function refreshBotSignals() {
    for (const b of state.bots) {
      try {
        const res = await fetch(`/api/signals?bot=${b.id}`);
        if (!res.ok) continue;
        const data = await res.json();
        b.count = data.count || (data.signals ? data.signals.length : 0);
        if (data.signals && data.signals.length > 0) {
          const s = data.signals[0];
          b.lastSignal = {
            symbol: s.symbol,
            time: s.time || (s.dateStr ? s.dateStr.slice(0, 5) : 'Bugün'),
            price: s.currentPrice,
            boost: s.boostValue || s.dropValue || s.fundingRate || ''
          };
        }
      } catch (e) {}
    }
    renderBotMatrix();
    updateHeaderCounters();
  }

  // ─── Ana Arayüz İskelesi (Layout) ──────────────────────────────
  function renderLayout() {
    if (!containerEl) return;

    containerEl.innerHTML = `
      <div id="treasury-cockpit-container">
        <!-- 1. Üst Başlık ve Hızlı Eylem Bandı -->
        <div class="cockpit-top-banner">
          <div class="cockpit-title-box">
            <div class="cockpit-icon-badge">🛡️</div>
            <div class="cockpit-heading-group">
              <div class="cockpit-main-title">
                BOT TAKİP KOKPİTİ & KASA YÖNETİMİ
                <span class="live-pulse-chip" style="background:rgba(56,189,248,0.2); color:#38bdf8; border-color:rgba(56,189,248,0.4);">
                  🛡️ STOP-LOSS'SUZ (MARJİN & LİKİDASYON KONTROLÜ)
                </span>
              </div>
              <div class="cockpit-sub-title">Sermaye Dağılımı, Likidasyon Güvenlik Mesafesi ve Hedef Kâr Takibi</div>
            </div>
          </div>
          <div class="cockpit-banner-actions">
            <button class="cockpit-action-btn" id="btn-refresh-cockpit" title="Verileri Güncelle">
              🔄 Yenile
            </button>
            <button class="cockpit-action-btn primary" id="btn-open-settings" title="Kasa ve Risk Ayarları">
              ⚙️ Kasa Ayarları
            </button>
          </div>
        </div>

        <!-- 2. Kasa Özet Metrikleri (5 Kart) -->
        <div class="treasury-metrics-grid" id="treasury-metrics-grid">
          <!-- JS ile doldurulur -->
        </div>

        <!-- 3. 9 Bot Canlı Takip & Sermaye Tahsisat Matrisi -->
        <div class="section-wrapper">
          <div class="section-header-row">
            <div class="section-title">
              <span>🤖 9 Quant Botu Canlı Takip Matrisi</span>
              <span class="section-count-tag" id="active-bot-count-tag">9/9 Aktif</span>
            </div>
          </div>
          <div class="bot-matrix-grid" id="bot-matrix-grid">
            <!-- JS ile doldurulur -->
          </div>
        </div>

        <!-- 4. Alt Çalışma Masası (Pozisyonlar + SL'siz Marjin Hesaplayıcı) -->
        <div class="workbench-split-grid">
          <!-- Sol Panel: Aktif Pozisyonlar -->
          <div class="workbench-panel">
            <div class="panel-header">
              <div class="panel-title">
                <span>📋 Aktif Pozisyon & Kasa İcra Defteri</span>
                <span class="section-count-tag" id="pos-count-tag">3 Pozisyon</span>
              </div>
              <div style="font-size:10px; color:#94a3b8; font-family:'SF Mono',Consolas,monospace;">
                Unrealized: <span id="pos-header-upnl" style="font-weight:700; color:#34d399;">+$132.80</span>
              </div>
            </div>
            <div class="positions-table-wrap">
              <table class="positions-table">
                <thead>
                  <tr>
                    <th>Sembol / Bot</th>
                    <th>Yön</th>
                    <th>Giriş / Anlık</th>
                    <th>Miktar</th>
                    <th>Marjin / Kaldıraç</th>
                    <th>Likidasyon & Tampon</th>
                    <th>Hedef Kâr (TP)</th>
                    <th>Canlı PnL</th>
                    <th style="text-align:right;">Aksiyon</th>
                  </tr>
                </thead>
                <tbody id="positions-tbody">
                  <!-- JS ile doldurulur -->
                </tbody>
              </table>
            </div>
          </div>

          <!-- Sağ Panel: SL'siz Kasa Marjin & Likidasyon Hesaplayıcı -->
          <div class="workbench-panel">
            <div class="panel-header">
              <div class="panel-title">
                <span>🧮 Kasa Marjin & Likidasyon Hesaplayıcı</span>
              </div>
              <span style="font-size:9px; color:#38bdf8; font-weight:700;">SL'SİZ MARJİN KONTROLÜ</span>
            </div>
            <div class="calc-form">
              <div class="calc-row">
                <span class="calc-label">Sembol</span>
                <input type="text" id="calc-symbol" class="calc-input" value="${state.selectedSymbol}" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Giriş Fiyatı ($)</span>
                <input type="number" id="calc-entry" class="calc-input" value="${state.selectedPrice}" step="any" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Kasa Payı (Teminat)</span>
                <div class="risk-pill-group">
                  <button class="risk-pill-btn" data-alloc="1.0">%1 ($100)</button>
                  <button class="risk-pill-btn active" data-alloc="2.0">%2 ($200)</button>
                  <button class="risk-pill-btn" data-alloc="3.0">%3 ($300)</button>
                  <button class="risk-pill-btn" data-alloc="5.0">%5 ($500)</button>
                  <button class="risk-pill-btn" data-alloc="10.0">%10 ($1K)</button>
                </div>
              </div>
              <div class="calc-row">
                <span class="calc-label">Kaldıraç</span>
                <select id="calc-leverage" class="calc-input" style="padding:4px 6px;">
                  <option value="1">1x (Spot Güvenli / 0 Likidasyon)</option>
                  <option value="2">2x (%50 Güvenlik Tamponu)</option>
                  <option value="3">3x (%33.3 Güvenlik Tamponu)</option>
                  <option value="5" selected>5x (%20.0 Güvenlik Tamponu)</option>
                  <option value="10">10x (%10.0 Güvenlik Tamponu)</option>
                  <option value="20">20x (%5.0 Yüksek Risk)</option>
                </select>
              </div>
              <div class="calc-row">
                <span class="calc-label">Hedef Kâr Al (TP %)</span>
                <div class="risk-pill-group">
                  <button class="tp-pill-btn" data-tp="1.5">+1.5%</button>
                  <button class="tp-pill-btn active" data-tp="2.5">+2.5%</button>
                  <button class="tp-pill-btn" data-tp="4.0">+4.0%</button>
                  <button class="tp-pill-btn" data-tp="6.0">+6.0%</button>
                </div>
              </div>

              <!-- Sonuç Kutusu -->
              <div class="calc-result-box">
                <div class="calc-res-item">
                  <span class="calc-res-lbl">Ayrılan Teminat (Marjin):</span>
                  <span class="calc-res-val highlight-gold" id="res-margin-usd">$200.00 (%2.0)</span>
                </div>
                <div class="calc-res-item">
                  <span class="calc-res-lbl">Toplam Pozisyon Hacmi:</span>
                  <span class="calc-res-val highlight-green" id="res-notional-usd">$1,000.00 (5x)</span>
                </div>
                <div class="calc-res-item">
                  <span class="calc-res-lbl">Tahmini Likidasyon Fiyatı:</span>
                  <span class="calc-res-val" id="res-liq-price" style="color:#f87171;">$66,800.00</span>
                </div>
                <div class="calc-res-item">
                  <span class="calc-res-lbl">Likidasyon Güvenlik Mesafesi:</span>
                  <span class="calc-res-val" id="res-liq-dist" style="color:#34d399;">%-20.0 (🟢 GÜVENLİ TAMPON)</span>
                </div>
                <div class="calc-res-item">
                  <span class="calc-res-lbl">Hedef Kâr Getirisi (TP):</span>
                  <span class="calc-res-val" id="res-tp-profit" style="color:#38bdf8;">+$25.00 (+12.5% Marjin Kârı)</span>
                </div>
              </div>

              <button class="calc-submit-btn" id="btn-add-sim-position">
                ⚡ Pozisyonu Kasaya Ekle / Takibe Al
              </button>
            </div>
          </div>
        </div>

        <!-- 5. Kasa Ayarları Modalı -->
        <div class="treasury-modal-backdrop" id="treasury-settings-modal">
          <div class="treasury-modal-card">
            <div class="tm-header">
              <span class="tm-title">⚙️ KASA VE MARJİN AYARLARI</span>
              <button class="tm-close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="calc-form">
              <div class="calc-row">
                <span class="calc-label">Toplam Kasa Sermayesi ($)</span>
                <input type="number" id="modal-equity" class="calc-input" value="${state.totalEquity}" step="100" />
              </div>
              <div class="calc-row">
                <span class="calc-label">İşlem Başı Teminat Limiti (%)</span>
                <input type="number" id="modal-risk-pct" class="calc-input" value="${state.marginAllocPerTradePct}" step="0.5" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Tek Coine Max Teminat (%)</span>
                <input type="number" id="modal-daily-loss" class="calc-input" value="${state.maxPositionMarginPct}" step="0.5" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Bugünkü Gerçekleşen Kâr ($)</span>
                <input type="number" id="modal-realized-pnl" class="calc-input" value="${state.dailyRealizedPnl}" step="10" />
              </div>
              <button class="calc-submit-btn" id="btn-save-settings">
                Kaydet ve Uygula
              </button>
            </div>
          </div>
        </div>

      </div>
    `;

    renderMetrics();
    renderBotMatrix();
    renderPositionsTable();
    setupEventListeners();
    recalculatePositionSize();
  }

  // ─── 1. Kasa Metrik Kartlarını Render Etme ─────────────────────
  function renderMetrics() {
    const gridEl = document.getElementById('treasury-metrics-grid');
    if (!gridEl) return;

    const inTrade = getInTradeMargin();
    const available = getAvailableMargin();
    const uPnl = getUnrealizedPnl();
    const totalPnl = state.dailyRealizedPnl + uPnl;
    const pnlPct = (totalPnl / state.totalEquity) * 100;
    const marginUsagePct = Math.min(100, (inTrade / state.totalEquity) * 100);
    const maxSingleMarginUsd = state.totalEquity * (state.maxPositionMarginPct / 100);

    gridEl.innerHTML = `
      <!-- Kart 1: Toplam Kasa -->
      <div class="treasury-card glow-gold">
        <div class="t-card-header">
          <span class="t-card-title">Toplam Kasa</span>
          <span class="t-card-icon">💰</span>
        </div>
        <div class="t-card-value">${formatMoney(state.totalEquity)}</div>
        <div class="t-card-sub">
          <span>Günlük Net</span>
          <span class="${totalPnl >= 0 ? 'badge-up' : 'badge-down'}">${formatMoney(totalPnl)} (${formatPercent(pnlPct)})</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #f59e0b;"></div>
        </div>
      </div>

      <!-- Kart 2: Kullanılabilir Kasa -->
      <div class="treasury-card glow-green">
        <div class="t-card-header">
          <span class="t-card-title">Kullanılabilir Kasa</span>
          <span class="t-card-icon">🔓</span>
        </div>
        <div class="t-card-value" style="color: #34d399;">${formatMoney(available)}</div>
        <div class="t-card-sub">
          <span>Serbest Oran</span>
          <span class="badge-up">${((available / state.totalEquity) * 100).toFixed(1)}%</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: ${((available / state.totalEquity) * 100)}%; background: #10b981;"></div>
        </div>
      </div>

      <!-- Kart 3: Riskteki Marjin -->
      <div class="treasury-card glow-blue">
        <div class="t-card-header">
          <span class="t-card-title">Açık Marjin (Kullanılan)</span>
          <span class="t-card-icon">⚡</span>
        </div>
        <div class="t-card-value" style="color: #38bdf8;">${formatMoney(inTrade)}</div>
        <div class="t-card-sub">
          <span>Kasa Kullanımı</span>
          <span>${marginUsagePct.toFixed(1)}%</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: ${marginUsagePct}%; background: #38bdf8;"></div>
        </div>
      </div>

      <!-- Kart 4: Günlük PnL & Win Rate -->
      <div class="treasury-card glow-cyan">
        <div class="t-card-header">
          <span class="t-card-title">Günlük PnL / Win</span>
          <span class="t-card-icon">📈</span>
        </div>
        <div class="t-card-value" style="color: ${totalPnl >= 0 ? '#34d399' : '#f87171'};">
          ${totalPnl >= 0 ? '+' : ''}${formatMoney(totalPnl)}
        </div>
        <div class="t-card-sub">
          <span>Realized / WinRate</span>
          <span class="badge-up">78.4% (18W / 4L)</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 78.4%; background: #06b6d4;"></div>
        </div>
      </div>

      <!-- Kart 5: Kasa Disiplini (SL'siz Marjin & Güvenlik Kuralı) -->
      <div class="treasury-card glow-purple">
        <div class="t-card-header">
          <span class="t-card-title">Kasa Disiplini (SL'siz)</span>
          <span class="t-card-icon">🛡️</span>
        </div>
        <div class="t-card-value" style="color: #c084fc;">Max %${state.maxPositionMarginPct.toFixed(1)} (${formatMoney(maxSingleMarginUsd)})</div>
        <div class="t-card-sub">
          <span>Likidasyon Güvenliği</span>
          <span style="color: #34d399; font-weight:700;">GÜVENLİ TAMPON</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #a855f7;"></div>
        </div>
      </div>
    `;

    const upnlHeader = document.getElementById('pos-header-upnl');
    if (upnlHeader) {
      upnlHeader.textContent = (uPnl >= 0 ? '+' : '') + formatMoney(uPnl);
      upnlHeader.style.color = uPnl >= 0 ? '#34d399' : '#f87171';
    }
  }

  // ─── 2. 9 Bot Matrisini Render Etme ────────────────────────────
  function renderBotMatrix() {
    const gridEl = document.getElementById('bot-matrix-grid');
    if (!gridEl) return;

    gridEl.innerHTML = state.bots.map(b => {
      const allocUsd = state.totalEquity * (b.allocPct / 100);
      const last = b.lastSignal;
      const lastStr = last ? `${last.symbol} (${last.time}) ${last.boost}` : 'Dinlemede...';

      return `
        <div class="bot-matrix-card" data-bot-id="${b.id}" title="${b.name} sinyallerine odaklan">
          <div class="bmc-top">
            <div class="bmc-name-group">
              <span class="bmc-badge ${b.color}">${b.badge}</span>
              <span class="bmc-title">${b.name}</span>
            </div>
            <div class="bmc-toggle-wrap">
              <span class="bmc-status-dot ${b.active ? '' : 'inactive'}" title="${b.active ? 'Aktif' : 'Pasif'}"></span>
              <span style="font-size:9px; font-weight:700; color:${b.active ? '#34d399' : '#64748b'};">${b.active ? 'AKTİF' : 'PASİF'}</span>
            </div>
          </div>

          <div class="bmc-stats-row">
            <div class="bmc-stat-col">
              <span class="bmc-stat-lbl">KASA PAYI</span>
              <span class="bmc-stat-val highlight">%${b.allocPct} (${formatMoney(allocUsd)})</span>
            </div>
            <div class="bmc-stat-col" style="text-align:right;">
              <span class="bmc-stat-lbl">BUGÜNKÜ SİNYAL</span>
              <span class="bmc-stat-val" style="color:#fbbf24;">${b.count} Adet</span>
            </div>
          </div>

          <div class="bmc-bottom-row">
            <div class="bmc-last-signal" title="Son Sinyal">
              <span>📡</span>
              <span style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:180px;">${lastStr}</span>
            </div>
            <button class="bmc-btn-link btn-jump-bot" data-bot-id="${b.id}">
              Sinyallere Git ↗
            </button>
          </div>
        </div>
      `;
    }).join('');

    gridEl.querySelectorAll('.btn-jump-bot').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const botId = btn.getAttribute('data-bot-id');
        jumpToBot(botId);
      });
    });

    gridEl.querySelectorAll('.bot-matrix-card').forEach(card => {
      card.addEventListener('click', () => {
        const botId = card.getAttribute('data-bot-id');
        jumpToBot(botId);
      });
    });
  }

  function jumpToBot(botId) {
    if (typeof EventBus !== 'undefined') {
      EventBus.emit('bot:select', botId);
    }
    const rightBtn = document.querySelector(`.bot-badge-btn[data-bot="${botId}"]`);
    if (rightBtn) rightBtn.click();
  }

  // ─── 3. Aktif Pozisyonlar Tablosu (SL'siz, Likidasyon & TP) ─────
  function renderPositionsTable() {
    const tbody = document.getElementById('positions-tbody');
    const countTag = document.getElementById('pos-count-tag');
    if (!tbody) return;

    if (countTag) {
      countTag.textContent = `${state.positions.length} Pozisyon`;
    }

    if (state.positions.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9">
            <div class="empty-positions-placeholder">
              <span class="empty-icon">🛡️</span>
              <span style="font-size:12px; font-weight:700; color:#cbd5e1;">Açık Pozisyon Bulunmuyor</span>
              <span style="font-size:10px; margin-top:4px;">Sağdaki hesaplayıcıdan pozisyon ekleyebilir veya bot sinyallerini takip edebilirsiniz.</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.positions.map(p => {
      const entry = parseFloat(p.entryPrice) || 0;
      const cur = parseFloat(p.curPrice) || entry;
      const amt = parseFloat(p.amount) || 0;
      const margin = parseFloat(p.margin) || 0;
      const lev = parseInt(p.leverage, 10) || 5;
      const diff = p.side === 'LONG' ? (cur - entry) : (entry - cur);
      const pnlUsd = diff * amt;
      const pnlPct = margin > 0 ? (pnlUsd / margin) * 100 : 0;
      const isUp = pnlUsd >= 0;

      const liq = p.liqPrice || calculateLiqPrice(entry, lev, p.side);
      const liqDistPct = calculateLiqDistancePct(cur, liq, p.side);
      const isLiqSafe = Math.abs(liqDistPct) >= 15;

      return `
        <tr data-pos-id="${p.id}">
          <td>
            <div class="pos-symbol-cell">
              <span>${p.symbol}</span>
              <span class="pos-bot-badge">${p.botBadge || 'BOT'}</span>
            </div>
          </td>
          <td>
            <span class="${p.side === 'LONG' ? 'pos-tag-long' : 'pos-tag-short'}">${p.side}</span>
          </td>
          <td>
            <div style="font-weight:700;">${cur}</div>
            <div style="font-size:9px; color:#64748b;">G: ${entry}</div>
          </td>
          <td>${amt}</td>
          <td>
            <div>${formatMoney(margin)}</div>
            <div style="font-size:9px; color:#38bdf8;">${lev}x</div>
          </td>
          <td>
            <div style="font-weight:700; color:#f87171;">${liq > 0 ? liq : 'Yok (1x)'}</div>
            <div style="font-size:9px; color:${isLiqSafe ? '#34d399' : '#f59e0b'};">
              ${liqDistPct.toFixed(1)}% ${isLiqSafe ? '🟢 Güvenli' : '⚠️ Dikkat'}
            </div>
          </td>
          <td>
            <div style="font-weight:700; color:#34d399;">${p.tp1 || '—'}</div>
            <div style="font-size:9px; color:#64748b;">Hedef Kâr</div>
          </td>
          <td class="pos-pnl-cell ${isUp ? 'up' : 'down'}">
            ${isUp ? '+' : ''}${formatMoney(pnlUsd)} (${formatPercent(pnlPct)})
          </td>
          <td style="text-align:right;">
            <div class="pos-action-btns" style="justify-content:flex-end;">
              <button class="pos-btn-mini btn-pos-tp" data-id="${p.id}" title="Yarı Pozisyon Kâr Al (%50)">TP %50</button>
              <button class="pos-btn-mini btn-pos-add" data-id="${p.id}" title="Kademeli Ekle / Maliyet Düşür">+ Ekle</button>
              <button class="pos-btn-mini danger btn-pos-close" data-id="${p.id}" title="Pozisyonu Kapat">✕</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.btn-pos-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        closePosition(id);
      });
    });

    tbody.querySelectorAll('.btn-pos-tp').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        partialTpPosition(id);
      });
    });

    tbody.querySelectorAll('.btn-pos-add').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        addToPosition(id);
      });
    });
  }

  // ─── Pozisyon Eylemleri ────────────────────────────────────────
  function closePosition(id) {
    const idx = state.positions.findIndex(p => p.id === id);
    if (idx === -1) return;
    const p = state.positions[idx];
    const entry = parseFloat(p.entryPrice) || 0;
    const cur = parseFloat(p.curPrice) || entry;
    const amt = parseFloat(p.amount) || 0;
    const diff = p.side === 'LONG' ? (cur - entry) : (entry - cur);
    const pnlUsd = diff * amt;

    state.dailyRealizedPnl += pnlUsd;
    state.positions.splice(idx, 1);
    savePositionsToStorage();
    saveSettingsToStorage();
    renderMetrics();
    renderPositionsTable();
  }

  function partialTpPosition(id) {
    const p = state.positions.find(p => p.id === id);
    if (!p) return;
    const halfAmt = p.amount / 2;
    const entry = parseFloat(p.entryPrice) || 0;
    const cur = parseFloat(p.curPrice) || entry;
    const diff = p.side === 'LONG' ? (cur - entry) : (entry - cur);
    const pnlUsd = diff * halfAmt;

    state.dailyRealizedPnl += pnlUsd;
    p.amount = +(p.amount - halfAmt).toFixed(4);
    p.margin = +(p.margin / 2).toFixed(2);
    savePositionsToStorage();
    saveSettingsToStorage();
    renderMetrics();
    renderPositionsTable();
  }

  function addToPosition(id) {
    const p = state.positions.find(p => p.id === id);
    if (!p) return;
    const cur = parseFloat(p.curPrice) || p.entryPrice;
    // Mevcut pozisyonun %50'si kadar kademe ekle
    const addMargin = +(p.margin * 0.5).toFixed(2);
    const addAmt = +(p.amount * 0.5).toFixed(4);
    const oldTotalCost = p.entryPrice * p.amount;
    const newTotalCost = oldTotalCost + (cur * addAmt);
    const newTotalAmt = +(p.amount + addAmt).toFixed(4);

    p.entryPrice = +(newTotalCost / newTotalAmt).toFixed(4);
    p.amount = newTotalAmt;
    p.margin = +(p.margin + addMargin).toFixed(2);
    p.liqPrice = calculateLiqPrice(p.entryPrice, p.leverage, p.side);

    savePositionsToStorage();
    renderMetrics();
    renderPositionsTable();
  }

  // ─── 4. SL'siz Kasa Marjin & Likidasyon Hesaplayıcı ─────────────
  function recalculatePositionSize() {
    const entryInput = document.getElementById('calc-entry');
    const levSelect = document.getElementById('calc-leverage');

    const entry = parseFloat(entryInput ? entryInput.value : state.selectedPrice) || 1;
    const lev = parseInt(levSelect ? levSelect.value : 5, 10) || 5;
    const allocPct = state.marginAllocPerTradePct;
    const tpPct = state.targetTpPct;

    // 1. Ayrılan Teminat (Marjin) = Toplam Kasa * Kasa Payı %
    const marginUsd = +(state.totalEquity * (allocPct / 100)).toFixed(2);

    // 2. Toplam Pozisyon Büyüklüğü ($ Notional) = Marjin * Kaldıraç
    const notionalUsd = +(marginUsd * lev).toFixed(2);

    // 3. Likidasyon Fiyatı & Mesafesi
    const liqPrice = calculateLiqPrice(entry, lev, 'LONG');
    const liqDistPct = calculateLiqDistancePct(entry, liqPrice, 'LONG');
    const isLiqSafe = Math.abs(liqDistPct) >= 15;

    // 4. Hedef Kâr Getirisi (TP1)
    const tpProfitUsd = +(notionalUsd * (tpPct / 100)).toFixed(2);
    const tpRoePct = +((tpProfitUsd / marginUsd) * 100).toFixed(1);

    const resMargin = document.getElementById('res-margin-usd');
    const resNotional = document.getElementById('res-notional-usd');
    const resLiqPrice = document.getElementById('res-liq-price');
    const resLiqDist = document.getElementById('res-liq-dist');
    const resTpProfit = document.getElementById('res-tp-profit');

    if (resMargin) resMargin.textContent = `${formatMoney(marginUsd)} (%${allocPct.toFixed(1)})`;
    if (resNotional) resNotional.textContent = `${formatMoney(notionalUsd)} (${lev}x)`;
    if (resLiqPrice) resLiqPrice.textContent = liqPrice > 0 ? `$${liqPrice}` : 'Yok (1x Spot)';
    if (resLiqDist) {
      resLiqDist.textContent = `${liqDistPct.toFixed(1)}% (${isLiqSafe ? '🟢 GÜVENLİ TAMPON' : '⚠️ DİKKAT'})`;
      resLiqDist.style.color = isLiqSafe ? '#34d399' : '#f59e0b';
    }
    if (resTpProfit) resTpProfit.textContent = `+${formatMoney(tpProfitUsd)} (+${tpRoePct}% Marjin Kârı)`;
  }

  function addCalculatedPosition() {
    const symInput = document.getElementById('calc-symbol');
    const entryInput = document.getElementById('calc-entry');
    const levSelect = document.getElementById('calc-leverage');

    const sym = (symInput ? symInput.value : state.selectedSymbol).toUpperCase().trim();
    const entry = parseFloat(entryInput ? entryInput.value : state.selectedPrice) || 100;
    const lev = parseInt(levSelect ? levSelect.value : 5, 10);
    const allocPct = state.marginAllocPerTradePct;
    const tpPct = state.targetTpPct;

    const margin = +(state.totalEquity * (allocPct / 100)).toFixed(2);
    const notionalUsd = margin * lev;
    const amount = +(notionalUsd / entry).toFixed(4);
    const liqPrice = calculateLiqPrice(entry, lev, 'LONG');
    const tp1Price = +(entry * (1 + tpPct / 100)).toFixed(4);

    const now = new Date();
    const timeStr = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const newPos = {
      id: `pos_${Date.now()}`,
      symbol: sym,
      botId: 'manual',
      botBadge: 'MANUEL',
      side: 'LONG',
      entryPrice: entry,
      curPrice: entry,
      amount,
      margin,
      leverage: lev,
      liqPrice,
      tp1: tp1Price,
      openTime: timeStr
    };

    state.positions.unshift(newPos);
    savePositionsToStorage();
    renderMetrics();
    renderPositionsTable();
  }

  // ─── 5. Olay Dinleyicileri (Event Listeners) ───────────────────
  function setupEventListeners() {
    const refreshBtn = document.getElementById('btn-refresh-cockpit');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBotSignals();
        renderMetrics();
      });
    }

    const openSettingsBtn = document.getElementById('btn-open-settings');
    const modalBackdrop = document.getElementById('treasury-settings-modal');
    const closeModalBtn = document.getElementById('btn-close-modal');
    const saveSettingsBtn = document.getElementById('btn-save-settings');

    if (openSettingsBtn && modalBackdrop) {
      openSettingsBtn.addEventListener('click', () => {
        modalBackdrop.classList.add('open');
      });
    }

    if (closeModalBtn && modalBackdrop) {
      closeModalBtn.addEventListener('click', () => {
        modalBackdrop.classList.remove('open');
      });
    }

    if (saveSettingsBtn && modalBackdrop) {
      saveSettingsBtn.addEventListener('click', () => {
        const eq = parseFloat(document.getElementById('modal-equity').value);
        const rPct = parseFloat(document.getElementById('modal-risk-pct').value);
        const dLoss = parseFloat(document.getElementById('modal-daily-loss').value);
        const rPnl = parseFloat(document.getElementById('modal-realized-pnl').value);

        if (!isNaN(eq) && eq > 0) state.totalEquity = eq;
        if (!isNaN(rPct) && rPct > 0) state.marginAllocPerTradePct = rPct;
        if (!isNaN(dLoss) && dLoss > 0) state.maxPositionMarginPct = dLoss;
        if (!isNaN(rPnl)) state.dailyRealizedPnl = rPnl;

        saveSettingsToStorage();
        modalBackdrop.classList.remove('open');
        renderMetrics();
        renderBotMatrix();
        recalculatePositionSize();
      });
    }

    // Kasa Payı (Teminat) Butonları
    document.querySelectorAll('.risk-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.risk-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.marginAllocPerTradePct = parseFloat(btn.getAttribute('data-alloc'));
        recalculatePositionSize();
      });
    });

    // Hedef TP Butonları
    document.querySelectorAll('.tp-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tp-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.targetTpPct = parseFloat(btn.getAttribute('data-tp'));
        recalculatePositionSize();
      });
    });

    // Hesaplayıcı Girdi Değişiklikleri
    ['calc-entry', 'calc-leverage'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculatePositionSize);
    });

    // Pozisyon Ekle Butonu
    const addPosBtn = document.getElementById('btn-add-sim-position');
    if (addPosBtn) {
      addPosBtn.addEventListener('click', addCalculatedPosition);
    }
  }

  // ─── Üst Başlık Sayaçlarını Senkronize Etme ─────────────────────
  function updateHeaderCounters() {
    const totalSignals = state.bots.reduce((a, b) => a + b.count, 0);
    const countTag = document.getElementById('active-bot-count-tag');
    if (countTag) {
      countTag.textContent = `9/9 Aktif (${totalSignals} Canlı Sinyal)`;
    }
  }

  // ─── Harici Olaylar ve Senkronizasyon (EventBus) ───────────────
  function listenExternalEvents() {
    if (typeof EventBus === 'undefined') return;

    EventBus.on('symbol:selected', (symbol) => {
      if (!symbol) return;
      state.selectedSymbol = symbol.toUpperCase().replace('.P', '');
      const symInput = document.getElementById('calc-symbol');
      if (symInput) symInput.value = state.selectedSymbol;
    });

    EventBus.on('ticker:update', (data) => {
      if (!data || !data.symbol) return;
      const clean = data.symbol.toUpperCase().replace('.P', '');
      const price = parseFloat(data.price) || 0;

      let posChanged = false;
      state.positions.forEach(p => {
        if (p.symbol === clean && price > 0) {
          p.curPrice = price;
          posChanged = true;
        }
      });

      if (posChanged) {
        renderPositionsTable();
        renderMetrics();
      }

      if (clean === state.selectedSymbol && price > 0) {
        state.selectedPrice = price;
        const entryInput = document.getElementById('calc-entry');
        if (entryInput && document.activeElement !== entryInput) {
          entryInput.value = price;
          recalculatePositionSize();
        }
      }
    });

    EventBus.on('bot:signals_updated', () => {
      refreshBotSignals();
    });
  }

  // ─── Genel API & Başlatıcı ─────────────────────────────────────
  function init(targetContainerId = 'charts-viewport') {
    containerEl = document.getElementById(targetContainerId);
    if (!containerEl) {
      console.warn('[TreasuryCockpit] Hedef konteyner bulunamadi:', targetContainerId);
      return;
    }

    loadFromStorage();
    renderLayout();
    listenExternalEvents();

    refreshBotSignals();
    setInterval(() => {
      refreshBotSignals();
    }, 15000);

    console.log('[TreasuryCockpit] Stop-Losssuz Kasa & Bot Takip Kokpiti basariyla baslatildi.');
  }

  return {
    init,
    getState: () => state,
    refresh: refreshBotSignals,
    setSymbol: (sym, price) => {
      state.selectedSymbol = sym;
      if (price) state.selectedPrice = price;
      const sInput = document.getElementById('calc-symbol');
      const eInput = document.getElementById('calc-entry');
      if (sInput) sInput.value = sym;
      if (eInput && price) eInput.value = price;
      recalculatePositionSize();
    }
  };
})();
