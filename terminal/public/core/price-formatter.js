/**
 * price-formatter.js — Tarayıcı Tarafı Hassas Fiyat Formatlayıcı
 * Kripto fiyatlarında 0.17890, 0.004890, 0.00001850 gibi hiçbir rakamı kesmez,
 * yapay yuvarlama yapmaz, SymbolRegistry ile borsa kontrat hassasiyetini korur.
 */
const PriceFormatter = (() => {
  function getDecimalPlaces(val, symbol = null) {
    if (symbol && typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getPrecision) {
      return SymbolRegistry.getPrecision(symbol);
    }

    if (val === null || val === undefined || val === '') return 2;

    const str = String(val).trim();
    if (str.includes('.') && !str.includes('e') && !str.includes('E')) {
      return str.split('.')[1].length;
    }

    const num = typeof val === 'number' ? val : Number(val);
    const abs = !isNaN(num) ? Math.abs(num) : 0;
    if (abs === 0) return 2;

    if (abs < 0.0001) return 8;
    if (abs < 0.01) return 6;
    if (abs < 1) return 5;
    if (abs < 100) return 4;
    return 2;
  }

  function format(val, precisionOrSymbol = null) {
    if (val === null || val === undefined || val === '') return '—';

    // 1. Sembol verilmişse SymbolRegistry üzerinden resmi basamağı al
    if (typeof precisionOrSymbol === 'string' && isNaN(Number(precisionOrSymbol))) {
      let precision = 2;
      if (typeof SymbolRegistry !== 'undefined' && SymbolRegistry.getPrecision) {
        precision = SymbolRegistry.getPrecision(precisionOrSymbol);
      } else {
        precision = getDecimalPlaces(val);
      }
      const n = typeof val === 'number' ? val : parseFloat(val);
      if (isNaN(n)) return '—';
      return n.toFixed(precision);
    }

    // 2. Sayısal precision belirtilmişse
    if (precisionOrSymbol !== null && typeof precisionOrSymbol === 'number') {
      const n = typeof val === 'number' ? val : parseFloat(val);
      if (isNaN(n)) return '—';
      return n.toFixed(precisionOrSymbol);
    }

    // 3. String olarak geldiyse orijinal basamakları koru
    if (typeof val === 'string') {
      const str = val.trim();
      if (/^-?\d+(\.\d+)?$/.test(str) && !str.includes('e') && !str.includes('E')) {
        return str;
      }
    }

    const num = typeof val === 'number' ? val : parseFloat(val);
    if (isNaN(num)) return '—';
    if (num === 0) return '0.00';

    const dec = getDecimalPlaces(val);
    return num.toFixed(dec);
  }

  return { format, getDecimalPlaces };
})();

if (typeof window !== 'undefined') {
  window.PriceFormatter = PriceFormatter;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = PriceFormatter;
}
