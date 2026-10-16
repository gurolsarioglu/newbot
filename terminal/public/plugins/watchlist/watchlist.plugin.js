/**
 * watchlist.plugin.js — Binance Vadeli 740+ Coin Canlı İzleme Listesi & 200 Günlük Analiz Motoru
 * Alpha Terminal
 *
 * Özellikler:
 * 1. Canlı Binance Futures WebSocket (!miniTicker@arr) ile anlık fiyat akışı & yeşil/kırmızı tick yanıp sönme (flash).
 * 2. ⭐ Favori (Yıldızlama) Sistemi: LocalStorage kalıcı saklama + otomatik 200 günlük sunucu senkronizasyonu.
 * 3. Gelişmiş Filtreler: Tümü, ⭐ Favoriler, 📈 Yükselenler, 📉 Düşenler, 💰 Ekstrem FR, 📊 Hacim.
 * 4. İnteraktif Sütun Başlığı Sıralaması (Symbol, Price, Chg%, Vol, FR - Artan / Azalan).
 * 5. 200 Günlük Kantitatif İstatistikler (EMA200, 200G ATH, 200G ATL, Kazanma Oranı, Gün Serisi).
 * 6. Canlı Harf-Harf Arama & Yumuşak Sonsuz Kaydırma (Infinite Scroll).
 */

