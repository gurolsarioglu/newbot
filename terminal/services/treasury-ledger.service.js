/**
 * treasury-ledger.service.js — Kasa Defteri & İşlem Günlüğü Servisi
 * Excel formatındaki kasa defterini ve Binance gerçekleşen kâr/zarar kayıtlarını yönetir.
 */

const fs = require('fs');
const path = require('path');

const LEDGER_FILE = path.join(__dirname, '..', 'data', 'treasury_ledger.json');

// Kullanıcının Excel tablosundan birebir aktarılan başlangıç geçmişi (30 Gerçek İşlem)
const DEFAULT_EXCEL_TRADES = [
  { id: 't_00', coin: 'BTC/USDT', symbol: 'BTCUSDT', date: 'Başlangıç', time: '—', side: '—', profitUsd: 0.00, runningBalance: 10.00, returnPct: 0.00, notes: 'Başlangıç Sermayesi', source: 'excel', timestamp: 1729830000000 },
  { id: 't_01', coin: 'BAS', symbol: 'BASUSDT', date: '25.10.2025', time: '10:11', side: 'S', profitUsd: 0.82, runningBalance: 10.82, returnPct: 8.20, notes: '', source: 'excel', timestamp: 1729840260000 },
  { id: 't_02', coin: 'LIGHT', symbol: 'LIGHTUSDT', date: '25.10.2025', time: '10:16', side: 'L', profitUsd: 1.28, runningBalance: 12.10, returnPct: 11.83, notes: '', source: 'excel', timestamp: 1729840560000 },
  { id: 't_03', coin: 'STB', symbol: 'STBUSDT', date: '25.10.2025', time: '10:39', side: 'S', profitUsd: 0.34, runningBalance: 12.44, returnPct: 2.81, notes: '', source: 'excel', timestamp: 1729841940000 },
  { id: 't_04', coin: 'COS', symbol: 'COSUSDT', date: '25.10.2025', time: '10:48', side: 'S', profitUsd: 0.15, runningBalance: 12.59, returnPct: 1.21, notes: '', source: 'excel', timestamp: 1729842480000 },
  { id: 't_05', coin: 'B2', symbol: 'B2USDT', date: '25.10.2025', time: '11:00', side: 'S', profitUsd: 0.61, runningBalance: 13.20, returnPct: 4.85, notes: '', source: 'excel', timestamp: 1729843200000 },
  { id: 't_06', coin: 'ENSO', symbol: 'ENSOUSDT', date: '25.10.2025', time: '11:11', side: 'S', profitUsd: 0.03, runningBalance: 13.23, returnPct: 0.23, notes: '', source: 'excel', timestamp: 1729843860000 },
  { id: 't_07', coin: 'OL', symbol: 'OLUSDT', date: '25.10.2025', time: '12:25', side: 'S', profitUsd: -2.53, runningBalance: 10.70, returnPct: -19.12, notes: '5D UYUMSUZLUK VARDI AMA TERSE GİTTİ', source: 'excel', timestamp: 1729848300000 },
  { id: 't_08', coin: 'EDEN', symbol: 'EDENUSDT', date: '25.10.2025', time: '18:23', side: 'L', profitUsd: 0.22, runningBalance: 10.92, returnPct: 2.06, notes: '', source: 'excel', timestamp: 1729869780000 },
  { id: 't_09', coin: 'XAN', symbol: 'XANUSDT', date: '25.10.2025', time: '18:34', side: 'S', profitUsd: 0.56, runningBalance: 11.48, returnPct: 5.13, notes: '', source: 'excel', timestamp: 1729870440000 },
  { id: 't_10', coin: '4USDT', symbol: '4USDT', date: '25.10.2025', time: '18:47', side: 'S', profitUsd: 1.51, runningBalance: 12.99, returnPct: 13.15, notes: '', source: 'excel', timestamp: 1729871220000 },
  { id: 't_11', coin: 'ENSO', symbol: 'ENSOUSDT', date: '27.10.2025', time: '07:13', side: 'S', profitUsd: 0.57, runningBalance: 13.56, returnPct: 4.39, notes: '', source: 'excel', timestamp: 1730002380000 },
  { id: 't_12', coin: 'MYRO', symbol: 'MYROUSDT', date: '27.10.2025', time: '08:13', side: 'S', profitUsd: -5.63, runningBalance: 7.93, returnPct: -41.52, notes: 'EN AZINDAN KOL KESMEYİ ÖĞRENDİM', source: 'excel', timestamp: 1730005980000 },
  { id: 't_13', coin: 'ZBT', symbol: 'ZBTUSDT', date: '27.10.2025', time: '10:48', side: 'L', profitUsd: 0.31, runningBalance: 8.24, returnPct: 3.91, notes: '', source: 'excel', timestamp: 1730015280000 },
  { id: 't_14', coin: 'ME', symbol: 'MEUSDT', date: '27.10.2025', time: '10:58', side: 'S', profitUsd: 0.13, runningBalance: 8.37, returnPct: 1.58, notes: '', source: 'excel', timestamp: 1730015880000 },
  { id: 't_15', coin: 'XNY', symbol: 'XNYUSDT', date: '27.10.2025', time: '11:07', side: 'S', profitUsd: 0.18, runningBalance: 8.55, returnPct: 2.15, notes: '', source: 'excel', timestamp: 1730016420000 },
  { id: 't_16', coin: 'BMT', symbol: 'BMTUSDT', date: '27.10.2025', time: '18:55', side: 'S', profitUsd: 0.63, runningBalance: 9.18, returnPct: 7.37, notes: '', source: 'excel', timestamp: 1730044500000 },
  { id: 't_17', coin: 'LIGHT', symbol: 'LIGHTUSDT', date: '28.10.2025', time: '07:20', side: 'S', profitUsd: 0.30, runningBalance: 9.48, returnPct: 3.27, notes: '', source: 'excel', timestamp: 1730089200000 },
  { id: 't_18', coin: 'HUSDT', symbol: 'HUSDT', date: '28.10.2025', time: '10:55', side: 'S', profitUsd: 0.36, runningBalance: 9.84, returnPct: 3.80, notes: 'M1 ÇİFT ÜNLEM+HAMMER', source: 'excel', timestamp: 1730102100000 },
  { id: 't_19', coin: 'FLOCK', symbol: 'FLOCKUSDT', date: '28.10.2025', time: '11:13', side: 'S', profitUsd: 0.35, runningBalance: 10.19, returnPct: 3.56, notes: '', source: 'excel', timestamp: 1730103180000 },
  { id: 't_20', coin: '42', symbol: '42USDT', date: '28.10.2025', time: '12:59', side: 'L', profitUsd: 0.25, runningBalance: 10.44, returnPct: 2.45, notes: '', source: 'excel', timestamp: 1730109540000 },
  { id: 't_21', coin: 'RECALL', symbol: 'RECALLUSDT', date: '28.10.2025', time: '13:07', side: 'L', profitUsd: 0.26, runningBalance: 10.70, returnPct: 2.49, notes: 'M1 Gelen sinyal', source: 'excel', timestamp: 1730110020000 },
  { id: 't_22', coin: 'AIO', symbol: 'AIOUSDT', date: '28.10.2025', time: '13:14', side: 'S', profitUsd: 0.13, runningBalance: 10.83, returnPct: 1.21, notes: '', source: 'excel', timestamp: 1730110440000 },
  { id: 't_23', coin: 'MAVIA', symbol: 'MAVIAUSDT', date: '28.10.2025', time: '13:19', side: 'L', profitUsd: 0.96, runningBalance: 11.79, returnPct: 8.86, notes: 'LİMİT EMRİNİ BEKLESEM KORKMASAM ÇOK DAHA İYİ OLACAKTA', source: 'excel', timestamp: 1730110740000 },
  { id: 't_24', coin: 'HUSDT', symbol: 'HUSDT', date: '28.10.2025', time: '14:02', side: 'S', profitUsd: 0.48, runningBalance: 12.27, returnPct: 4.07, notes: 'M1', source: 'excel', timestamp: 1730113320000 },
  { id: 't_25', coin: 'ENSO', symbol: 'ENSOUSDT', date: '28.10.2025', time: '14:11', side: 'L', profitUsd: 0.72, runningBalance: 12.99, returnPct: 5.87, notes: 'M1 +HAMMER 2 YILDIZ', source: 'excel', timestamp: 1730113860000 },
  { id: 't_26', coin: 'KERNEL', symbol: 'KERNELUSDT', date: '28.10.2025', time: '14:19', side: 'S', profitUsd: 0.22, runningBalance: 13.21, returnPct: 1.69, notes: 'OLABİLDİĞİNCE LİMİTLE SATIŞ YAP', source: 'excel', timestamp: 1730114340000 },
  { id: 't_27', coin: 'AVA', symbol: 'AVAUSDT', date: '28.10.2025', time: '18:48', side: 'S', profitUsd: 0.92, runningBalance: 14.13, returnPct: 6.96, notes: 'V3+M1 !!', source: 'excel', timestamp: 1730130480000 },
  { id: 't_28', coin: 'MAVIA', symbol: 'MAVIAUSDT', date: '28.10.2025', time: '19:16', side: 'S', profitUsd: 0.77, runningBalance: 14.90, returnPct: 5.45, notes: 'M1 !!', source: 'excel', timestamp: 1730132160000 },
  { id: 't_29', coin: 'JUMA+MERL', symbol: 'JUMAUSDT', date: '28.10.2025', time: '21:29', side: 'L', profitUsd: 1.00, runningBalance: 15.90, returnPct: 6.71, notes: 'PEŞ PEŞE GİRDİM', source: 'excel', timestamp: 1730140140000 },
  { id: 't_30', coin: 'TRADOOR', symbol: 'TRADOORUSDT', date: '28.10.2025', time: '22:27', side: 'L', profitUsd: 0.20, runningBalance: 16.10, returnPct: 1.26, notes: 'MARKETTEN SATMAK KADAR KÖTÜSÜ YOK', source: 'excel', timestamp: 1730143620000 }
];

