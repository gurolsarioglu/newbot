/**
 * FundingPlugin — Funding Rate Hız Takipçisi
 * Anlık funding oranı + sıradaki ödeme geri sayımı
 *
 * Dinlenen: 'coin:change'
 * Yayılan:  'funding:data' → { rate, nextTime, ratePct }
 */
const FundingPlugin = (() => {
  let refreshTimer   = null;
  let countdownTimer = null;
  let nextFundingTime = null;

  function init() {
    EventBus.on('coin:change', ({ symbol }) => {
      clearInterval(refreshTimer);
      _load(symbol);
      refreshTimer = setInterval(() => _load(symbol), 60000); // 1dk yenile
    });
  }

  async function _load(symbol) {
    try {
      const data = await BinanceAPI.getFundingRate(symbol);
      const rate    = parseFloat(data.lastFundingRate);
      const ratePct = rate * 100;
      nextFundingTime = parseInt(data.nextFundingTime);

      _render({ ratePct, nextFundingTime });
      EventBus.emit('funding:data', { rate, ratePct, nextFundingTime });

      // Geri sayım başlat
      clearInterval(countdownTimer);
      countdownTimer = setInterval(_updateCountdown, 1000);
    } catch (err) {
      console.error('[FundingPlugin] Hata:', err);
    }
  }

  function _render({ ratePct, nextFundingTime: nft }) {
    const mainEl  = document.getElementById('funding-main');
    const deltaEl = document.getElementById('funding-delta');
    const noteEl  = document.getElementById('funding-note');
    if (!mainEl) return;

    const sign  = ratePct >= 0 ? '+' : '';
    const isPos = ratePct > 0.01;
    const isNeg = ratePct < -0.01;
    const isExtreme = Math.abs(ratePct) > 0.05;

    mainEl.textContent   = `${sign}${ratePct.toFixed(4)}%`;
    mainEl.style.color   = isPos ? 'var(--red)' : isNeg ? 'var(--green)' : 'var(--text-primary)';

    if (isExtreme && isPos) {
      deltaEl.textContent = '🚨 Aşırı Pozitif';
      deltaEl.className   = 'metric-delta down';
      noteEl.textContent  = 'Long tasfiyesi riski!';
    } else if (isExtreme && isNeg) {
      deltaEl.textContent = '⚡ Aşırı Eksi';
      deltaEl.className   = 'metric-delta up';
      noteEl.textContent  = 'Shortlar prim ödüyor';
    } else if (isPos) {
      deltaEl.textContent = 'Long ödüyor';
      deltaEl.className   = 'metric-delta down';
      noteEl.textContent  = 'Long yoğunluğu yüksek';
    } else if (isNeg) {
      deltaEl.textContent = 'Short ödüyor';
      deltaEl.className   = 'metric-delta up';
      noteEl.textContent  = 'Short yoğunluğu yüksek';
    } else {
      deltaEl.textContent = 'Dengeli';
      deltaEl.className   = 'metric-delta';
      noteEl.textContent  = 'Nötr fonlama';
    }
  }

  function _updateCountdown() {
    const el = document.getElementById('funding-countdown');
    if (!el || !nextFundingTime) return;
    const diff = nextFundingTime - Date.now();
    if (diff <= 0) { el.textContent = 'Şimdi!'; return; }
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  return { init };
})();