const WatchlistPlugin = (() => {
  let allTickers = [];
  let currentFilter = 'all'; // 'all', 'favorites', 'gainers', 'losers', 'funding', 'volume'
  let searchQuery = '';
  let activeSymbol = 'BTWUSDT';
  let pollInterval = null;
  let tickerWs = null;
  let rowElementMap = new Map(); // symbol -> { row, priceCell, chgPill, lastPrice }
  let reconnectTimer = null;
  let visibleCount = 80;

  // Sıralama durumu
  let sortKey = null; // 'symbol', 'price', 'chg', 'vol', 'fr'
  let sortDir = 'desc'; // 'asc' veya 'desc'

  // Favoriler (LocalStorage)
  const FAVORITES_STORAGE_KEY = 'alpha_terminal_favorites';
  let favoritesSet = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BTWUSDT', 'SUIUSDT']);

  function loadFavorites() {
    try {
      const stored = localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        if (Array.isArray(arr) && arr.length > 0) {
          favoritesSet = new Set(arr);
        }
      }
    } catch (e) {
      console.warn('[Watchlist] Favoriler okunamadı:', e);
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(favoritesSet)));
    } catch (e) {
      console.warn('[Watchlist] Favoriler kaydedilemedi:', e);
    }
  }

  function isFavorite(symbol) {
    return favoritesSet.has(symbol.toUpperCase());
  }

  function toggleFavorite(symbol, e) {
    if (e) e.stopPropagation();
    const sym = symbol.toUpperCase();
    if (favoritesSet.has(sym)) {
      favoritesSet.delete(sym);
    } else {
      favoritesSet.add(sym);
      // Yeni favoriye eklendiğinde arka planda 200 günlük analiz verisini hazırla
      syncFavoriteHistory(sym);
    }
    saveFavorites();
    renderTable(true);
  }

  async function syncFavoriteHistory(symbol) {
    try {
      fetch('/api/favorites/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol })
      }).catch(() => {});
    } catch (err) {}
  }

  const COLOR_PALETTE = [
    '#3b82f6', '#06b6d4', '#10b981', '#8b5cf6', '#f59e0b',
    '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#84cc16'
  ];

  function getCoinColor(symbol) {
    let hash = 0;
    for (let i = 0; i < symbol.length; i++) {
      hash = symbol.charCodeAt(i) + ((hash << 5) - hash);
    }
    return COLOR_PALETTE[Math.abs(hash) % COLOR_PALETTE.length];
  }

  function formatPrice(val) {
    if (typeof PriceFormatter !== 'undefined' && PriceFormatter.format) {
      return PriceFormatter.format(val);
    }
    if (val === null || val === undefined || val === '') return '—';
    if (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) return val.trim();
    const num = Number(val);
    if (isNaN(num)) return '—';
    const abs = Math.abs(num);
    if (abs < 0.0001) return num.toFixed(8);
    if (abs < 0.01) return num.toFixed(6);
    if (abs < 1) return num.toFixed(5);
    if (abs < 100) return num.toFixed(4);
    return num.toFixed(2);
  }

  function formatVolume(val) {
    if (isNaN(val) || val === 0) return '—';
    if (val >= 1e9) return (val / 1e9).toFixed(2) + 'B';
    if (val >= 1e6) return (val / 1e6).toFixed(2) + 'M';
    if (val >= 1e3) return (val / 1e3).toFixed(1) + 'K';
    return val.toFixed(0);
  }

  async function fetchWatchlist() {
    try {
      const res = await fetch('/api/watchlist');
      if (!res.ok) return;
      const data = await res.json();
      allTickers = data;
      renderTable();
      updateHeaderCount();
    } catch (e) {
      console.warn('[Watchlist] fetch error:', e);
    }
  }

  function updateHeaderCount() {
    const countEl = document.getElementById('wl-coin-count');
    if (countEl) {
      if (currentFilter === 'favorites') {
        countEl.textContent = `${favoritesSet.size} fav`;
      } else {
        countEl.textContent = allTickers.length || 740;
      }
    }
  }

  function renderTable(preserveScroll = false) {
    const tbody = document.getElementById('wl-tbody');
    const tableWrap = document.getElementById('watchlist-table-wrap');
    if (!tbody) return;

    const previousScrollTop = (preserveScroll && tableWrap) ? tableWrap.scrollTop : 0;

    let filtered = allTickers.slice();

    // 1. Arama Filtresi
    if (searchQuery) {
      const q = searchQuery.toUpperCase();
      filtered = filtered.filter(t => t.symbol.includes(q));
    }

    // 2. Sekme Filtreleri
    if (currentFilter === 'favorites') {
      filtered = filtered.filter(t => isFavorite(t.symbol));
    } else if (currentFilter === 'gainers') {
      filtered.sort((a, b) => b.chgPct - a.chgPct);
    } else if (currentFilter === 'losers') {
      filtered.sort((a, b) => a.chgPct - b.chgPct);
    } else if (currentFilter === 'funding') {
      filtered.sort((a, b) => a.fr - b.fr);
    } else if (currentFilter === 'volume') {
      filtered.sort((a, b) => b.volUsd - a.volUsd);
    }

    // 3. Sütun Sıralaması (Kullanıcı başlığa tıklamışsa)
    if (sortKey) {
      filtered.sort((a, b) => {
        let valA = a[sortKey];
        let valB = b[sortKey];
        if (sortKey === 'symbol') {
          return sortDir === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        }
        return sortDir === 'asc' ? valA - valB : valB - valA;
      });
    }

    if (!filtered.length) {
      const emptyMsg = currentFilter === 'favorites'
        ? '⭐ Henüz favori coin eklemediniz. Coinlerin yanındaki yıldız simgesine tıklayarak ekleyebilirsiniz.'
        : `🔍 "${searchQuery}" ile eşleşen coin bulunamadı.`;

      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:24px;color:#64748b;font-size:12px;">
            ${emptyMsg}
          </td>
        </tr>
      `;
      rowElementMap.clear();
      return;
    }

    // Dinamik sonsuz kaydırma için visibleCount kadarını render et
    const displayList = filtered.slice(0, visibleCount);

    tbody.innerHTML = displayList.map(t => {
      const isUp = t.chgPct >= 0;
      const isActive = t.symbol === activeSymbol;
      const isFav = isFavorite(t.symbol);
      const coinColor = getCoinColor(t.symbol);
      const shortName = t.symbol.replace('USDT', '');
      const initial = shortName.slice(0, 2);

      return `
        <tr class="wl-row ${isActive ? 'active' : ''}" data-symbol="${t.symbol}">
          <td style="text-align:center; padding: 4px 2px;">
            <button class="wl-star-btn ${isFav ? 'starred' : ''}" data-fav="${t.symbol}" title="${isFav ? 'Favorilerden Çıkar' : 'Favorilere Ekle'}">
              ${isFav ? '★' : '☆'}
            </button>
          </td>
          <td>
            <div class="wl-symbol-cell">
              <div class="coin-icon-circle" style="background:${coinColor}">${initial}</div>
              <span class="wl-sym-text">${shortName}</span>
            </div>
          </td>
          <td class="wl-price-cell">${formatPrice(t.price)}</td>
          <td>
            <span class="wl-chg-pill ${isUp ? 'up' : 'down'}">
              ${isUp ? '+' : ''}${t.chgPct.toFixed(2)}%
            </span>
          </td>
          <td style="color:#94a3b8;">${formatVolume(t.volUsd)}</td>
          <td class="wl-fr-cell ${t.fr >= 0 ? 'up' : 'down'}">
            ${(t.fr * 100).toFixed(4)}% ${t.fr >= 0 ? '↗' : '↘'}
          </td>
          <td>
            <span class="wl-fr-badge">${t.frInterval || '8h'}</span>
          </td>
        </tr>
      `;
    }).join('');

    // Canlı WebSocket güncellemesi için görünen satırların DOM haritasını oluştur
    rowElementMap.clear();
    displayList.forEach(t => {
      const row = tbody.querySelector(`tr[data-symbol="${t.symbol}"]`);
      if (row) {
        rowElementMap.set(t.symbol, {
          row,
          priceCell: row.querySelector('.wl-price-cell'),
          chgPill: row.querySelector('.wl-chg-pill'),
          lastPrice: t.price
        });
      }
    });

    if (preserveScroll && tableWrap) {
      tableWrap.scrollTop = previousScrollTop;
    }
  }

  // ─── Canlı Binance Futures WebSocket Akışı (!miniTicker@arr) ───────────
  function connectTickerStream() {
    clearTimeout(reconnectTimer);
    if (tickerWs) {
      try {
        tickerWs.onclose = null;
        tickerWs.onerror = null;
        tickerWs.onmessage = null;
        tickerWs.close();
      } catch (e) {}
    }

    try {
      tickerWs = new WebSocket('wss://fstream.binance.com/ws/!miniTicker@arr');
    } catch (e) {
      console.warn('[Watchlist WS] Bağlantı hatası:', e);
      reconnectTimer = setTimeout(connectTickerStream, 4000);
      return;
    }

    tickerWs.onopen = () => {
      console.log('[Watchlist WS] 🟢 Canlı Binance Futures !miniTicker@arr bağlandı. 740+ vadeli coin akışı devrede.');
    };

    tickerWs.onmessage = (event) => {
      try {
        const raw = JSON.parse(event.data);
        if (!Array.isArray(raw)) return;

        raw.forEach(m => {
          if (!m.s || !m.s.endsWith('USDT')) return;

          const newPrice = parseFloat(m.c);
          const openPrice = parseFloat(m.o);
          if (isNaN(newPrice)) return;

          const chgPct = openPrice > 0 ? ((newPrice - openPrice) / openPrice) * 100 : 0;

          // 1. Tabloda görünür olan satırı anlık güncelle ve yeşil/kırmızı flash yak
          const entry = rowElementMap.get(m.s);
          if (entry && entry.priceCell) {
            const oldPrice = typeof entry.lastPrice === 'number' ? entry.lastPrice : parseFloat(entry.lastPrice || 0);
            const priceToDisplay = m.c ? String(m.c) : formatPrice(newPrice);
            if (newPrice !== oldPrice) {
              entry.priceCell.textContent = priceToDisplay;
              const isUp = newPrice >= oldPrice;
              entry.priceCell.classList.remove('flash-up', 'flash-down');
              void entry.priceCell.offsetWidth;
              entry.priceCell.classList.add(isUp ? 'flash-up' : 'flash-down');
              entry.lastPrice = newPrice;
            }

            if (entry.chgPill) {
              const isPositive = chgPct >= 0;
              entry.chgPill.textContent = `${isPositive ? '+' : ''}${chgPct.toFixed(2)}%`;
              entry.chgPill.className = `wl-chg-pill ${isPositive ? 'up' : 'down'}`;
            }
          }

          // 2. Seçili coin ise Ticker Snapshot'ı da canlı besle
          if (m.s === activeSymbol) {
            const priceEl = document.getElementById('snap-price');
            const chgEl = document.getElementById('snap-chg');
            if (priceEl) {
              const oldSnapPrice = parseFloat(priceEl.dataset.price || 0);
              const snapPriceToDisplay = m.c ? String(m.c) : formatPrice(newPrice);
              priceEl.textContent = snapPriceToDisplay;
              priceEl.dataset.price = newPrice;
              if (oldSnapPrice && newPrice !== oldSnapPrice) {
                priceEl.classList.remove('flash-up', 'flash-down');
                void priceEl.offsetWidth;
                priceEl.classList.add(newPrice >= oldSnapPrice ? 'flash-up' : 'flash-down');
              }
            }
            if (chgEl) {
              const isPositive = chgPct >= 0;
              chgEl.textContent = `${isPositive ? '+' : ''}${chgPct.toFixed(2)}%`;
              chgEl.className = `snapshot-chg-pill ${isPositive ? 'up' : 'down'}`;
            }
          }

          // 3. Bellekteki coin verisini güncelle
          const mem = allTickers.find(x => x.symbol === m.s);
          if (mem) {
            mem.price = newPrice;
            mem.chgPct = chgPct;
          }
        });
      } catch (err) {}
    };

    tickerWs.onerror = (e) => {
      console.warn('[Watchlist WS] Hata:', e.message);
    };

    tickerWs.onclose = () => {
      reconnectTimer = setTimeout(connectTickerStream, 3000);
    };
  }

  // ─── 200 Günlük Analiz Gösterimi (Ticker Snapshot) ───────────────────
  async function load200dAnalytics(symbol) {
    const sym = symbol.toUpperCase();
    const emaEl = document.getElementById('snap-val-ema');
    const athEl = document.getElementById('snap-val-ath');
    const atlEl = document.getElementById('snap-val-atl');
    const winEl = document.getElementById('snap-val-winrate');
    const strkEl = document.getElementById('snap-val-streak');

    if (!emaEl) return;

    try {
      const res = await fetch(`/api/favorites/analytics?symbol=${sym}`);
      if (!res.ok) throw new Error('Veri yok');
      const data = await res.json();
      if (!data || !data.metrics) return;

      const m = data.metrics;

      // 1. EMA 200
      const isAbove = m.ema200DiffPct >= 0;
      emaEl.textContent = `${isAbove ? '+' : ''}${m.ema200DiffPct}% (${isAbove ? 'Üstte' : 'Altta'})`;
      emaEl.className = `chip-val ${isAbove ? 'green' : 'red'}`;

      // 2. 200G ATH Zirve Mesafesi
      athEl.textContent = `${m.athDistancePct}% 🔻`;
      athEl.className = 'chip-val red';

      // 3. 200G ATL Dip Sıçraması
      atlEl.textContent = `+${m.atlBouncePct}% 🟢`;
      atlEl.className = 'chip-val green';

      // 4. Kazanma Oranı (Win Rate)
      winEl.textContent = `%${m.winRatePct}`;
      winEl.className = `chip-val ${m.winRatePct >= 50 ? 'green' : 'red'}`;

      // 5. Gün Serisi (Streak)
      const isStreakUp = m.currentStreak.type === 'UP';
      strkEl.textContent = `${m.currentStreak.count}G ${isStreakUp ? 'Yeşil 🟢' : 'Kırmızı 🔴'}`;
      strkEl.className = `chip-val ${isStreakUp ? 'green' : 'red'}`;
    } catch (e) {
      if (emaEl) emaEl.textContent = 'Yükleniyor...';
      if (athEl) athEl.textContent = '—';
      if (atlEl) atlEl.textContent = '—';
      if (winEl) winEl.textContent = '—';
      if (strkEl) strkEl.textContent = '—';
    }
  }

  function setActiveSymbol(symbol) {
    activeSymbol = symbol.toUpperCase();
    renderTable();

    // Üst arama kutusunu aktif coine güncelle ve senkronize et
    const searchInput = document.getElementById('coin-search-input');
    if (searchInput) {
      searchInput.value = activeSymbol;
      searchInput.placeholder = activeSymbol;
    }

    if (typeof MultiChartPlugin !== 'undefined') {
      MultiChartPlugin.loadSymbol(activeSymbol);
    }
    if (typeof TickerSnapshot !== 'undefined') {
      TickerSnapshot.updateSymbol(activeSymbol);
    }
    if (typeof WebSocketManager !== 'undefined') {
      WebSocketManager.switchTo(activeSymbol, '1m');
    }

    // 200 Günlük Kantitatif Verileri de getir
    load200dAnalytics(activeSymbol);
  }

  function init() {
    loadFavorites();

    const tableWrap = document.getElementById('watchlist-table-wrap');
    if (tableWrap) {
      tableWrap.addEventListener('click', (e) => {
        // Yıldız butonuna tıklandıysa favori toggle et
        const starBtn = e.target.closest('.wl-star-btn');
        if (starBtn && starBtn.dataset.fav) {
          toggleFavorite(starBtn.dataset.fav, e);
          updateHeaderCount();
          return;
        }

        // Satıra tıklandıysa coini seç
        const row = e.target.closest('.wl-row');
        if (!row) return;
        const sym = row.dataset.symbol;
        if (sym) setActiveSymbol(sym);
      });
    }

    // Filtre sekmeleri
    document.querySelectorAll('.wl-filter-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.wl-filter-pill').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter || 'all';
        sortKey = null; // Sekme değişince özel sütun sıralamasını sıfırla
        visibleCount = 80;
        updateHeaderCount();
        if (tableWrap) tableWrap.scrollTop = 0;
        renderTable();
      });
    });

    // İnteraktif Sütun Başlığı Sıralaması
    const sortFieldMap = {
      'symbol': 'symbol',
      'price': 'price',
      'chg': 'chgPct',
      'vol': 'volUsd',
      'fr': 'fr'
    };

    document.querySelectorAll('.sortable-th').forEach(th => {
      th.addEventListener('click', () => {
        const fieldKey = th.dataset.sort;
        const mappedKey = sortFieldMap[fieldKey];
        if (!mappedKey) return;

        if (sortKey === mappedKey) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortKey = mappedKey;
          sortDir = (fieldKey === 'symbol') ? 'asc' : 'desc';
        }

        // İkonları güncelle
        document.querySelectorAll('.sort-icon').forEach(icon => icon.textContent = '');
        const currentIcon = document.getElementById(`sort-icon-${fieldKey}`);
        if (currentIcon) {
          currentIcon.textContent = sortDir === 'asc' ? '▲' : '▼';
        }

        renderTable(true);
      });
    });

    // Sonsuz Kaydırma (Scroll aşağı indikçe sonraki 50 coini yumuşak yükle)
    if (tableWrap) {
      tableWrap.addEventListener('scroll', () => {
        if (tableWrap.scrollTop + tableWrap.clientHeight >= tableWrap.scrollHeight - 160) {
          if (visibleCount < allTickers.length) {
            visibleCount += 50;
            renderTable(true);
          }
        }
      });
    }

    fetchWatchlist();
    connectTickerStream();
    pollInterval = setInterval(fetchWatchlist, 6000);

    // Başlangıç coin'i için arama çubuğunu ve 200 günlük veriyi getir
    const searchInput = document.getElementById('coin-search-input');
    if (searchInput) {
      searchInput.value = activeSymbol;
      searchInput.placeholder = activeSymbol;
    }
    load200dAnalytics(activeSymbol);
  }

  return {
    init,
    setActiveSymbol,
    getActiveSymbol: () => activeSymbol,
    isFavorite,
    toggleFavorite,
    search: (q) => { 
      searchQuery = q ? q.trim() : ''; 
      visibleCount = 80; 
      const tableWrap = document.getElementById('watchlist-table-wrap');
      if (tableWrap) tableWrap.scrollTop = 0;
      renderTable(); 
    }
  };
})();
