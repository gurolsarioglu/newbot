/**
 * OIPlugin — Open Interest Delta Takipçisi
 * Son 15 dk / 1 saatlik OI değişimini hesaplar ve gösterir.
 *
 * Dinlenen: 'coin:change'
 * Yayılan:  'oi:data' → { current, delta15m, deltaPct15m, trend }
 */
const OIPlugin = (() => {
  let refreshTimer = null;

  function init() {
    EventBus.on('coin:change', ({ symbol }) => {
      clearInterval(refreshTimer);
      _load(symbol);
      refreshTimer = setInterval(() => _load(symbol), 15000); // 15s
    });
  }

  async function _load(symbol) {
    try {
      const [oiNow, oiHist] = await Promise.all([
        BinanceAPI.getOpenInterest(symbol),
        BinanceAPI.getOpenInterestHist(symbol, '5m', 20), // son 100 dk
      ]);

      const current = parseFloat(oiNow.openInterest);

      // Delta hesabı: oiHist en yeniden eskiye sıralıdır
      // Son 15 dk ≈ 3 adet 5m periyot
      let delta15m = null, deltaPct15m = null;
      if (oiHist && oiHist.length >= 4) {
        const old15m = parseFloat(oiHist[oiHist.length - 4].sumOpenInterest);
        delta15m    = current - old15m;
        deltaPct15m = (delta15m / old15m) * 100;
      }

      const trend = delta15m === null ? 'unknown'
        : delta15m > 0 ? 'artıyor' : 'azalıyor';

      const payload = { current, delta15m, deltaPct15m, trend, symbol };
      _render(payload, symbol);
      EventBus.emit('oi:data', payload);
    } catch (err) {
      console.error('[OIPlugin] Hata:', err);
    }
  }

  function _render({ current, delta15m, deltaPct15m, trend, symbol }, sym) {
    const mainEl  = document.getElementById('oi-main');
    const deltaEl = document.getElementById('oi-delta');
    const noteEl  = document.getElementById('oi-note');
    if (!mainEl) return;

    // Coin adını kısalt (örn: TAKEUSDT → TAKE)
    const coin = sym.replace('USDT','').replace('BUSD','');

    // OI değerini formatlı göster
    const fmt = v => v >= 1e6 ? `${(v/1e6).toFixed(2)}M` : v >= 1e3 ? `${(v/1e3).toFixed(0)}K` : v.toFixed(0);
    mainEl.textContent = `${fmt(current)} ${coin}`;

    if (delta15m !== null) {
      const sign   = delta15m >= 0 ? '+' : '';
      const arrow  = delta15m >= 0 ? '🔺' : '🔻';
      deltaEl.textContent  = `${arrow} Δ15dk: ${sign}${fmt(Math.abs(delta15m))} (${sign}${deltaPct15m.toFixed(1)}%)`;
      deltaEl.className    = `metric-delta ${delta15m >= 0 ? 'up' : 'down'}`;
      noteEl.textContent   = delta15m >= 0 ? 'Para girişi var 💰' : 'Para çıkışı var! ⚠️';
    } else {
      deltaEl.textContent = 'Hesaplanıyor...';
      noteEl.textContent  = '';
    }
  }

  return { init };
})();
