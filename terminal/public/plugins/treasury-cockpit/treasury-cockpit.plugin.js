/**
 * treasury-cockpit.plugin.js — Bot Takip Ekranı, Kasa Defteri & Binance Canlı Senkronizasyon Modülü
 * Alpha Terminal 2.0 (Excel Tarzı Kasa Defteri & Binance Futures Read-Only API Entegrasyonu)
 */

const TreasuryCockpitPlugin = (() => {
  const STORAGE_KEY_SETTINGS = 'alpha_treasury_settings_v3';

  let state = {
    totalEquity: 16.10,             // Güncel Kasa (USDT)
    initialCapital: 10.00,          // Başlangıç Sermayesi
    ledgerStats: {
      initialCapital: 10.00,
      currentBalance: 16.10,
      netProfitUsd: 6.10,
      netReturnPct: 61.00,
      totalTrades: 30,
      winCount: 28,
      lossCount: 2,
      winRatePct: 93.3
    },
    ledgerTrades: [],
    activeTab: 'ledger',            // 'ledger' | 'binance_open' | 'calculator'
    binanceStatus: {
      configured: false,
      apiKeyMasked: null,
      autoSync: true,
      lastSyncTime: null
    },
    binancePositions: [],
    selectedSymbol: 'BTCUSDT',
    selectedPrice: 83500.00,
    marginAllocPerTradePct: 2.00,
    maxPositionMarginPct: 5.00,
    targetTpPct: 2.50,
    simPositions: []
  };

  let containerEl = null;

  // ─── Formatlayıcılar ───────────────────────────────────────────
  function formatMoney(val) {
    const num = parseFloat(val) || 0;
    return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function formatPercent(val) {
    const num = parseFloat(val) || 0;
    return `%${num.toFixed(2)}`;
  }

  // ─── Sunucu API İstekleri ──────────────────────────────────────
  async function fetchLedger() {
    try {
      const res = await fetch('/api/ledger/trades');
      if (res.ok) {
        const data = await res.json();
        if (data && data.trades) {
          state.ledgerTrades = data.trades;
          state.ledgerStats = data.stats || state.ledgerStats;
          state.totalEquity = state.ledgerStats.currentBalance;
          state.initialCapital = state.ledgerStats.initialCapital;
          renderMetrics();
          renderLedgerTable();
          renderSignatureStrip();
        }
      }
    } catch (e) {
      console.warn('[TreasuryCockpit] Defter verisi alinamadi:', e.message);
    }
  }

  async function fetchBinanceStatus() {
    try {
      const res = await fetch('/api/binance-read/status');
      if (res.ok) {
        state.binanceStatus = await res.json();
        updateBinanceStatusUI();
      }
    } catch (e) {
      console.warn('[TreasuryCockpit] Binance durumu alinamadi:', e.message);
    }
  }

  async function fetchBinancePositions() {
    try {
      const res = await fetch('/api/binance-read/positions');
      if (res.ok) {
        const data = await res.json();
        state.binancePositions = data.positions || [];
        renderBinancePositions();
      }
    } catch (e) {
      console.warn('[TreasuryCockpit] Binance pozisyonlari alinamadi:', e.message);
    }
  }

  async function triggerBinanceSync() {
    const syncBtn = document.getElementById('btn-sync-binance');
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.innerHTML = '⏳ Okunuyor...';
    }

    try {
      const res = await fetch('/api/binance-read/sync', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        if (data.syncRes && data.syncRes.syncedCount > 0) {
          alert(`✅ Binance'den ${data.syncRes.syncedCount} adet yeni kapanan islem basariyla Kasa Defteri'ne eklendi!`);
        } else {
          console.log('[TreasuryCockpit] Yeni kapanan Binance islemi bulunmuyor.');
        }
        await fetchLedger();
        await fetchBinancePositions();
        await fetchBinanceStatus();
      }
    } catch (e) {
      alert('Binance senkronizasyon hatasi: ' + e.message);
    } finally {
      if (syncBtn) {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '🔄 Binance\'den Oku';
      }
    }
  }

  // ─── Ana Arayüz İskelesi (Layout) ──────────────────────────────
  function renderLayout() {
    if (!containerEl) return;

    containerEl.innerHTML = `
      <div id="treasury-cockpit-container">
        <!-- 1. Üst Başlık ve Hızlı Eylem Bandı -->
        <div class="cockpit-top-banner">
          <div class="cockpit-title-box">
            <div class="cockpit-icon-badge">📖</div>
            <div class="cockpit-heading-group">
              <div class="cockpit-main-title">
                KASA YÖNETİMİ & BORSA İCRA DEFTERİ
                <span class="live-pulse-chip" style="background:rgba(16,185,129,0.2); color:#34d399; border-color:rgba(16,185,129,0.4);">
                  🟢 SADECE OKUMA (READ-ONLY) SENKRONİZASYON
                </span>
              </div>
              <div class="cockpit-sub-title">Excel Tarzı Kasa Takibi, Gerçekleşen Kâr/Zarar ve Binance Canlı Pozisyon İzleme</div>
            </div>
          </div>
          <div class="cockpit-banner-actions">
            <button class="cockpit-action-btn primary" id="btn-sync-binance" title="Binance Vadeli Hesabından Kapanan İşlemleri Oku">
              🔄 Binance'den Oku
            </button>
            <button class="cockpit-action-btn" id="btn-open-api-modal" title="Binance Sadece-Okuma API Ayarları">
              🔑 Binance API <span id="api-status-dot" style="display:inline-block; width:7px; height:7px; border-radius:50%; background:#64748b; margin-left:4px;"></span>
            </button>
            <button class="cockpit-action-btn" id="btn-open-add-trade-modal" title="Yeni İşlem Ekle">
              + Yeni İşlem
            </button>
            <button class="cockpit-action-btn" id="btn-export-csv" title="Excel / CSV Formatında İndir">
              📥 Excel/CSV
            </button>
            <button class="cockpit-action-btn" id="btn-open-settings" title="Kasa ve Sermaye Ayarları">
              ⚙️ Kasa Ayarları
            </button>
          </div>
        </div>

        <!-- 2. Kasa Özet Metrikleri (5 Kart) -->
        <div class="treasury-metrics-grid" id="treasury-metrics-grid">
          <!-- JS ile doldurulur -->
        </div>

        <!-- 3. Kasa Defteri & Çalışma Alanı -->
        <div class="ledger-view-wrapper">

          <!-- Excel İmza Şeridi (Kullanıcının Excel'indeki Başlık ve Yüzde Kutusu) -->
          <div class="ledger-signature-strip" id="ledger-signature-strip">
            <!-- JS ile doldurulur -->
          </div>

          <!-- Sekmeler ve Alt Eylem Çubuğu -->
          <div class="ledger-nav-bar">
            <div class="ledger-tabs-group">
              <button class="ledger-tab-btn active" data-tab="ledger" id="tab-btn-ledger">
                📖 Kasa Defteri (Excel Tarzı Günlük)
              </button>
              <button class="ledger-tab-btn" data-tab="binance_open" id="tab-btn-binance">
                ⚡ Canlı Binance Pozisyonları <span id="binance-pos-count-badge" style="font-size:9px; background:rgba(16,185,129,0.3); color:#34d399; padding:1px 5px; border-radius:10px; margin-left:4px;">0</span>
              </button>
              <button class="ledger-tab-btn" data-tab="calculator" id="tab-btn-calc">
                🧮 SL'siz Kasa Marjin & Likidasyon Hesaplayıcı
              </button>
            </div>
            <div class="ledger-actions-group">
              <span id="ledger-count-info" style="font-size:11.5px; color:#94a3b8; font-family:'JetBrains Mono',monospace;">30 Kayıtlı İşlem</span>
            </div>
          </div>

          <!-- Sekme 1: Excel Tarzı Kasa Defteri Tablosu -->
          <div id="tab-content-ledger" class="ledger-table-wrap">
            <table class="ledger-table">
              <thead>
                <tr>
                  <th style="width: 110px;">COIN</th>
                  <th style="width: 100px;">TARİH</th>
                  <th style="width: 80px;">SAAT</th>
                  <th style="width: 60px; text-align:center;">POZ</th>
                  <th style="width: 100px; text-align:right;">KAZANÇ ($)</th>
                  <th style="width: 110px; text-align:right;">KASA ($)</th>
                  <th class="th-excel-green" style="width: 100px; text-align:right;">YÜZDE</th>
                  <th class="th-excel-green">AçıklaMA (Notlar & Psikoloji)</th>
                  <th style="width: 70px; text-align:right;">İŞLEM</th>
                </tr>
              </thead>
              <tbody id="ledger-tbody">
                <!-- JS ile doldurulur -->
              </tbody>
            </table>
          </div>

          <!-- Sekme 2: Binance Canlı Açık Pozisyonlar -->
          <div id="tab-content-binance" class="ledger-table-wrap" style="display: none; padding: 12px;">
            <div id="binance-positions-container">
              <!-- JS ile doldurulur -->
            </div>
          </div>

          <!-- Sekme 3: SL'siz Marjin & Likidasyon Hesaplayıcı -->
          <div id="tab-content-calc" style="display: none;">
            <div class="workbench-split-grid" style="padding: 0;">
              <!-- Sol: Açıklama ve Kasa Kuralı -->
              <div class="workbench-panel">
                <div class="panel-header">
                  <div class="panel-title">
                    <span>🛡️ SL'siz Kasa Yönetimi Prensipleri</span>
                  </div>
                  <span style="font-size:11px; color:#38bdf8; font-weight:700;">DİSİPLİN & GÜVENLİK</span>
                </div>
                <div style="font-size:12.5px; color:#cbd5e1; line-height:1.7; padding:10px 0;">
                  <p>• <b>Stop-Loss Kullanılmaz:</b> Piyasada ani iğnelerle (stop hunt) patlamamak için stop-loss yerine kasa teminat payı (%1-%5) ve düşük kaldıraç (1x-5x) kullanılır.</p>
                  <p style="margin-top:8px;">• <b>Likidasyon Güvenlik Mesafesi:</b> Likidasyon fiyatı anlık fiyatın en az %15-%30 uzağında tutularak piyasa çöküşlerine karşı kalkan oluşturulur.</p>
                  <p style="margin-top:8px;">• <b>Kademeli Kâr Alımı (TP):</b> Hedef seviyelerde (+%2.5, +%5.0) kâr realize edilerek kasa kümülatif olarak büyütülür.</p>
                  <p style="margin-top:8px;">• <b>Binance Entegrasyonu:</b> Binance üzerinde işleme girdiğinizde pozisyon anında izlenir, pozisyon kapandığında ise kâr/zararı kuruşu kuruşuna Kasa Defteri'ne otomatik geçer.</p>
                </div>
              </div>

              <!-- Sağ: Hesaplayıcı Formu -->
              <div class="workbench-panel">
                <div class="panel-header">
                  <div class="panel-title">
                    <span>🧮 Kasa Marjin & Likidasyon Hesaplayıcı</span>
                  </div>
                  <span style="font-size:11px; color:#38bdf8; font-weight:700;">HESAPLAMA MOTORU</span>
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
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- 4. Binance Sadece-Okuma (Read-Only) API Modalı -->
        <div class="treasury-modal-backdrop" id="binance-api-modal">
          <div class="treasury-modal-card" style="width: 480px;">
            <div class="tm-header">
              <span class="tm-title">🔑 BİNANCE SADECE-OKUMA (READ-ONLY) BAĞLANTISI</span>
              <button class="tm-close-btn" id="btn-close-api-modal">✕</button>
            </div>
            
            <div style="background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.3); border-radius:6px; padding:10px; font-size:12px; color:#6ee7b7; line-height:1.5;">
              🛡️ <b>Maksimum Güvenlik Garantisi:</b><br />
              Binance hesabınızda API oluştururken <b>yalnızca "Can Read" (Sadece Okuma)</b> kutusunu işaretleyiniz. Alım-Satım veya Çekim izinlerine ASLA ihtiyaç yoktur ve sistem bu izinleri kabul etmez.
            </div>

            <div class="calc-form">
              <div class="calc-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
                <span class="calc-label">Binance API Key</span>
                <input type="text" id="api-input-key" class="calc-input" style="width:100%; text-align:left;" placeholder="Binance API Key giriniz..." autocomplete="off" spellcheck="false" />
              </div>

              <div class="calc-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
                <span class="calc-label">Binance API Secret</span>
                <input type="password" id="api-input-secret" class="calc-input" style="width:100%; text-align:left;" placeholder="Binance API Secret giriniz..." autocomplete="off" spellcheck="false" />
              </div>

              <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
                <input type="checkbox" id="api-input-autosync" checked style="accent-color:#10b981; width:16px; height:16px; cursor:pointer;" />
                <label for="api-input-autosync" style="font-size:12px; color:#e2e8f0; cursor:pointer;">
                  İşlem kapanınca otomatik deftere işle (Her 15 saniyede bir oku)
                </label>
              </div>

              <div id="api-test-feedback" style="display:none; padding:8px; border-radius:5px; font-size:11.5px; margin-top:4px;"></div>

              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
                <button class="ledger-btn" id="btn-cancel-api-modal">İptal</button>
                <button class="ledger-btn primary" id="btn-save-api-config">Bağlantıyı Test Et ve Kaydet</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 5. Manuel İşlem Ekleme Modalı -->
        <div class="treasury-modal-backdrop" id="manual-trade-modal">
          <div class="treasury-modal-card" style="width: 440px;">
            <div class="tm-header">
              <span class="tm-title">➕ KASA DEFTERİNE YENİ İŞLEM EKLE</span>
              <button class="tm-close-btn" id="btn-close-trade-modal">✕</button>
            </div>
            
            <div class="calc-form">
              <div class="calc-row">
                <span class="calc-label">Coin (Sembol)</span>
                <input type="text" id="manual-coin" class="calc-input" placeholder="Örn: SOL" value="SOL" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Yön (Pozisyon)</span>
                <select id="manual-side" class="calc-input" style="padding:4px 6px;">
                  <option value="L">L (LONG - Yükseliş)</option>
                  <option value="S">S (SHORT - Düşüş)</option>
                </select>
              </div>
              <div class="calc-row">
                <span class="calc-label">Kâr / Zarar ($)</span>
                <input type="number" id="manual-profit" class="calc-input" step="0.01" placeholder="Örn: 1.50 veya -2.00" value="1.50" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Tarih</span>
                <input type="text" id="manual-date" class="calc-input" placeholder="GG.AA.YYYY" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Saat</span>
                <input type="text" id="manual-time" class="calc-input" placeholder="SS:DD" />
              </div>
              <div class="calc-row" style="flex-direction:column; align-items:flex-start; gap:4px;">
                <span class="calc-label">Açıklama (Trader Notu / Strateji)</span>
                <input type="text" id="manual-note" class="calc-input" style="width:100%; text-align:left;" placeholder="Örn: M1 + Hammer 2 Yıldız..." />
              </div>

              <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:8px;">
                <button class="ledger-btn" id="btn-cancel-trade-modal">İptal</button>
                <button class="ledger-btn primary" id="btn-submit-manual-trade">Deftere Ekle</button>
              </div>
            </div>
          </div>
        </div>

        <!-- 6. Kasa Ayarları Modalı -->
        <div class="treasury-modal-backdrop" id="treasury-settings-modal">
          <div class="treasury-modal-card">
            <div class="tm-header">
              <span class="tm-title">⚙️ KASA VE SERMAYE AYARLARI</span>
              <button class="tm-close-btn" id="btn-close-modal">✕</button>
            </div>
            <div class="calc-form">
              <div class="calc-row">
                <span class="calc-label">Başlangıç Sermayesi ($)</span>
                <input type="number" id="modal-initial-capital" class="calc-input" value="${state.initialCapital}" step="1" />
              </div>
              <div class="calc-row">
                <span class="calc-label">İşlem Başı Teminat Limiti (%)</span>
                <input type="number" id="modal-risk-pct" class="calc-input" value="${state.marginAllocPerTradePct}" step="0.5" />
              </div>
              <div class="calc-row">
                <span class="calc-label">Tek Coine Max Teminat (%)</span>
                <input type="number" id="modal-max-margin-pct" class="calc-input" value="${state.maxPositionMarginPct}" step="0.5" />
              </div>

              <div style="border-top:1px solid rgba(255,255,255,0.08); padding-top:10px; margin-top:6px; display:flex; justify-content:space-between; align-items:center;">
                <button class="ledger-btn" id="btn-reset-excel-default" style="color:#f87171;" title="Excel tablosundaki orijinal 30 işleme geri dön">
                  ⚠️ Excel Tablosunu Sıfırla
                </button>
                <button class="calc-submit-btn" id="btn-save-settings" style="margin-top:0;">
                  Kaydet ve Uygula
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;

    renderMetrics();
    renderSignatureStrip();
    renderLedgerTable();
    setupEventListeners();
    recalculatePositionSize();
  }

  // ─── 1. Kasa Metrik Kartları (5 Kart) ──────────────────────────
  function renderMetrics() {
    const gridEl = document.getElementById('treasury-metrics-grid');
    if (!gridEl) return;

    const stats = state.ledgerStats;
    const currentEquity = stats.currentBalance || state.totalEquity;
    const initialCap = stats.initialCapital || state.initialCapital;
    const netProfit = stats.netProfitUsd || (currentEquity - initialCap);
    const returnPct = stats.netReturnPct || ((netProfit / initialCap) * 100);

    gridEl.innerHTML = `
      <!-- Kart 1: Güncel Kasa -->
      <div class="treasury-card glow-gold">
        <div class="t-card-header">
          <span class="t-card-title">Güncel Kasa Bakiyesi</span>
          <span class="t-card-icon">💰</span>
        </div>
        <div class="t-card-value">${formatMoney(currentEquity)}</div>
        <div class="t-card-sub">
          <span>Net Defter Kârı</span>
          <span class="${netProfit >= 0 ? 'badge-up' : 'badge-down'}">${(netProfit >= 0 ? '+' : '')}${formatMoney(netProfit)}</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #f59e0b;"></div>
        </div>
      </div>

      <!-- Kart 2: Başlangıç Sermayesi -->
      <div class="treasury-card glow-blue">
        <div class="t-card-header">
          <span class="t-card-title">Başlangıç Sermayesi</span>
          <span class="t-card-icon">💼</span>
        </div>
        <div class="t-card-value" style="color: #38bdf8;">${formatMoney(initialCap)}</div>
        <div class="t-card-sub">
          <span>İlk Yatırılan</span>
          <span style="color:#cbd5e1;">Excel Defteri</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #38bdf8;"></div>
        </div>
      </div>

      <!-- Kart 3: Net Kazanç ($) -->
      <div class="treasury-card glow-green">
        <div class="t-card-header">
          <span class="t-card-title">Kümülatif Net Kazanç</span>
          <span class="t-card-icon">💵</span>
        </div>
        <div class="t-card-value" style="color: #34d399;">${(netProfit >= 0 ? '+' : '')}${formatMoney(netProfit)}</div>
        <div class="t-card-sub">
          <span>Kasa Çarpanı</span>
          <span class="badge-up">${(currentEquity / initialCap).toFixed(2)}x Büyüme</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #10b981;"></div>
        </div>
      </div>

      <!-- Kart 4: Toplam Yüzde Getiri (ROI) -->
      <div class="treasury-card glow-cyan">
        <div class="t-card-header">
          <span class="t-card-title">Toplam Yüzde Getiri</span>
          <span class="t-card-icon">🚀</span>
        </div>
        <div class="t-card-value" style="color: #22d3ee;">+${formatPercent(returnPct)}</div>
        <div class="t-card-sub">
          <span>Başarı Oranı</span>
          <span class="badge-up">${stats.winRatePct || 93.3}% (${stats.winCount || 28}W / ${stats.lossCount || 2}L)</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: ${Math.min(100, returnPct)}%; background: #06b6d4;"></div>
        </div>
      </div>

      <!-- Kart 5: Binance Sadece-Okuma Durumu -->
      <div class="treasury-card glow-purple">
        <div class="t-card-header">
          <span class="t-card-title">Binance Canlı Okuma</span>
          <span class="t-card-icon">⚡</span>
        </div>
        <div class="t-card-value" style="color: ${state.binanceStatus.configured ? '#34d399' : '#94a3b8'}; font-size:16px;">
          ${state.binanceStatus.configured ? '🟢 BAĞLI (OKUYOR)' : '⚪ API TANIMSIZ'}
        </div>
        <div class="t-card-sub">
          <span>Kapanınca Otomatik</span>
          <span style="color:#a855f7; font-weight:700;">${state.binanceStatus.autoSync ? '15sn Aktif' : 'Manuel'}</span>
        </div>
        <div class="t-card-bar-wrap">
          <div class="t-card-bar-fill" style="width: 100%; background: #a855f7;"></div>
        </div>
      </div>
    `;
  }

  // ─── 2. Excel İmza Bandı (Kullanıcının Görselindeki Özel Çubuk) ──
  function renderSignatureStrip() {
    const stripEl = document.getElementById('ledger-signature-strip');
    if (!stripEl) return;

    const stats = state.ledgerStats;
    const initialCap = stats.initialCapital || state.initialCapital;
    const currentEquity = stats.currentBalance || state.totalEquity;
    const netProfit = stats.netProfitUsd || (currentEquity - initialCap);
    const returnPct = stats.netReturnPct || ((netProfit / initialCap) * 100);

    stripEl.innerHTML = `
      <div class="ledger-sig-left">
        <div class="ledger-title-group">
          <div class="ledger-main-title">
            <span>📊 CANLI KASA DEFTERİ</span>
            <span style="font-size:11px; font-weight:600; color:#38bdf8;">(Excel İşlem Günlüğü)</span>
          </div>
          <div class="ledger-sub-title">İşlem kapatıldığında Binance API otomatik okur, kasanıza anında işler.</div>
        </div>
      </div>

      <div class="ledger-sig-metrics">
        <!-- Sermaye -->
        <div class="ledger-stat-chip">
          <span class="ledger-stat-lbl">SERMAYE</span>
          <span class="ledger-stat-val">${formatMoney(initialCap)}</span>
        </div>

        <!-- Güncel Kasa -->
        <div class="ledger-stat-chip">
          <span class="ledger-stat-lbl">GÜNCEL KASA</span>
          <span class="ledger-stat-val" style="color:#fbbf24;">${formatMoney(currentEquity)}</span>
        </div>

        <!-- Net Kazanç -->
        <div class="ledger-stat-chip">
          <span class="ledger-stat-lbl">NET KAZANÇ</span>
          <span class="ledger-stat-val" style="color:#34d399;">+${formatMoney(netProfit)}</span>
        </div>

        <!-- Excel Görselindeki Özel Büyük Yeşil Yüzde Kutusu -->
        <div class="ledger-stat-chip highlight-green-box">
          <span class="ledger-stat-lbl">YÜZDE GETİRİ</span>
          <span class="ledger-stat-val">+${formatPercent(returnPct)}</span>
        </div>
      </div>
    `;
  }

  // ─── 3. Kasa Defteri Tablosu Render Etme ───────────────────────
  function renderLedgerTable() {
    const tbody = document.getElementById('ledger-tbody');
    const countInfo = document.getElementById('ledger-count-info');
    if (!tbody) return;

    if (countInfo) {
      countInfo.textContent = `${state.ledgerTrades.length} Kayıtlı İşlem`;
    }

    if (state.ledgerTrades.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center; padding:32px; color:#94a3b8;">
            Defterde henüz kayıtlı işlem bulunmuyor. Yukarıdaki <b>"+ Yeni İşlem"</b> veya <b>"🔄 Binance'den Oku"</b> butonuna basabilirsiniz.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.ledgerTrades.map((t, idx) => {
      const isInitial = t.id === 't_00';
      const profit = parseFloat(t.profitUsd) || 0;
      const isUp = profit >= 0;
      const profitClass = isInitial ? '' : (isUp ? 'profit-green' : 'profit-red');
      const pctClass = isInitial ? '' : (isUp ? 'pct-pill-green' : 'pct-pill-red');
      const sidePill = t.side === 'L' 
        ? `<span class="pos-pill-l">L</span>` 
        : (t.side === 'S' ? `<span class="pos-pill-s">S</span>` : `<span style="color:#94a3b8;">—</span>`);

      const cleanCoin = (t.coin || t.symbol || 'COIN').toUpperCase().replace('USDT', '');
      const noteText = t.notes || '';

      return `
        <tr data-trade-id="${t.id}" class="${isInitial ? 'row-initial' : ''}">
          <!-- COIN -->
          <td>
            <span class="ledger-coin-badge btn-jump-coin" data-sym="${t.symbol || cleanCoin + 'USDT'}" title="${cleanCoin} grafiğine git">
              ${cleanCoin} <span style="font-size:10px; opacity:0.7;">↗</span>
            </span>
          </td>

          <!-- TARİH -->
          <td style="color:#cbd5e1;">${t.date}</td>

          <!-- SAAT -->
          <td style="color:#94a3b8;">${t.time}</td>

          <!-- POZ (YÖN) -->
          <td style="text-align:center;">${sidePill}</td>

          <!-- KAZANÇ ($) -->
          <td style="text-align:right;" class="${profitClass}">
            ${isInitial ? '$0.00' : (isUp ? '+' : '') + formatMoney(profit)}
          </td>

          <!-- KASA ($) -->
          <td style="text-align:right;" class="kasa-cell">
            ${formatMoney(t.runningBalance)}
          </td>

          <!-- YÜZDE (%) -->
          <td style="text-align:right;">
            <span class="${pctClass}">${(t.returnPct >= 0 ? '%' : '-%') + Math.abs(t.returnPct).toFixed(2).replace('.', ',')}</span>
          </td>

          <!-- AÇIKLAMA (Notlar - Tıklayınca düzenlenebilir) -->
          <td>
            <div class="ledger-note-cell btn-edit-note" data-id="${t.id}" title="Notu düzenlemek için tıkla">
              ${noteText ? noteText : '<span style="color:#64748b; font-style:italic;">Not eklemek için tıkla...</span>'}
            </div>
          </td>

          <!-- İŞLEM (Sil / Detay) -->
          <td style="text-align:right;">
            ${isInitial ? '' : `
              <button class="ledger-action-mini-btn btn-delete-trade" data-id="${t.id}" title="Bu işlemi defterden sil">
                🗑️
              </button>
            `}
          </td>
        </tr>
      `;
    }).join('');

    // Coin Tıklama (Grafiğe / İzleme Listesine Odaklanma)
    tbody.querySelectorAll('.btn-jump-coin').forEach(btn => {
      btn.addEventListener('click', () => {
        const sym = btn.getAttribute('data-sym');
        if (typeof EventBus !== 'undefined' && sym) {
          EventBus.emit('symbol:selected', sym);
        }
      });
    });

    // Not Düzenleme
    tbody.querySelectorAll('.btn-edit-note').forEach(cell => {
      cell.addEventListener('click', () => {
        const tradeId = cell.getAttribute('data-id');
        const currentTrade = state.ledgerTrades.find(t => t.id === tradeId);
        if (!currentTrade) return;

        const currentVal = currentTrade.notes || '';
        cell.innerHTML = `
          <input type="text" class="ledger-note-input" value="${currentVal.replace(/"/g, '&quot;')}" />
        `;
        const input = cell.querySelector('.ledger-note-input');
        input.focus();

        const saveNote = async () => {
          const newVal = input.value.trim();
          await fetch(`/api/ledger/trades/${tradeId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes: newVal })
          });
          currentTrade.notes = newVal;
          renderLedgerTable();
        };

        input.addEventListener('blur', saveNote);
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            input.removeEventListener('blur', saveNote);
            saveNote();
          }
        });
      });
    });

    // İşlem Silme
    tbody.querySelectorAll('.btn-delete-trade').forEach(btn => {
      btn.addEventListener('click', async () => {
        const tradeId = btn.getAttribute('data-id');
        if (!confirm('Bu işlemi defterden silmek istediğinize emin misiniz?')) return;
        
        await fetch(`/api/ledger/trades/${tradeId}`, { method: 'DELETE' });
        await fetchLedger();
      });
    });
  }

  // ─── 4. Canlı Binance Pozisyonları Render Etme ─────────────────
  function renderBinancePositions() {
    const container = document.getElementById('binance-positions-container');
    const badge = document.getElementById('binance-pos-count-badge');
    if (badge) badge.textContent = state.binancePositions.length;
    if (!container) return;

    if (!state.binanceStatus.configured) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:#94a3b8;">
          <div style="font-size:32px; margin-bottom:8px;">🔑</div>
          <div style="font-size:14px; font-weight:700; color:#f1f5f9; margin-bottom:6px;">Binance Sadece-Okuma API Bağlantısı Gerekli</div>
          <div style="font-size:12px; max-width:440px; margin:0 auto 14px auto;">
            Binance Futures hesabınızdaki açık pozisyonları anlık görmek ve işlem kapatılınca kâr/zararı deftere otomatik aktarmak için Sadece-Okuma (Can Read) API anahtarınızı giriniz.
          </div>
          <button class="ledger-btn primary" id="btn-connect-binance-banner">Binance API'yi Bağla</button>
        </div>
      `;
      const btn = container.querySelector('#btn-connect-binance-banner');
      if (btn) btn.addEventListener('click', openApiModal);
      return;
    }

    if (state.binancePositions.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:36px 16px; color:#94a3b8;">
          <div style="font-size:32px; margin-bottom:8px;">🛡️</div>
          <div style="font-size:14px; font-weight:700; color:#34d399; margin-bottom:6px;">Binance Vadeli Açık Pozisyon Bulunmuyor</div>
          <div style="font-size:12px;">Binance hesabınızda yeni bir vadeli işleme girdiğinizde anında burada listelenecektir. İşlemi kapattığınızda ise kâr/zararı kuruşu kuruşuna Kasa Defteri'ne otomatik yazılacaktır.</div>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="binance-open-pos-strip" style="margin-bottom:12px;">
        <div style="display:flex; align-items:center; gap:8px;">
          <span>🟢</span>
          <span style="font-size:12.5px; font-weight:700; color:#ffffff;">Binance Futures Canlı Takip Edilen ${state.binancePositions.length} Pozisyon</span>
        </div>
        <div style="font-size:11px; color:#94a3b8;">
          Bu işlemler Binance üzerinde kapatıldığında kâr/zararı Kasa Defteri'ne otomatik işlenecektir.
        </div>
      </div>

      <table class="ledger-table">
        <thead>
          <tr>
            <th>Sembol</th>
            <th>Yön</th>
            <th>Miktar</th>
            <th>Giriş Fiyatı</th>
            <th>Mark Fiyat</th>
            <th>Kaldıraç / Marjin</th>
            <th>Likidasyon & Tampon</th>
            <th style="text-align:right;">Anlık Kâr ($ uPnL)</th>
          </tr>
        </thead>
        <tbody>
          ${state.binancePositions.map(p => {
            const isUp = p.unRealizedProfit >= 0;
            return `
              <tr>
                <td><b style="color:#38bdf8;">${p.symbol}</b></td>
                <td><span class="${p.side === 'LONG' ? 'pos-pill-l' : 'pos-pill-s'}">${p.side}</span></td>
                <td>${p.amount}</td>
                <td>$${p.entryPrice}</td>
                <td>$${p.markPrice}</td>
                <td>${p.leverage}x ($${p.margin})</td>
                <td>
                  <span style="color:#f87171;">$${p.liqPrice}</span> 
                  <span style="font-size:10px; color:#34d399;">(%${p.liqDistancePct} Güvenli)</span>
                </td>
                <td style="text-align:right; font-weight:700; color:${isUp ? '#34d399' : '#f87171'};">
                  ${isUp ? '+' : ''}${formatMoney(p.unRealizedProfit)}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  // ─── 5. SL'siz Kasa Marjin & Likidasyon Hesaplayıcı ─────────────
  function recalculatePositionSize() {
    const entryInput = document.getElementById('calc-entry');
    const levSelect = document.getElementById('calc-leverage');

    const entry = parseFloat(entryInput ? entryInput.value : state.selectedPrice) || 1;
    const lev = parseInt(levSelect ? levSelect.value : 5, 10) || 5;
    const allocPct = state.marginAllocPerTradePct;
    const tpPct = state.targetTpPct;

    const marginUsd = +(state.totalEquity * (allocPct / 100)).toFixed(2);
    const notionalUsd = +(marginUsd * lev).toFixed(2);
    const liqPrice = +(entry * (1 - (1 / lev) * 0.95)).toFixed(2);
    const liqDistPct = +(((entry - liqPrice) / entry) * 100).toFixed(1);
    const tpProfitUsd = +(notionalUsd * (tpPct / 100)).toFixed(2);
    const tpRoePct = +((tpProfitUsd / marginUsd) * 100).toFixed(1);

    const resMargin = document.getElementById('res-margin-usd');
    const resNotional = document.getElementById('res-notional-usd');
    const resLiqPrice = document.getElementById('res-liq-price');
    const resLiqDist = document.getElementById('res-liq-dist');
    const resTpProfit = document.getElementById('res-tp-profit');

    if (resMargin) resMargin.textContent = `${formatMoney(marginUsd)} (%${allocPct.toFixed(1)})`;
    if (resNotional) resNotional.textContent = `${formatMoney(notionalUsd)} (${lev}x)`;
    if (resLiqPrice) resLiqPrice.textContent = liqPrice > 0 ? `$${liqPrice}` : 'Yok (Spot)';
    if (resLiqDist) resLiqDist.textContent = `${liqDistPct}% (🟢 GÜVENLİ TAMPON)`;
    if (resTpProfit) resTpProfit.textContent = `+${formatMoney(tpProfitUsd)} (+${tpRoePct}% Marjin Kârı)`;
  }

  // ─── 6. CSV / Excel İndirme ────────────────────────────────────
  function exportLedgerCsv() {
    if (!state.ledgerTrades || state.ledgerTrades.length === 0) {
      alert('İndirilecek işlem bulunmuyor.');
      return;
    }

    let csv = '\uFEFFCOIN;TARİH;SAAT;POZ;KAZANÇ;KASA;YÜZDE;AÇIKLAMA\n';
    state.ledgerTrades.forEach(t => {
      const cleanCoin = (t.coin || t.symbol || '').replace('USDT', '');
      csv += `${cleanCoin};${t.date};${t.time};${t.side};${t.profitUsd};${t.runningBalance};%${t.returnPct};"${(t.notes || '').replace(/"/g, '""')}"\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kasa_defteri_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ─── 7. Modal Yöneticileri ─────────────────────────────────────
  function openApiModal() {
    const modal = document.getElementById('binance-api-modal');
    if (!modal) return;
    const keyInput = document.getElementById('api-input-key');
    const secretInput = document.getElementById('api-input-secret');
    const autoSyncInput = document.getElementById('api-input-autosync');
    const feedback = document.getElementById('api-test-feedback');

    if (keyInput) keyInput.value = state.binanceStatus.apiKeyMasked || '';
    if (secretInput) secretInput.value = '';
    if (autoSyncInput) autoSyncInput.checked = state.binanceStatus.autoSync !== false;
    if (feedback) feedback.style.display = 'none';

    modal.classList.add('open');
  }

  function closeApiModal() {
    const modal = document.getElementById('binance-api-modal');
    if (modal) modal.classList.remove('open');
  }

  function openTradeModal() {
    const modal = document.getElementById('manual-trade-modal');
    if (!modal) return;
    const now = new Date();
    const dateInput = document.getElementById('manual-date');
    const timeInput = document.getElementById('manual-time');
    if (dateInput) dateInput.value = now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    if (timeInput) timeInput.value = now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    modal.classList.add('open');
  }

  function closeTradeModal() {
    const modal = document.getElementById('manual-trade-modal');
    if (modal) modal.classList.remove('open');
  }

  function updateBinanceStatusUI() {
    const dot = document.getElementById('api-status-dot');
    if (dot) {
      dot.style.background = state.binanceStatus.configured ? '#10b981' : '#64748b';
      dot.style.boxShadow = state.binanceStatus.configured ? '0 0 6px #10b981' : 'none';
    }
  }

  // ─── 8. Olay Dinleyicileri (Event Listeners) ───────────────────
  function setupEventListeners() {
    // Sekme Değişimi
    ['ledger', 'binance_open', 'calculator'].forEach(tab => {
      const btn = document.getElementById(`tab-btn-${tab === 'binance_open' ? 'binance' : (tab === 'calculator' ? 'calc' : 'ledger')}`);
      if (!btn) return;
      btn.addEventListener('click', () => {
        document.querySelectorAll('.ledger-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeTab = tab;

        document.getElementById('tab-content-ledger').style.display = tab === 'ledger' ? 'block' : 'none';
        document.getElementById('tab-content-binance').style.display = tab === 'binance_open' ? 'block' : 'none';
        document.getElementById('tab-content-calc').style.display = tab === 'calculator' ? 'block' : 'none';

        if (tab === 'binance_open') fetchBinancePositions();
      });
    });

    // Binance Sync Butonu
    const syncBtn = document.getElementById('btn-sync-binance');
    if (syncBtn) syncBtn.addEventListener('click', triggerBinanceSync);

    // API Modal Butonları
    const openApiBtn = document.getElementById('btn-open-api-modal');
    const closeApiBtn = document.getElementById('btn-close-api-modal');
    const cancelApiBtn = document.getElementById('btn-cancel-api-modal');
    const saveApiBtn = document.getElementById('btn-save-api-config');

    if (openApiBtn) openApiBtn.addEventListener('click', openApiModal);
    if (closeApiBtn) closeApiBtn.addEventListener('click', closeApiModal);
    if (cancelApiBtn) cancelApiBtn.addEventListener('click', closeApiModal);

    if (saveApiBtn) {
      saveApiBtn.addEventListener('click', async () => {
        const apiKey = document.getElementById('api-input-key').value.trim();
        const apiSecret = document.getElementById('api-input-secret').value.trim();
        const autoSync = document.getElementById('api-input-autosync').checked;
        const feedback = document.getElementById('api-test-feedback');

        saveApiBtn.disabled = true;
        saveApiBtn.textContent = 'Test Ediliyor...';

        try {
          const res = await fetch('/api/binance-read/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiSecret, autoSync })
          });
          const data = await res.json();
          feedback.style.display = 'block';

          if (data.success) {
            feedback.style.background = 'rgba(16,185,129,0.18)';
            feedback.style.color = '#34d399';
            feedback.style.border = '1px solid rgba(16,185,129,0.4)';
            feedback.innerHTML = `✅ <b>Bağlantı Başarılı!</b> Sadece Okuma (Read-Only) erişimi teyit edildi.<br/>Cüzdan Bakiyesi: $${data.testResult.totalWalletBalance}`;
            
            await fetchBinanceStatus();
            await fetchBinancePositions();
            setTimeout(closeApiModal, 1500);
          } else {
            feedback.style.background = 'rgba(239,68,68,0.18)';
            feedback.style.color = '#f87171';
            feedback.style.border = '1px solid rgba(239,68,68,0.4)';
            feedback.innerHTML = `❌ <b>Bağlantı Başarısız:</b> ${data.testResult?.message || data.error || 'Bilinmeyen hata'}`;
          }
        } catch (e) {
          feedback.style.display = 'block';
          feedback.style.background = 'rgba(239,68,68,0.18)';
          feedback.style.color = '#f87171';
          feedback.textContent = 'Hata: ' + e.message;
        } finally {
          saveApiBtn.disabled = false;
          saveApiBtn.textContent = 'Bağlantıyı Test Et ve Kaydet';
        }
      });
    }

    // Manuel İşlem Modal Butonları
    const openTradeBtn = document.getElementById('btn-open-add-trade-modal');
    const closeTradeBtn = document.getElementById('btn-close-trade-modal');
    const cancelTradeBtn = document.getElementById('btn-cancel-trade-modal');
    const submitTradeBtn = document.getElementById('btn-submit-manual-trade');

    if (openTradeBtn) openTradeBtn.addEventListener('click', openTradeModal);
    if (closeTradeBtn) closeTradeBtn.addEventListener('click', closeTradeModal);
    if (cancelTradeBtn) cancelTradeBtn.addEventListener('click', closeTradeModal);

    if (submitTradeBtn) {
      submitTradeBtn.addEventListener('click', async () => {
        const coin = document.getElementById('manual-coin').value.trim();
        const side = document.getElementById('manual-side').value;
        const profit = parseFloat(document.getElementById('manual-profit').value);
        const date = document.getElementById('manual-date').value.trim();
        const time = document.getElementById('manual-time').value.trim();
        const notes = document.getElementById('manual-note').value.trim();

        if (!coin || isNaN(profit)) {
          alert('Lütfen Coin ve Kâr/Zarar tutarını geçerli giriniz.');
          return;
        }

        await fetch('/api/ledger/trades', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coin, side, profitUsd: profit, date, time, notes })
        });

        closeTradeModal();
        await fetchLedger();
      });
    }

    // CSV İndirme
    const exportBtn = document.getElementById('btn-export-csv');
    if (exportBtn) exportBtn.addEventListener('click', exportLedgerCsv);

    // Kasa Ayarları Modalı
    const openSettingsBtn = document.getElementById('btn-open-settings');
    const modalBackdrop = document.getElementById('treasury-settings-modal');
    const closeModalBtn = document.getElementById('btn-close-modal');
    const saveSettingsBtn = document.getElementById('btn-save-settings');
    const resetExcelBtn = document.getElementById('btn-reset-excel-default');

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
      saveSettingsBtn.addEventListener('click', async () => {
        const initCap = parseFloat(document.getElementById('modal-initial-capital').value);
        const rPct = parseFloat(document.getElementById('modal-risk-pct').value);
        const dLoss = parseFloat(document.getElementById('modal-max-margin-pct').value);

        if (!isNaN(initCap) && initCap > 0) {
          await fetch('/api/ledger/initial-capital', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ capital: initCap })
          });
        }
        if (!isNaN(rPct) && rPct > 0) state.marginAllocPerTradePct = rPct;
        if (!isNaN(dLoss) && dLoss > 0) state.maxPositionMarginPct = dLoss;

        modalBackdrop.classList.remove('open');
        await fetchLedger();
        recalculatePositionSize();
      });
    }

    if (resetExcelBtn) {
      resetExcelBtn.addEventListener('click', async () => {
        if (!confirm('Tüm defteri orijinal Excel tablosundaki 30 işleme sıfırlamak istediğinize emin misiniz?')) return;
        await fetch('/api/ledger/reset-default', { method: 'POST' });
        modalBackdrop.classList.remove('open');
        await fetchLedger();
      });
    }

    // Risk Pill Butonları
    document.querySelectorAll('.risk-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.risk-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.marginAllocPerTradePct = parseFloat(btn.getAttribute('data-alloc'));
        recalculatePositionSize();
      });
    });

    // TP Pill Butonları
    document.querySelectorAll('.tp-pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tp-pill-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.targetTpPct = parseFloat(btn.getAttribute('data-tp'));
        recalculatePositionSize();
      });
    });

    // Hesaplayıcı Girdileri
    ['calc-entry', 'calc-leverage'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', recalculatePositionSize);
    });
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

      if (clean === state.selectedSymbol && price > 0) {
        state.selectedPrice = price;
        const entryInput = document.getElementById('calc-entry');
        if (entryInput && document.activeElement !== entryInput) {
          entryInput.value = price;
          recalculatePositionSize();
        }
      }
    });
  }

  // ─── Başlatıcı ─────────────────────────────────────────────────
  function init(targetContainerId = 'charts-viewport') {
    containerEl = document.getElementById(targetContainerId);
    if (!containerEl) {
      console.warn('[TreasuryCockpit] Hedef konteyner bulunamadi:', targetContainerId);
      return;
    }

    renderLayout();
    listenExternalEvents();

    // Verileri Yükle
    fetchLedger();
    fetchBinanceStatus();
    fetchBinancePositions();

    // Otomatik Polling (Her 12 saniyede bir defteri ve Binance durumunu yenile)
    setInterval(() => {
      fetchLedger();
      if (state.activeTab === 'binance_open') {
        fetchBinancePositions();
      }
    }, 12000);

    console.log('[TreasuryCockpit] Kasa Defteri ve Binance Read-Only Entegrasyonu basariyla baslatildi.');
  }

  return {
    init,
    getState: () => state,
    refresh: fetchLedger,
    syncBinance: triggerBinanceSync,
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
