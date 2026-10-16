/**
 * BinanceAPI — Tüm Binance Futures endpoint çağrıları
 * Tüm istekler /api proxy üzerinden gider (CORS engeli yok).
 */
const BinanceAPI = (() => {
  const BASE = '/api/fapi';
  const DATA = '/api/data';

  async function _get(url, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const fullUrl = qs ? `${url}?${qs}` : url;
    const res = await fetch(fullUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${fullUrl}`);
    return res.json();
  }

  // ─── Mumlar (Klines) ─────────────────────────────────────────────
  async function getKlines(symbol, interval, limit = 500) {
    return _get(`${BASE}/v1/klines`, { symbol, interval, limit });
  }

  // ─── Anlık Fiyat (24h ticker) ─────────────────────────────────────
  async function getTicker(symbol) {
    return _get(`${BASE}/v1/ticker/24hr`, { symbol });
  }

  // ─── Open Interest (Anlık) ────────────────────────────────────────
  async function getOpenInterest(symbol) {
    return _get(`${BASE}/v1/openInterest`, { symbol });
  }

  // ─── Open Interest Geçmişi ────────────────────────────────────────
  async function getOpenInterestHist(symbol, period = '5m', limit = 288) {
    return _get(`${DATA}/futures/data/openInterestHist`, { symbol, period, limit });
  }

  // ─── Top Trader Pozisyon Oranı ────────────────────────────────────
  async function getTopTraderPositionRatio(symbol, period = '5m', limit = 288) {
    return _get(`${DATA}/futures/data/topLongShortPositionRatio`, { symbol, period, limit });
  }

  // ─── Top Trader Hesap Oranı ───────────────────────────────────────
  async function getTopTraderAccountRatio(symbol, period = '5m', limit = 288) {
    return _get(`${DATA}/futures/data/topLongShortAccountRatio`, { symbol, period, limit });
  }

  // ─── Global Long/Short (Perakende) ───────────────────────────────
  async function getGlobalLSRatio(symbol, period = '5m', limit = 288) {
    return _get(`${DATA}/futures/data/globalLongShortAccountRatio`, { symbol, period, limit });
  }

  // ─── Taker Buy/Sell Hacmi ─────────────────────────────────────────
  async function getTakerRatio(symbol, period = '5m', limit = 288) {
    return _get(`${DATA}/futures/data/takerlongshortRatio`, { symbol, period, limit });
  }

  // ─── Anlık Funding Rate ───────────────────────────────────────────
  async function getFundingRate(symbol) {
    return _get(`${BASE}/v1/premiumIndex`, { symbol });
  }

  // ─── Funding Rate Geçmişi (yeni) ─────────────────────────────────
  async function getFundingRateHist(symbol, limit = 100) {
    return _get(`${BASE}/v1/fundingRate`, { symbol, limit });
  }

  // ─── Smart Money anlık snapshot + geçmiş delta ────────────────────
  async function getAllSmartMoney(symbol) {
    const [posRatio, accRatio, globalLS, takerRatio, funding, oi, oiHist] =
      await Promise.allSettled([
        getTopTraderPositionRatio(symbol, '5m', 6),
        getTopTraderAccountRatio(symbol,  '5m', 6),
        getGlobalLSRatio(symbol,          '5m', 6),
        getTakerRatio(symbol,             '5m', 6),
        getFundingRate(symbol),
        getOpenInterest(symbol),
        getOpenInterestHist(symbol, '5m', 6),
      ]);

    const posArr   = (posRatio.status === 'fulfilled' && Array.isArray(posRatio.value)) ? posRatio.value : [];
    const accArr   = (accRatio.status === 'fulfilled' && Array.isArray(accRatio.value)) ? accRatio.value : [];
    const globArr  = (globalLS.status === 'fulfilled' && Array.isArray(globalLS.value)) ? globalLS.value : [];
    const takerArr = (takerRatio.status === 'fulfilled' && Array.isArray(takerRatio.value)) ? takerRatio.value : [];

    return {
      posRatio:   posArr.length ? posArr[posArr.length - 1] : null,
      posHist:    posArr,
      accRatio:   accArr.length ? accArr[accArr.length - 1] : null,
      accHist:    accArr,
      globalLS:   globArr.length ? globArr[globArr.length - 1] : null,
      globalHist: globArr,
      takerRatio: takerArr.length ? takerArr[takerArr.length - 1] : null,
      takerHist:  takerArr,
      funding:    funding.status === 'fulfilled' ? funding.value : null,
      oi:         oi.status === 'fulfilled' ? oi.value : null,
      oiHist:     oiHist.status === 'fulfilled' ? oiHist.value : null,
    };
  }

  return {
    getKlines,
    getTicker,
    getOpenInterest,
    getOpenInterestHist,
    getTopTraderPositionRatio,
    getTopTraderAccountRatio,
    getGlobalLSRatio,
    getTakerRatio,
    getFundingRate,
    getFundingRateHist,
    getAllSmartMoney,
  };
})();
