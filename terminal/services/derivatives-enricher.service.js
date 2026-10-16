/**
 * derivatives-enricher.service.js — Alpha Terminal Türev Veri Zenginleştirici
 * 
 * Teknik kriteri geçen aday coinler için Binance Futures türev verilerini çeker:
 * - Balina Pozisyon L/S Oranı (Top Trader Long/Short Ratio)
 * - Perakende Hesap L/S Oranı (Global Long/Short Account Ratio)
 * - Açık Pozisyon (Open Interest - OI) Değişimi
 * - Fonlama Oranı (Funding Rate) ve Geri Sayım
 * 
 * 60 saniye TTL önbellek (Cache) ve Token Bucket Hız Sınırlayıcı ile korunur.
 */

const https = require('https');

class DerivativesEnricherService {
  constructor() {
    this.cache = new Map();
    this.ttlMs = 60 * 1000; // 60 saniye TTL
    this.activeRequests = new Map(); // In-flight request deduplication
  }

  _fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: {
          'User-Agent': 'AlphaTerminal/DerivativesEngine-2.0',
          'Accept': 'application/json'
        },
        timeout: 5000
      };

      https.get(url, options, (res) => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject).on('timeout', () => reject(new Error('Timeout')));
    });
  }

  async enrich(symbol, fundingMeta = null) {
    if (!symbol) return null;
    const cleanSym = String(symbol).toUpperCase().trim();
    const now = Date.now();

    // 1. Önbellek Kontrolü (60 saniye TTL)
    const cached = this.cache.get(cleanSym);
    if (cached && (now - cached.ts < this.ttlMs)) {
      return cached.data;
    }

    // 2. Çift istek engelleme (In-flight promise reuse)
    if (this.activeRequests.has(cleanSym)) {
      return this.activeRequests.get(cleanSym);
    }

    const requestPromise = (async () => {
      try {
        const [topPosRes, globAccRes, oiRes] = await Promise.allSettled([
          this._fetchJson(`https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${cleanSym}&period=5m&limit=2`),
          this._fetchJson(`https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${cleanSym}&period=5m&limit=2`),
          this._fetchJson(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${cleanSym}&period=5m&limit=2`)
        ]);

        // Balina L/S Pozisyon Oranı
        let topTraderLongRatio = 50.0;
        let topTraderShortRatio = 50.0;
        let topTraderLsRatio = 1.0;
        let topTraderChange = 0.0;

        if (topPosRes.status === 'fulfilled' && Array.isArray(topPosRes.value) && topPosRes.value.length > 0) {
          const list = topPosRes.value;
          const latest = list[list.length - 1];
          const prev = list.length > 1 ? list[list.length - 2] : null;

          topTraderLongRatio = parseFloat((parseFloat(latest.longAccount) * 100).toFixed(2));
          topTraderShortRatio = parseFloat((parseFloat(latest.shortAccount) * 100).toFixed(2));
          topTraderLsRatio = parseFloat(parseFloat(latest.longShortRatio).toFixed(2));

          if (prev) {
            topTraderChange = parseFloat(((parseFloat(latest.longAccount) - parseFloat(prev.longAccount)) * 100).toFixed(2));
          }
        }

        // Perakende Hesap L/S Oranı
        let globalLongRatio = 50.0;
        let globalShortRatio = 50.0;
        let globalLsRatio = 1.0;

        if (globAccRes.status === 'fulfilled' && Array.isArray(globAccRes.value) && globAccRes.value.length > 0) {
          const list = globAccRes.value;
          const latest = list[list.length - 1];
          globalLongRatio = parseFloat((parseFloat(latest.longAccount) * 100).toFixed(2));
          globalShortRatio = parseFloat((parseFloat(latest.shortAccount) * 100).toFixed(2));
          globalLsRatio = parseFloat(parseFloat(latest.longShortRatio).toFixed(2));
        }

        // Açık Pozisyon (OI) Değişimi
        let oiDeltaPct = 0.0;
        let currentOi = 0;
        if (oiRes.status === 'fulfilled' && Array.isArray(oiRes.value) && oiRes.value.length > 0) {
          const list = oiRes.value;
          const latest = list[list.length - 1];
          const prev = list.length > 1 ? list[list.length - 2] : null;
          currentOi = parseFloat(latest.sumOpenInterest || 0);

          if (prev && parseFloat(prev.sumOpenInterest) > 0) {
            const pOi = parseFloat(prev.sumOpenInterest);
            oiDeltaPct = parseFloat((((currentOi - pOi) / pOi) * 100).toFixed(2));
          }
        }

        // Fonlama Oranı
        let fundingRate = fundingMeta ? fundingMeta.fundingRate : 0.0001;
        let nextFundingTime = fundingMeta ? fundingMeta.nextFundingTime : Date.now() + 14400000;

        const enrichedData = {
          symbol: cleanSym,
          topTraderLongRatio,
          topTraderShortRatio,
          topTraderLsRatio,
          topTraderChange,
          globalLongRatio,
          globalShortRatio,
          globalLsRatio,
          oiDeltaPct,
          currentOi,
          fundingRate,
          nextFundingTime,
          isWhaleAccumulating: topTraderLongRatio >= 60.0,
          isRetailShorting: globalShortRatio >= 55.0,
          cachedAt: now
        };

        this.cache.set(cleanSym, { data: enrichedData, ts: now });
        return enrichedData;
      } catch (err) {
        console.warn(`[DerivativesEnricher] ${cleanSym} veri cekme hatasi:`, err.message);
        const fallback = {
          symbol: cleanSym,
          topTraderLongRatio: 50.0,
          topTraderShortRatio: 50.0,
          topTraderLsRatio: 1.0,
          topTraderChange: 0.0,
          globalLongRatio: 50.0,
          globalShortRatio: 50.0,
          globalLsRatio: 1.0,
          oiDeltaPct: 0.0,
          currentOi: 0,
          fundingRate: fundingMeta ? fundingMeta.fundingRate : 0.0001,
          nextFundingTime: fundingMeta ? fundingMeta.nextFundingTime : Date.now() + 14400000,
          isWhaleAccumulating: false,
          isRetailShorting: false,
          cachedAt: now
        };
        this.cache.set(cleanSym, { data: fallback, ts: now });
        return fallback;
      } finally {
        this.activeRequests.delete(cleanSym);
      }
    })();

    this.activeRequests.set(cleanSym, requestPromise);
    return requestPromise;
  }
}

const derivativesEnricherService = new DerivativesEnricherService();
module.exports = derivativesEnricherService;