class TreasuryLedgerService {
  constructor() {
    this.initialCapital = 10.00;
    this.trades = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(LEDGER_FILE)) {
        const raw = fs.readFileSync(LEDGER_FILE, 'utf8');
        const data = JSON.parse(raw);
        this.initialCapital = parseFloat(data.initialCapital) || 10.00;
        this.trades = Array.isArray(data.trades) && data.trades.length > 0 ? data.trades : [...DEFAULT_EXCEL_TRADES];
      } else {
        this.trades = [...DEFAULT_EXCEL_TRADES];
        this._save();
      }
    } catch (e) {
      console.warn('[TreasuryLedger] Dosya yuklenirken hata, varsayilan Excel yuklendi:', e.message);
      this.trades = [...DEFAULT_EXCEL_TRADES];
    }
    this._recalculateChain();
  }

  _save() {
    try {
      const data = {
        initialCapital: this.initialCapital,
        updatedAt: new Date().toISOString(),
        trades: this.trades
      };
      fs.writeFileSync(LEDGER_FILE, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error('[TreasuryLedger] Kaydetme hatasi:', e.message);
    }
  }

  // Zincirleme Kasa Bakiyesi ve Getiri Yüzdelerini Baştan Sona Hesapla
  _recalculateChain() {
    let currentBalance = this.initialCapital;
    
    for (let i = 0; i < this.trades.length; i++) {
      const t = this.trades[i];
      if (i === 0 && t.profitUsd === 0) {
        t.runningBalance = this.initialCapital;
        t.returnPct = 0;
        continue;
      }
      
      const prevBal = currentBalance;
      const profit = parseFloat(t.profitUsd) || 0;
      currentBalance = +(currentBalance + profit).toFixed(2);
      
      t.runningBalance = currentBalance;
      t.returnPct = prevBal > 0 ? +((profit / prevBal) * 100).toFixed(2) : 0;
    }
  }

  getStats() {
    this._recalculateChain();
    const tradeRows = this.trades.filter(t => t.id !== 't_00');
    const totalTrades = tradeRows.length;
    const wins = tradeRows.filter(t => (parseFloat(t.profitUsd) || 0) > 0);
    const losses = tradeRows.filter(t => (parseFloat(t.profitUsd) || 0) < 0);
    const evens = tradeRows.filter(t => (parseFloat(t.profitUsd) || 0) === 0);

    const netProfitUsd = +(tradeRows.reduce((acc, t) => acc + (parseFloat(t.profitUsd) || 0), 0)).toFixed(2);
    const currentBalance = +(this.initialCapital + netProfitUsd).toFixed(2);
    const netReturnPct = this.initialCapital > 0 ? +((netProfitUsd / this.initialCapital) * 100).toFixed(2) : 0;
    const winRatePct = totalTrades > 0 ? +((wins.length / totalTrades) * 100).toFixed(1) : 0;

    return {
      initialCapital: this.initialCapital,
      currentBalance,
      netProfitUsd,
      netReturnPct,
      totalTrades,
      winCount: wins.length,
      lossCount: losses.length,
      evenCount: evens.length,
      winRatePct
    };
  }

  getAll() {
    return {
      stats: this.getStats(),
      trades: this.trades
    };
  }

  addTrade(trade) {
    const now = new Date();
    const dateStr = trade.date || now.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = trade.time || now.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const newTrade = {
      id: trade.id || `tr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      coin: (trade.coin || trade.symbol || 'COIN').toUpperCase().replace('USDT', ''),
      symbol: (trade.symbol || `${trade.coin}USDT`).toUpperCase(),
      date: dateStr,
      time: timeStr,
      side: (trade.side || 'L').toUpperCase().startsWith('S') ? 'S' : 'L',
      profitUsd: +(parseFloat(trade.profitUsd) || 0).toFixed(2),
      runningBalance: 0, // _recalculateChain ile atanır
      returnPct: 0,      // _recalculateChain ile atanır
      notes: trade.notes || '',
      source: trade.source || 'manual',
      binanceTranId: trade.binanceTranId || null,
      timestamp: trade.timestamp || Date.now()
    };

    this.trades.push(newTrade);
    this._recalculateChain();
    this._save();
    return newTrade;
  }

  updateTrade(id, updates) {
    const idx = this.trades.findIndex(t => t.id === id);
    if (idx === -1) return null;

    if (updates.coin) this.trades[idx].coin = updates.coin.toUpperCase().replace('USDT', '');
    if (updates.side) this.trades[idx].side = updates.side.toUpperCase().startsWith('S') ? 'S' : 'L';
    if (updates.profitUsd !== undefined) this.trades[idx].profitUsd = +(parseFloat(updates.profitUsd) || 0).toFixed(2);
    if (updates.notes !== undefined) this.trades[idx].notes = updates.notes;
    if (updates.date) this.trades[idx].date = updates.date;
    if (updates.time) this.trades[idx].time = updates.time;

    this._recalculateChain();
    this._save();
    return this.trades[idx];
  }

  deleteTrade(id) {
    if (id === 't_00') return false; // Başlangıç satırı silinemez
    const before = this.trades.length;
    this.trades = this.trades.filter(t => t.id !== id);
    if (this.trades.length < before) {
      this._recalculateChain();
      this._save();
      return true;
    }
    return false;
  }

  setInitialCapital(amount) {
    const val = parseFloat(amount);
    if (!isNaN(val) && val > 0) {
      this.initialCapital = +val.toFixed(2);
      if (this.trades.length > 0 && this.trades[0].id === 't_00') {
        this.trades[0].runningBalance = this.initialCapital;
      }
      this._recalculateChain();
      this._save();
      return true;
    }
    return false;
  }

  resetToDefault() {
    this.initialCapital = 10.00;
    this.trades = JSON.parse(JSON.stringify(DEFAULT_EXCEL_TRADES));
    this._recalculateChain();
    this._save();
    return this.getAll();
  }
}

module.exports = new TreasuryLedgerService();
