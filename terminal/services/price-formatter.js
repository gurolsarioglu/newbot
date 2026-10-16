/**
 * price-formatter.js — Alpha Terminal Kripto Fiyat Hassasiyet Koruma Motoru (Backend)
 * 
 * Kripto vadeli piyasalarında 0.17890, 0.004890 veya 0.00001850 gibi mikro rakamların
 * basamaklarını asla körlemesine kırpmaz, yuvarlamaz veya yutmaz.
 * Sembol biliniyorsa doğrudan SymbolRegistry'den gelen resmi kontrat tickSize hassasiyetini uygular.
 */

const symbolRegistry = require('./symbol-registry.service');

/**
 * Verilen fiyat değerinin gerçek ondalık basamak sayısını tespit eder.
 */
function getDecimalPlaces(val, symbol = null) {
  if (symbol) {
    return symbolRegistry.getPrecision(symbol);
  }

  if (val === null || val === undefined || val === '') return 2;

  // String olarak geldiyse orijinal basamak sayısını tespit et
  const str = String(val).trim();
  if (str.includes('.') && !str.includes('e') && !str.includes('E')) {
    const fraction = str.split('.')[1];
    return fraction.length;
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

/**
 * Fiyatı tick hassasiyetini koruyarak güvenle formatlar.
 * @param {string|number} rawPrice 
 * @param {number|string|null} precisionOrSymbol - sayı ise doğrudan o basamak, string ise sembolün resmi basamağı
 */
function formatCryptoPrice(rawPrice, precisionOrSymbol = null) {
  if (rawPrice === null || rawPrice === undefined || rawPrice === '') return '0.00';

  // 1. Eğer parametre bir sembol string'i ise (örn: 'BTCUSDT', 'DOGEUSDT')
  if (typeof precisionOrSymbol === 'string' && isNaN(Number(precisionOrSymbol))) {
    const precision = symbolRegistry.getPrecision(precisionOrSymbol);
    const n = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
    if (isNaN(n)) return '0.00';
    return n.toFixed(precision);
  }

  // 2. Eğer açıkça bir sayısal precision belirtilmişse
  if (typeof precisionOrSymbol === 'number') {
    const n = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
    if (isNaN(n)) return '0.00';
    return n.toFixed(precisionOrSymbol);
  }

  // 3. String olarak geldiyse orijinal halini koru
  if (typeof rawPrice === 'string') {
    const str = rawPrice.trim();
    if (/^-?\d+(\.\d+)?$/.test(str) && !str.includes('e') && !str.includes('E')) {
      return str;
    }
  }

  const num = typeof rawPrice === 'number' ? rawPrice : parseFloat(rawPrice);
  if (isNaN(num)) return '0.00';
  if (num === 0) return '0.00';

  const dec = getDecimalPlaces(rawPrice);
  return num.toFixed(dec);
}

/**
 * formatPrice takma adı
 */
function formatPrice(rawPrice, symbol) {
  return formatCryptoPrice(rawPrice, symbol);
}

/**
 * Boost/Drop oranına göre önceki fiyatı (prevPrice) orijinal hassasiyeti koruyarak hesaplar.
 */
function computePrevPrice(priceNum, changePct, originalPriceOrSymbol) {
  if (!priceNum || isNaN(priceNum) || !changePct || isNaN(changePct)) {
    return originalPriceOrSymbol ? String(originalPriceOrSymbol) : '0.00';
  }

  const computed = priceNum / (1 + changePct / 100);
  let decimals = 2;
  if (typeof originalPriceOrSymbol === 'string' && isNaN(Number(originalPriceOrSymbol))) {
    decimals = symbolRegistry.getPrecision(originalPriceOrSymbol);
  } else {
    decimals = getDecimalPlaces(originalPriceOrSymbol || priceNum);
  }

  return computed.toFixed(decimals);
}

module.exports = {
  formatCryptoPrice,
  formatPrice,
  computePrevPrice,
  getDecimalPlaces
};
