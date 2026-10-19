/** Binance türev verileri. Eksik veriler null kalır; oran/fonlama uydurulmaz. */
class DerivativesEnricherService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 60 * 1000;
    this.activeRequests = new Map();
  }

  _fetchJson(url) {
    // Mum istekleri ile aynı ağırlık bütçesini ve HTTP timeout yönetimini kullan.
    return require('./market-data-engine.service').safeFetch(url, 1);
  }

  _number(value, min = -Infinity, max = Infinity) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  }

  _rows(result) {
    return result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : [];
  }

  _withFunding(data, fundingMeta) {
    return {
      ...data,
      fundingRate: this._number(fundingMeta?.fundingRate),
      nextFundingTime: this._number(fundingMeta?.nextFundingTime, 1)
    };
  }

  async enrich(symbol, fundingMeta = null) {
    if (!symbol) return null;
    const cleanSym = String(symbol).toUpperCase().trim();
    if (!/^[A-Z0-9]+$/.test(cleanSym)) return null;
    const now = Date.now();
    const cached = this.cache.get(cleanSym);
    if (cached && now - cached.ts < this.ttlMs) return this._withFunding(cached.data, fundingMeta);

    let pending = this.activeRequests.get(cleanSym);
    if (!pending) {
      pending = this._load(cleanSym, now);
      this.activeRequests.set(cleanSym, pending);
    }
    try {
      return this._withFunding(await pending, fundingMeta);
    } finally {
      if (this.activeRequests.get(cleanSym) === pending) this.activeRequests.delete(cleanSym);
    }
  }

  async _load(symbol, now) {
    const results = await Promise.allSettled([
      this._fetchJson(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=5m&limit=2`),
      this._fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=5m&limit=2`),
      this._fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${symbol}&period=5m&limit=2`)
    ]);
    const [topRows, globalRows, oiRows] = results.map(result => this._rows(result));
    const latestTop = topRows.at(-1);
    const previousTop = topRows.at(-2);
    const latestGlobal = globalRows.at(-1);
    const latestOi = oiRows.at(-1);
    const previousOi = oiRows.at(-2);
    const topLong = this._number(latestTop?.longAccount, 0, 1);
    const topShort = this._number(latestTop?.shortAccount, 0, 1);
    const previousTopLong = this._number(previousTop?.longAccount, 0, 1);
    const globalLong = this._number(latestGlobal?.longAccount, 0, 1);
    const globalShort = this._number(latestGlobal?.shortAccount, 0, 1);
    const currentOi = this._number(latestOi?.sumOpenInterest, 0);
    const prevOi = this._number(previousOi?.sumOpenInterest, 0);
    const data = {
      symbol,
      topTraderLongRatio: topLong === null ? null : topLong * 100,
      topTraderShortRatio: topShort === null ? null : topShort * 100,
      topTraderLsRatio: this._number(latestTop?.longShortRatio, 0),
      topTraderChange: topLong === null || previousTopLong === null ? null : (topLong - previousTopLong) * 100,
      globalLongRatio: globalLong === null ? null : globalLong * 100,
      globalShortRatio: globalShort === null ? null : globalShort * 100,
      globalLsRatio: this._number(latestGlobal?.longShortRatio, 0),
      currentOi,
      oiDeltaPct: currentOi === null || prevOi === null || prevOi === 0 ? null : (currentOi - prevOi) / prevOi * 100,
      isWhaleAccumulating: topLong !== null && topLong >= 0.60,
      isRetailShorting: globalShort !== null && globalShort >= 0.55,
      cachedAt: now
    };
    // Tamamen başarısız bir yanıtı 60 saniye boyunca gerçek veri gibi saklama.
    if (topLong !== null || globalLong !== null || currentOi !== null) this.cache.set(symbol, { data, ts: now });
    return data;
  }
}

module.exports = new DerivativesEnricherService();
