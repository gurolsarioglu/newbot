/**
 * symbol-registry.js — Tarayıcı Tarafı Borsa Kontrat Defteri
 * Binance /api/exchange-info uç noktasından gelen resmi tickSize ve minMove değerlerini saklar.
 */

const SymbolRegistry = (() => {
  const symbolMap = new Map();

  // Temel fallback tablosu
  const fallbacks = {
    'BTCUSDT': { decimals: 1, minMove: 0.1 },
    'ETHUSDT': { decimals: 2, minMove: 0.01 },
    'SOLUSDT': { decimals: 2, minMove: 0.01 },
    'DOGEUSDT': { decimals: 5, minMove: 0.00001 },
    'IMXUSDT': { decimals: 4, minMove: 0.0001 },
    '1000PEPEUSDT': { decimals: 7, minMove: 0.0000001 },
    '1000SHIBUSDT': { decimals: 6, minMove: 0.000001 },
    'SUIUSDT': { decimals: 4, minMove: 0.0001 },
    'WIFUSDT': { decimals: 4, minMove: 0.0001 }
  };

  Object.entries(fallbacks).forEach(([s, m]) => symbolMap.set(s, m));

  async function init() {
    try {
      const res = await fetch('/api/exchange-info');
      if (!res.ok) return;
      const data = await res.json();
      Object.entries(data).forEach(([sym, meta]) => {
        symbolMap.set(sym, {
          decimals: meta.decimals,
          minMove: meta.minMove,
          tickSize: meta.tickSize,
          stepSize: meta.stepSize
        });
      });
    } catch (e) {
      console.warn('[SymbolRegistry Frontend] Exchange info yuklenemedi (fallback aktif):', e.message);
    }
  }

  function getPrecision(symbol) {
    if (!symbol) return 2;
    const clean = String(symbol).toUpperCase().trim();
    const meta = symbolMap.get(clean);
    return meta ? meta.decimals : 2;
  }

  function getMinMove(symbol) {
    if (!symbol) return 0.01;
    const clean = String(symbol).toUpperCase().trim();
    const meta = symbolMap.get(clean);
    return meta ? meta.minMove : 0.01;
  }

  function getSymbol(symbol) {
    if (!symbol) return null;
    return symbolMap.get(String(symbol).toUpperCase().trim()) || null;
  }

  // Sayfa açıldığında arka planda başlat
  if (typeof window !== 'undefined') {
    init();
  }

  return {
    init,
    getPrecision,
    getMinMove,
    getSymbol,
    symbolMap
  };
})();

if (typeof window !== 'undefined') {
  window.SymbolRegistry = SymbolRegistry;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SymbolRegistry;
}
