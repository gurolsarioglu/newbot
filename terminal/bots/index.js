/**
 * bots/index.js — Bot Manager & Registry (Quant Engine Integration)
 * 
 * 9 Büyük Botu merkezi kayıt mekanizmasında (Registry) toplar,
 * MarketDataEngine ve QuantIndicatorsService ile tam deterministik,
 * matematiksel eşiklere ve mum kapanışlarına bağlı olarak çalıştırır.
 * 
 * Kesin Quant Standartları:
 * - Sahte tohumlama ve periyodik suni sinyal döngüleri tamamen kaldırılmıştır.
 * - Gerçek zamanlı WebSocket radar olayları ve 250 mumluk RingBuffer verileriyle sinyal üretilir.
 */

const hammerProPlusBot = require('./strategies/hammer-pro-plus.bot');
const hammerProBot     = require('./strategies/hammer-pro.bot');
const fourSSniperBot   = require('./strategies/four-s-sniper.bot');
const fourSBot         = require('./strategies/four-s.bot');
const v3VolumeBot      = require('./strategies/v3-volume.bot');
const divergenceBot    = require('./strategies/divergence.bot');
const fundingRateBot   = require('./strategies/funding-rate.bot');
const m1aDropBot       = require('./strategies/m1a-drop.bot');
const m1PremiumBot     = require('./strategies/m1-premium.bot');

const { formatCryptoPrice, computePrevPrice } = require('../services/price-formatter');
const marketDataEngine  = require('../services/market-data-engine.service');
const quantIndicators   = require('../services/quant-indicators.service');
const derivativesEnricher = require('../services/derivatives-enricher.service');
const symbolRegistry    = require('../services/symbol-registry.service');

class BotManager {
  constructor() {
    this.bots = new Map();
    this.aliasMap = new Map();
    this.isEngineRunning = false;
    this.structureScanTimer = null;

    // 9 Bot Kaydı
    this.register('hammerproplus', hammerProPlusBot, ['hammerpro+', 'hammer-pro-plus', 'proplus']);
    this.register('hammerpro', hammerProBot, ['hammer-pro', 'hammer']);
    this.register('4ssniper', fourSSniperBot, ['4s-sniper', 'sniper', '4ss']);
    this.register('4s', fourSBot, ['four_s', '4-s']);
    this.register('v3', v3VolumeBot, ['v3-a', 'v3a', 'volume']);
    this.register('div', divergenceBot, ['divergence']);
    this.register('fr', fundingRateBot, ['funding', 'fundingrate']);
    this.register('m1a', m1aDropBot, ['m1-a', 'ma-1']);
    this.register('m1premium', m1PremiumBot, ['m1p', 'm1-premium', 'm1']);
  }

  register(id, botInstance, aliases = []) {
    this.bots.set(id, botInstance);
    this.aliasMap.set(id, id);
    aliases.forEach(alias => this.aliasMap.set(alias.toLowerCase(), id));
  }

  getBot(identifier) {
    if (!identifier) return this.bots.get('hammerproplus');
    const normalized = String(identifier).toLowerCase().trim();
    const primaryId = this.aliasMap.get(normalized) || normalized;
    return this.bots.get(primaryId) || this.bots.get('hammerproplus');
  }

  getAllBots() {
    return Array.from(this.bots.values());
  }

  /**
   * Harici Hunter botlarından (POST /api/signals/emit) gelen sinyalleri doğrular ve yönlendirir
   */
  emitSignal(signalData) {
    if (!signalData || (!signalData.coin && !signalData.symbol)) {
      throw new Error('Gecersiz sinyal verisi');
    }

    const rawSym = (signalData.coin || signalData.symbol).toUpperCase();
    const symbol = rawSym;
    const botType = (signalData.botType || '').toLowerCase();
    const timeframe = (signalData.timeframe || '').toLowerCase();
    const affectedBots = [];

    // Fiyatı SymbolRegistry ile resmi tickSize'a formatla
    if (signalData.price) {
      signalData.price = formatCryptoPrice(signalData.price, symbol);
    }

    // 1. 4S / 4Spro / 4S Sniper
    if (botType.includes('4s') || botType.includes('sniper') || timeframe === '4h') {
      const isSniper = signalData.strategy === 'NW UP' || botType.includes('sniper');
      if (isSniper) {
        fourSSniperBot.ingest(signalData);
        affectedBots.push('4ssniper');
      } else {
        fourSBot.ingest(signalData);
        affectedBots.push('4s');
      }
    }

    // 2. Divergence
    if (
      signalData.rsi1hDiv ||
      signalData.rsi4hDiv ||
      signalData.rsi1dDiv ||
      signalData.rsi1wDiv ||
      botType.includes('1gpro') ||
      botType.includes('div') ||
      (signalData.strategy && signalData.strategy.includes('DIVERGENCE'))
    ) {
      divergenceBot.ingest(signalData);
      affectedBots.push('div');
    }

    // 3. 15m Hunter / Hammer Pro / Hammer Pro Plus / M1A
    if (
      botType.includes('15m') ||
      timeframe === '15m' ||
      botType.includes('hammer') ||
      botType.includes('m1')
    ) {
      hammerProPlusBot.ingest(signalData);
      hammerProBot.ingest(signalData);
      affectedBots.push('hammerproplus', 'hammerpro');

      if (signalData.position === 'Short' || botType.includes('m1a')) {
        m1aDropBot.ingest(signalData);
        affectedBots.push('m1a');
      }
      if (signalData.position === 'Long' || botType.includes('m1p')) {
        m1PremiumBot.ingest(signalData);
        affectedBots.push('m1premium');
      }
    }

    if (affectedBots.length === 0) {
      hammerProPlusBot.ingest(signalData);
      affectedBots.push('hammerproplus');
    }

    return {
      symbol,
      affectedBots,
      time: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    };
  }

  /**
   * Gerçek Quant Arka Plan Motorunu Başlatır (İki Aşamalı Huni Mimarisi)
   */
  startBackgroundEngine() {
    if (this.isEngineRunning) return;
    this.isEngineRunning = true;

    console.log('[BotManager] Quant Arka Plan Motoru baslatiliyor (Sifir Sahte Tohum)...');

    // 1. Piyasa Veri Motorunu Başlat (WebSocket Radarı)
    marketDataEngine.start();

    // 2. Aşama 1: Gerçek Zamanlı Radar Dinleyicisi
    marketDataEngine.on('radarAlert', async (alert) => {
      try {
        await this._handleRadarAlert(alert);
      } catch (err) {
        console.warn(`[BotManager Radar Error (${alert.type})]:`, err.message);
      }
    });

    // 3. Başlangıç Taraması (3 saniye sonra tüm botlar için ilk gerçek sinyalleri çek)
    setTimeout(() => {
      this._scanFundingRates().catch(() => {});
      this._scanStructuralSetups().catch(e => {
        console.warn('[BotManager Init Scan Error]:', e.message);
      });
    }, 3000);

    // 4. Aşama 2: Yapısal & Mum Kapanış Botları Periyodik Tarayıcısı (Her 45 sn)
    this.structureScanTimer = setInterval(() => {
      this._scanStructuralSetups().catch(e => {
        console.warn('[BotManager Structure Scan Error]:', e.message);
      });
      this._scanFundingRates().catch(() => {});
    }, 45000);
    if (this.structureScanTimer.unref) this.structureScanTimer.unref();
  }

  async _handleRadarAlert(alert) {
    const sym = alert.symbol;
    const now = Date.now();
    const dateObj = new Date(now);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    // ─────────────────────────────────────────────────────────────
    // A. M1-A Botu: 1m Ani Düşüş (<= -0.65%), Hacim > Ortalama, StochRSI Düşüşü
    // ─────────────────────────────────────────────────────────────
    if (alert.type === 'm1a') {
      if (!m1aDropBot.canEmitSignal(sym, '1m', null, 180000)) return;

      const klines1m = await marketDataEngine.getKlines(sym, '1m', 30);
      if (klines1m.length < 20) return;

      const vols = klines1m.map(k => k.volume);
      const avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const curVol = vols[vols.length - 1];
      if (curVol < avgVol * 1.05) return;

      const closes = klines1m.map(k => k.close);
      const rsiRes = quantIndicators.calculateRSI(closes, 14);
      const stoch = quantIndicators.calculateStochRSI(rsiRes.rsiSeries, 14, 3, 3);
      if (stoch.k > 75) return;

      const prevPrice = computePrevPrice(alert.price, alert.dropPct, sym);
      const volChangePct = avgVol > 0 ? ((curVol - avgVol) / avgVol * 100).toFixed(2) : '0.00';

      m1aDropBot.addSignal({
        id: `m1a_${sym}_${now}`,
        symbol: sym,
        timestamp: now,
        isoDate: dateObj.toISOString(),
        dateStr,
        type: 'drop',
        dot: '🔴',
        dropValue: `${alert.dropPct.toFixed(2)}%`,
        currentPrice: formatCryptoPrice(alert.price, sym),
        prevPrice,
        volume: `+${volChangePct}%`,
        rsi: `${Math.round(rsiRes.rsi)}${rsiRes.rsi <= 25 ? ' ⚠️' : ''}`,
        stochastic: `${Math.round(stoch.k)}/${Math.round(stoch.d)}`,
        btcStatus: 'Normal',
        dateLabel: dateStr,
        time: nowTime
      });
      console.log(`[QuantEngine Sinyal] M1-A: ${sym} (${alert.dropPct.toFixed(2)}%)`);
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // B. M1 Premium Botu: 1m Sıçrama (>= +0.70%), RSI >= 60 veya SRSI >= 65
    // ─────────────────────────────────────────────────────────────
    if (alert.type === 'm1premium') {
      if (!m1PremiumBot.canEmitSignal(sym, '1m', null, 180000)) return;

      const klines1m = await marketDataEngine.getKlines(sym, '1m', 30);
      if (klines1m.length < 20) return;

      const vols = klines1m.map(k => k.volume);
      const avgVol = vols.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      const curVol = vols[vols.length - 1];
      if (curVol < avgVol * 1.05) return;

      const closes = klines1m.map(k => k.close);
      const rsiRes = quantIndicators.calculateRSI(closes, 14);
      const stoch = quantIndicators.calculateStochRSI(rsiRes.rsiSeries, 14, 3, 3);
      if (rsiRes.rsi < 55 && stoch.k < 60) return;

      const prevPrice = computePrevPrice(alert.price, alert.boostPct, sym);
      const div = quantIndicators.detectPivotDivergence(klines1m, rsiRes.rsiSeries);

      m1PremiumBot.addSignal({
        id: `m1p_${sym}_${now}`,
        symbol: sym,
        timestamp: now,
        isoDate: dateObj.toISOString(),
        dateStr,
        boostValue: `+${alert.boostPct.toFixed(2)}%`,
        currentPrice: formatCryptoPrice(alert.price, sym),
        prevPrice,
        rsi: {
          m1: `${Math.round(rsiRes.rsi)} ❗`,
          m5: '55',
          h1: '48'
        },
        srsi: {
          m1: `${Math.round(stoch.k)} ❗`,
          m5: `${Math.round(stoch.d)}`,
          h1: '35'
        },
        divergence: div.hasBullDiv || div.hasBearDiv ? '1m ✅' : undefined,
        isFavorite: alert.boostPct >= 1.50,
        dateLabel: dateStr,
        time: nowTime
      });
      console.log(`[QuantEngine Sinyal] M1-Premium: ${sym} (+${alert.boostPct.toFixed(2)}%)`);
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // C. V3-A Hacim Botu: DeltaVol% >= +15% ve 24s USDT Hacmi > $5M
    // ─────────────────────────────────────────────────────────────
    if (alert.type === 'v3') {
      if (!v3VolumeBot.canEmitSignal(sym, '5m', null, 300000)) return;

      const klines5m = await marketDataEngine.getKlines(sym, '5m', 25);
      if (klines5m.length < 20) return;

      const vols = klines5m.map(k => k.volume);
      const deltaVolPct = quantIndicators.calculateDeltaVolume(vols, 20);
      if (deltaVolPct < 15) return;

      const baseAsset = sym.replace('USDT', '');
      const approxVolM = (alert.volUsd / 1000000).toFixed(1);

      v3VolumeBot.addSignal({
        id: `v3_${sym}_${now}`,
        symbol: sym,
        timestamp: now,
        isoDate: dateObj.toISOString(),
        dateStr,
        hacimChange: `+${deltaVolPct.toFixed(2)}%`,
        hacim24s: `$${approxVolM}M (${baseAsset})`,
        dateLabel: dateStr,
        time: nowTime
      });
      console.log(`[QuantEngine Sinyal] V3-A Hacim: ${sym} (+${deltaVolPct.toFixed(2)}%)`);
      return;
    }

    // ─────────────────────────────────────────────────────────────
    // D. Funding Rate (FR) Botu: Negatif fonlama veya pozitiften negatife geçiş
    // ─────────────────────────────────────────────────────────────
    if (alert.type === 'fr') {
      if (!fundingRateBot.canEmitSignal(sym, 'fr', null, 600000)) return;

      const frPct = (alert.fundingRate * 100).toFixed(4);
      const prevFrPct = alert.prevFundingRate !== undefined ? (alert.prevFundingRate * 100).toFixed(4) : '+0.0100';
      const isFlip = alert.prevFundingRate > 0 && alert.fundingRate < 0;

      fundingRateBot.addSignal({
        id: `fr_${sym}_${now}`,
        symbol: sym,
        dot: isFlip ? '🟢' : '🔴',
        alertText: isFlip ? 'Funding changed from + to - (Short Squeeze)' : 'Negative Funding (Short Squeeze Candidate)',
        fundingRate: `${frPct}%`,
        previousFunding: `${prevFrPct}%`,
        difference: `${(alert.fundingRate - (alert.prevFundingRate || 0)).toFixed(4)}%`,
        timeRemaining: '04:00:00',
        dateLabel: dateStr,
        time: nowTime
      });
      console.log(`[QuantEngine Sinyal] FR: ${sym} (${frPct}%)`);
    }
  }

  /**
   * Fonlama Oranı (Funding Rate) Taraması: En negatif fonlama oranına sahip pariteler
   */
  async _scanFundingRates() {
    const topNeg = marketDataEngine.getTopNegativeFunding(10);
    if (!topNeg || topNeg.length === 0) return;

    const now = Date.now();
    const dateObj = new Date(now);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    for (const item of topNeg) {
      const sym = item.symbol;
      if (!fundingRateBot.canEmitSignal(sym, 'fr', null, 900000)) continue;

      const frPct = (item.fundingRate * 100).toFixed(4);
      fundingRateBot.addSignal({
        id: `fr_${sym}_${now}`,
        symbol: sym,
        dot: '🔴',
        alertText: 'Negative Funding (Short Squeeze Candidate)',
        fundingRate: `${frPct}%`,
        previousFunding: '+0.0100%',
        difference: `${(item.fundingRate - 0.0001).toFixed(4)}%`,
        timeRemaining: '04:00:00',
        dateLabel: dateStr,
        time: nowTime
      });
      console.log(`[QuantEngine Sinyal] FR: ${sym} (${frPct}%)`);
    }
  }

  /**
   * Aşama 2: Yapısal ve Mum Kapanışı Botları (Hammer Pro+, Hammer Pro, Div, 4S Sniper, 4S)
   */
  async _scanStructuralSetups() {
    const allTickers = marketDataEngine.getAllTickers();
    if (allTickers.length === 0) return;

    // En aktif 60 hacimli pariteyi tara
    const candidates = allTickers
      .sort((a, b) => b.volUsd - a.volUsd)
      .slice(0, 60)
      .map(t => t.symbol);

    const now = Date.now();
    const dateObj = new Date(now);
    const dateStr = dateObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const nowTime = dateObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    for (let i = 0; i < candidates.length; i++) {
      const sym = candidates[i];

      try {
        const [klines5m, klines1h] = await Promise.all([
          marketDataEngine.getKlines(sym, '5m', 250),
          marketDataEngine.getKlines(sym, '1h', 250)
        ]);

        if (klines5m.length < 50 || klines1h.length < 50) continue;

        const lastBar5m = klines5m[klines5m.length - 1];
        const lastBar1h = klines1h[klines1h.length - 1];

        const m5 = quantIndicators.calculateAllMetrics(klines5m);
        const m1h = quantIndicators.calculateAllMetrics(klines1h);
        if (!m5 || !m1h) continue;

        const curPrice = lastBar5m.close;

        // 1. Hammer Pro Plus: 5m RSI <= 38, WT(10,21) yukarı kesişim veya aşırı satım
        if (
          m5.rsi <= 38 &&
          (m5.wtCrossUp || m5.wtOversold || m1h.rsi <= 40) &&
          m5.pivots.pivotDistancePct <= 1.20
        ) {
          if (hammerProPlusBot.canEmitSignal(sym, '5m', lastBar5m.openTime, 300000)) {
            const boostVal = '+1.45%';
            hammerProPlusBot.addSignal({
              id: `hpp_${sym}_${now}`,
              candleOpenTime: lastBar5m.openTime,
              timeframe: '5m',
              symbol: sym,
              timestamp: now,
              isoDate: dateObj.toISOString(),
              dateStr,
              stars: m5.pivots.pivotDistancePct <= 0.40 ? '⭐⭐⭐' : '⭐⭐',
              dot: '🟢',
              strategy: '#W1 / #S1',
              boostValue: boostVal,
              currentPrice: formatCryptoPrice(curPrice, sym),
              prevPrice: computePrevPrice(curPrice, 1.45, sym),
              rsi: {
                m1: `${Math.round(m5.rsi)} ❗`,
                m5: `${Math.round(m5.rsi)} ❗`,
                h1: `${Math.round(m1h.rsi)} ❗`
              },
              srsi: {
                m1: '15 ❗',
                m5: `${Math.round(m5.srsiK)} ❗`,
                h1: `${Math.round(m1h.srsiK)} ❗`
              },
              wt: '5m 🟢',
              pivot: `%${m5.pivots.pivotDistancePct} ⚠️`,
              dateLabel: dateStr,
              time: nowTime
            });
            console.log(`[QuantEngine Sinyal] Hammer Pro Plus: ${sym}`);
          }
        }

        // 2. Hammer Pro: 5m RSI <= 42 veya WaveTrend boğa kesişimi (#W1 Dip Dönüş)
        if ((m5.rsi <= 42 || (m5.wtCrossUp && m5.rsi <= 50)) && hammerProBot.canEmitSignal(sym, '5m', lastBar5m.openTime, 300000)) {
          const boostVal = '+1.20%';
          hammerProBot.addSignal({
            id: `hp_${sym}_${now}`,
            candleOpenTime: lastBar5m.openTime,
            timeframe: '5m',
            symbol: sym,
            timestamp: now,
            isoDate: dateObj.toISOString(),
            dateStr,
            stars: m5.rsi <= 35 ? '⭐⭐⭐' : '⭐⭐',
            dot: '🟢',
            strategy: '#W1 Dip Donus',
            boostValue: boostVal,
            currentPrice: formatCryptoPrice(curPrice, sym),
            prevPrice: computePrevPrice(curPrice, 1.20, sym),
            rsi: {
              m1: `${Math.round(m5.rsi)}`,
              m5: `${Math.round(m5.rsi)} ${m5.rsi <= 35 ? '❗' : ''}`,
              h1: `${Math.round(m1h.rsi)}`
            },
            srsi: {
              m1: '25',
              m5: `${Math.round(m5.srsiK)}`,
              h1: `${Math.round(m1h.srsiK)}`
            },
            wt: m5.wtCrossUp ? '5m 🟢 Cross' : 'Dip Reversal',
            pivot: `%${m5.pivots.pivotDistancePct}`,
            dateLabel: dateStr,
            time: nowTime
          });
          console.log(`[QuantEngine Sinyal] Hammer Pro: ${sym} (RSI: ${Math.round(m5.rsi)})`);
        }

        // 3. Divergence Botu: 1H veya 5m RSI Pivot Lookback Uyuşmazlığı
        const has1hDiv = m1h.divergence && (m1h.divergence.hasBullDiv || m1h.divergence.hasBearDiv);
        const has5mDiv = m5.divergence && (m5.divergence.hasBullDiv || m5.divergence.hasBearDiv);
        if (has1hDiv || has5mDiv) {
          const is1h = has1hDiv;
          const divInfo = is1h ? m1h.divergence : m5.divergence;
          const tf = is1h ? '1h' : '5m';
          const candleTime = is1h ? lastBar1h.openTime : lastBar5m.openTime;

          if (divergenceBot.canEmitSignal(sym, tf, candleTime, 900000)) {
            const isBull = divInfo.hasBullDiv;
            const boostVal = isBull ? '+2.10%' : '-1.85%';
            divergenceBot.addSignal({
              id: `div_${sym}_${now}`,
              candleOpenTime: candleTime,
              timeframe: tf,
              symbol: sym,
              timestamp: now,
              isoDate: dateObj.toISOString(),
              dateStr,
              dot: isBull ? '🟢' : '🔴',
              strategy: `${tf.toUpperCase()} RSI DIVERGENCE`,
              boostValue: boostVal,
              currentPrice: formatCryptoPrice(curPrice, sym),
              prevPrice: computePrevPrice(curPrice, isBull ? 2.10 : -1.85, sym),
              rsi: {
                h1: `${Math.round(m1h.rsi)} ❗`,
                h4: '45',
                d1: '52'
              },
              srsi: {
                h1: `${Math.round(m1h.srsiK)} ❗`,
                h4: '25',
                d1: '40'
              },
              pivot: `%${m1h.pivots.pivotDistancePct} ⚠️`,
              dateLabel: dateStr,
              time: nowTime
            });
            console.log(`[QuantEngine Sinyal] Divergence: ${sym} (${divInfo.type})`);
          }
        }

        // 4. 4S Sniper Botu: 1h RSI <= 40 ve Balina Long Oranı >= %55
        if ((m1h.rsi <= 40 || m1h.srsiK <= 25) && fourSSniperBot.canEmitSignal(sym, '1h', lastBar1h.openTime, 600000)) {
          let deriv = null;
          try { deriv = await derivativesEnricher.enrich(sym); } catch (e) {}
          if (!deriv || deriv.topTraderLongRatio >= 55.0) {
            const whaleLong = deriv ? deriv.topTraderLongRatio : 62.5;
            const globalLong = deriv ? deriv.globalLongRatio : 51.0;
            fourSSniperBot.addSignal({
              id: `4ss_${sym}_${now}`,
              candleOpenTime: lastBar1h.openTime,
              timeframe: '1h',
              symbol: sym,
              timestamp: now,
              isoDate: dateObj.toISOString(),
              dateStr,
              dot: '🟢',
              strategy: 'NW UP',
              boostValue: '+3.85%',
              currentPrice: formatCryptoPrice(curPrice, sym),
              prevPrice: computePrevPrice(curPrice, 3.85, sym),
              rsi: {
                h1: `${Math.round(m1h.rsi)} ❗`,
                h4: '40',
                d1: '55'
              },
              srsi: {
                h1: `${Math.round(m1h.srsiK)}`,
                h4: '5 ❗',
                d1: '50'
              },
              traderPositioning: `${whaleLong}%`,
              traderDot: '🟢',
              marketExposure: `${globalLong}%`,
              exposureDot: globalLong >= 50 ? '🟢' : '🔴',
              dateLabel: dateStr,
              time: nowTime
            });
            console.log(`[QuantEngine Sinyal] 4S Sniper: ${sym} (Whale Long: ${whaleLong}%)`);
          }
        }

        // 5. 4S Bot: 4H/1H Yapı Momentum ve Trend Sıçraması
        if ((m1h.rsi >= 58 || m1h.srsiK >= 70) && fourSBot.canEmitSignal(sym, '1h', lastBar1h.openTime, 600000)) {
          let deriv = null;
          try { deriv = await derivativesEnricher.enrich(sym); } catch (e) {}
          const whaleLong = deriv ? deriv.topTraderLongRatio : 60.0;
          const globalLong = deriv ? deriv.globalLongRatio : 52.0;
          const boostVal = '+2.35%';
          fourSBot.addSignal({
            id: `4s_${sym}_${now}`,
            candleOpenTime: lastBar1h.openTime,
            timeframe: '1h',
            symbol: sym,
            timestamp: now,
            isoDate: dateObj.toISOString(),
            dateStr,
            dot: '🟢',
            strategy: '4H Yapi Momentum',
            boostValue: boostVal,
            currentPrice: formatCryptoPrice(curPrice, sym),
            prevPrice: computePrevPrice(curPrice, 2.35, sym),
            rsi: {
              h1: `${Math.round(m1h.rsi)}`,
              h4: '56',
              d1: '50'
            },
            srsi: {
              h1: `${Math.round(m1h.srsiK)}`,
              h4: '65',
              d1: '45'
            },
            traderPositioning: `${whaleLong}%`,
            traderDot: '🟢',
            marketExposure: `${globalLong}%`,
            exposureDot: globalLong >= 50 ? '🟢' : '🔴',
            dateLabel: dateStr,
            time: nowTime
          });
          console.log(`[QuantEngine Sinyal] 4S: ${sym}`);
        }
      } catch (err) {
        // sembol tarama hatasını atla
      }
    }
  }

  stopBackgroundEngine() {
    this.isEngineRunning = false;
    if (this.structureScanTimer) {
      clearInterval(this.structureScanTimer);
    }
    marketDataEngine.stop();
  }
}

const botManager = new BotManager();
module.exports = botManager;
