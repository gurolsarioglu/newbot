/**
 * VerdictPlugin — Algoritmik Taktik & Canlı Teyit Motoru (Live Tactical Narrative)
 *
 * Sadece statik anlık durum değil; coin'in tüm yaşam döngüsünü (Setup -> İzleme -> Teyit -> Hedef/Stop)
 * anbean takip eder, seviye kırılımlarını ve OI sıçramalarını yakalayıp Türkçe sesli ve görsel olarak anlatır.
 */
const VerdictPlugin = (() => {
  let currentSymbol   = '';
  let currentInterval = '15m';
  let curPrice        = null;

  // Taktik Durum Makinesi
  let tacticalState   = 'IDLE'; // 'IDLE' | 'SETUP' | 'WATCHING' | 'CONFIRMED' | 'INVALIDATED' | 'TARGET_REACHED' | 'NEUTRAL'
  let currentSetup    = null;   // { type, direction, name, trigger, target, stop, rationale, oiDeltaPct }
  let userOverridden  = false;

  // Akış Günlüğü (Son 40 olay)
  const logHistory    = [];

  // Sesli Anlatım Motoru
  let speechEnabled   = true;
  let lastSpokenText  = '';
  let lastSpokenTime  = 0;

  // Ses efekti için Web Audio context
  let audioCtx = null;

  function init() {
    _initDomEvents();
    _listenEvents();
  }

  // ─── DOM Etkinlikleri ─────────────────────────────────────────
  function _initDomEvents() {
    // Ses toggle butonu
    const voiceBtn = document.getElementById('verdict-voice-toggle');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', () => {
        speechEnabled = !speechEnabled;
        voiceBtn.classList.toggle('active', speechEnabled);
        const icon = voiceBtn.querySelector('.icon');
        const lbl  = voiceBtn.querySelector('.lbl');
        if (icon) icon.textContent = speechEnabled ? '🔊' : '🔇';
        if (lbl)  lbl.textContent  = speechEnabled ? 'Sesli' : 'Sessiz';
        if (speechEnabled) {
          _speak('Sesli anlatım aktif edildi.');
        }
      });
    }

    // Akış (Feed) toggle butonu
    const feedBtn   = document.getElementById('verdict-feed-toggle');
    const drawer    = document.getElementById('verdict-feed-drawer');
    const closeBtn  = document.getElementById('feed-close-btn');

    if (feedBtn && drawer) {
      feedBtn.addEventListener('click', () => {
        drawer.classList.toggle('hidden');
        _renderFeed();
      });
    }
    if (closeBtn && drawer) {
      closeBtn.addEventListener('click', () => {
        drawer.classList.add('hidden');
      });
    }

    // Manuel Seviye Güncelleme / Takibe Al Butonu
    const updateBtn = document.getElementById('tac-update-btn');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => {
        const trigVal  = parseFloat(document.getElementById('tac-trigger-input')?.value);
        const targVal  = parseFloat(document.getElementById('tac-target-input')?.value);
        const stopVal  = parseFloat(document.getElementById('tac-stop-input')?.value);
        const entryVal = parseFloat(document.getElementById('btb-entry-input')?.value);

        if (!isNaN(trigVal) && !isNaN(targVal) && !isNaN(stopVal)) {
          userOverridden = true;
          const direction = targVal < trigVal ? 'SHORT' : 'LONG';
          if (!currentSetup) {
            currentSetup = {
              type: 'MANUAL',
              direction,
              name: 'MANUEL STRATEJİ',
              trigger: trigVal,
              target: targVal,
              stop: stopVal,
              rationale: 'Kullanıcı tanımlı seviyeler',
            };
          } else {
            currentSetup.direction = direction;
            currentSetup.trigger   = trigVal;
            currentSetup.target    = targVal;
            currentSetup.stop      = stopVal;
          }

          if (currentSymbol) {
            try {
              localStorage.setItem('alpha_levels_' + currentSymbol, JSON.stringify({
                trigger: trigVal, target: targVal, stop: stopVal, direction
              }));
            } catch(e){}
          }

          tacticalState = 'WATCHING';
          EventBus.emit('tactical:levels', {
            entry: !isNaN(entryVal) ? entryVal : undefined,
            trigger: trigVal,
            target: targVal,
            stop: stopVal
          });

          // Buton animasyonu & anında görsel teyit
          updateBtn.classList.add('saved');
          updateBtn.innerHTML = '✅ Kaydedildi!';
          setTimeout(() => {
            updateBtn.classList.remove('saved');
            updateBtn.innerHTML = '🎯 Takibe Al';
          }, 2000);

          // Inputları yeşil parlat
          ['tac-trigger-input', 'tac-target-input', 'tac-stop-input'].forEach(id => {
            const el = document.getElementById(id);
            if (el) {
              el.classList.add('input-saved');
              setTimeout(() => el.classList.remove('input-saved'), 1500);
            }
          });

          _setVerdict('bull', '🎯', 'SEVİYELER TAKİBE ALINDI',
            `Yön: <strong>${direction}</strong> | Tetik: <strong>${trigVal}</strong> | Hedef: <strong>${targVal}</strong> | Stop: <strong>${stopVal}</strong>. Seviyeler aktif.`
          );

          _addLog('bull', '🎯', 'SEVİYELER GÜNCELLENDİ',
            `Yön: ${direction} | Tetik: ${trigVal} | Hedef: ${targVal} | Stop: ${stopVal} takibe alındı.`
          );
          _speak(`Yeni seviyeler kaydedildi. ${direction} yönünde ${trigVal} seviyesi izleniyor.`);

          if (curPrice) _updateTelemetry(curPrice);
        }
      });
    }
  }

  // ─── EventBus Dinleyicileri ──────────────────────────────────
  function _listenEvents() {
    EventBus.on('coin:change', ({ symbol, interval }) => {
      currentSymbol   = symbol;
      currentInterval = interval || currentInterval;
      tacticalState   = 'IDLE';
      currentSetup    = null;
      userOverridden  = false;
      curPrice        = null;
      lastBreakoutWarnState = null;
      _clearTelemetry();

      // Kayıtlı seviyeleri geri yükle veya temizle
      let restored = false;
      try {
        const saved = localStorage.getItem('alpha_levels_' + symbol);
        if (saved) {
          const l = JSON.parse(saved);
          if (l && typeof l === 'object' && Number.isFinite(Number(l.trigger))) {
            const trigger = Number(l.trigger);
            const target  = Number.isFinite(Number(l.target)) ? Number(l.target) : null;
            const stop    = Number.isFinite(Number(l.stop)) ? Number(l.stop) : null;
            const dir     = (l.direction === 'SHORT' || (target !== null && target < trigger)) ? 'SHORT' : 'LONG';
            currentSetup = {
              type: 'SAVED',
              direction: dir,
              name: 'KAYITLI STRATEJİ',
              trigger, target, stop,
              rationale: 'Kullanıcının kaydettiği seviyeler'
            };
            _fillInputValues(trigger, target, stop, true);
            userOverridden = true;
            EventBus.emit('tactical:levels', { trigger, target, stop });
            restored = true;
          }
        }
      } catch(e){}

      if (!restored) {
        if (symbol === 'SYNUSDT') {
          _fillInputValues(0.2250, 0.2610, 0.2120);
        } else {
          _fillInputValues('', '', '');
        }
      }

      _setVerdict('neutral', '🔍', 'GÖZLEM BAŞLATILIYOR',
        `${symbol} seçildi. Vadeli veriler, balina pozisyonları ve kline seviyeleri taranıyor...`
      );
      _addLog('neutral', '🔍', `${symbol} SEÇİLDİ`, 'Analiz ve seviye hesaplamaları başlatıldı.');
    });

    EventBus.on('chart:klines', ({ symbol, klines }) => {
      if (symbol !== currentSymbol) return;
      if (!userOverridden) {
        _autoDetectLevels(klines);
      }
    });

    EventBus.on('smartmoney:data', (sm) => {
      _evaluateSmartMoney(sm);
    });

    // Anlık fiyat güncellemeleri (Hem ticker hem kline)
    EventBus.on('ws:ticker', (t) => {
      if (!t || !t.symbol) return;
      if (currentSymbol && t.symbol.toUpperCase() !== currentSymbol) return;
      curPrice = t.lastPrice;
      _evaluateLivePrice(curPrice);
      _updateTelemetry(curPrice);
    });

    EventBus.on('ws:kline', ({ symbol, kline }) => {
      if (symbol.toUpperCase() !== currentSymbol) return;
      curPrice = kline.close;
      _evaluateLivePrice(curPrice);
      _updateTelemetry(curPrice);
    });
  }

  // ─── Otomatik Seviye Tespiti (Pivots & Key Levels) ───────────
  function _autoDetectLevels(klines) {
    if (!klines || klines.length < 20) return;

    // Son 30 mumun yerel tepe ve dipleri
    const recent = klines.slice(-35);
    let highestHigh = -Infinity;
    let lowestLow   = Infinity;

    recent.forEach(k => {
      if (k.high > highestHigh) highestHigh = k.high;
      if (k.low  < lowestLow)   lowestLow   = k.low;
    });

    const lastClose = klines[klines.length - 1].close;
    curPrice = lastClose;

    // SYNUSDT için özel hassasiyet (Kullanıcının talep ettiği 0.2250 tetik ve 0.26100 hedef)
    let trigger, target, stop;

    if (currentSymbol === 'SYNUSDT') {
      trigger = 0.2250;
      target  = 0.26100;
      stop    = 0.2120;
    } else {
      // Genel otomatik hesaplama
      trigger = parseFloat(highestHigh.toFixed(highestHigh < 1 ? 4 : 2));
      stop    = parseFloat(lowestLow.toFixed(lowestLow < 1 ? 4 : 2));
      const range = trigger - stop;
      target  = parseFloat((trigger + range * 1.8).toFixed(trigger < 1 ? 4 : 2));
    }

    if (!currentSetup) {
      currentSetup = {
        type: 'AUTO_DETECT',
        direction: 'LONG',
        name: 'DİRENÇ & SHORT SQUEEZE İZLEME',
        trigger,
        target,
        stop,
        rationale: 'Son periyot swing tepe ve taban seviyeleri',
      };
    } else {
      currentSetup.trigger = trigger;
      currentSetup.target  = target;
      currentSetup.stop    = stop;
    }

    _fillInputValues(trigger, target, stop);
    EventBus.emit('tactical:levels', { trigger, target, stop });
    if (curPrice) _updateTelemetry(curPrice);
  }

  function _fillInputValues(trigger, target, stop, force = false) {
    const trigEl = document.getElementById('tac-trigger-input');
    const targEl = document.getElementById('tac-target-input');
    const stopEl = document.getElementById('tac-stop-input');
    if (trigEl && (!userOverridden || force)) trigEl.value = trigger ?? '';
    if (targEl && (!userOverridden || force)) targEl.value = target ?? '';
    if (stopEl && (!userOverridden || force)) stopEl.value = stop ?? '';
  }

  function _clearTelemetry() {
    ['tele-trigger', 'tele-stop', 'tele-target', 'tele-rr'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = '—';
    });
  }

  // ─── Smart Money Değerlendirme ───────────────────────────────
  function _evaluateSmartMoney(sm) {
    if (!sm) return;

    const posRatio    = sm.posRatio   ? parseFloat(sm.posRatio.longShortRatio)    : null;
    const globalRatio = sm.globalLS   ? parseFloat(sm.globalLS.longShortRatio)    : null;
    const takerRatio  = sm.takerRatio ? parseFloat(sm.takerRatio.buySellRatio)    : null;
    const fundingPct  = sm.funding    ? parseFloat(sm.funding.lastFundingRate)*100: null;

    // OI Delta (son kayıtlardan)
    let oiDeltaPct = null;
    if (sm.oiHist && Array.isArray(sm.oiHist) && sm.oiHist.length >= 2) {
      const cur = parseFloat(sm.oiHist[sm.oiHist.length - 1].sumOpenInterest);
      const old = parseFloat(sm.oiHist[0].sumOpenInterest);
      if (old > 0 && Number.isFinite(old) && Number.isFinite(cur)) {
        oiDeltaPct = ((cur - old) / old) * 100;
      }
    }

    if (currentSetup) {
      currentSetup.oiDeltaPct = oiDeltaPct;
    }

    // Eğer teyit aşamasındaysak ve ani balina çıkışı/dağıtımı başladıysa kullanıcıyı uyar (H09 / D04)
    if (tacticalState === 'CONFIRMED') {
      const adverseWhales = (posRatio !== null && posRatio < 1.05);
      const adverseOi     = (oiDeltaPct !== null && oiDeltaPct < -4);
      if (adverseWhales || adverseOi) {
        _setVerdict('warn', '⚠️', 'TEYİT SONRASI ZAYIFLAMA / PARA ÇIKIŞI',
          `Dikkat! Teyit sonrasında ${adverseWhales ? `balinalar pozisyon kapatıyor (${posRatio.toFixed(2)}) ` : ''}` +
          `${adverseOi ? `ve OI eriyor (%${oiDeltaPct.toFixed(1)}). ` : ''}Kurulum zayıflıyor, kâr realizasyonunu veya stopu gözden geçirin!`
        );
        _addLog('warn', '⚠️', 'TEYİT SONRASI ZAYIFLAMA',
          `Balinalar pozisyon kapatıyor, OI ${oiDeltaPct !== null ? `%${oiDeltaPct.toFixed(1)} düştü.` : 'zayıf.'}`
        );
      }
      return;
    }
    if (tacticalState === 'TARGET_REACHED' || tacticalState === 'INVALIDATED') {
      return;
    }

    // ── Senaryo 1: Short Squeeze Kurulumu (GÜÇLÜ BOĞA) ────────────
    // Balinalar Long ağırlıklı (>1.35) ve Perakende Short terste (<0.85)
    if (posRatio !== null && posRatio > 1.35 && globalRatio !== null && globalRatio < 0.90) {
      const isSyn = (currentSymbol === 'SYNUSDT');
      if (!currentSetup) {
        currentSetup = {
          type: 'SHORT_SQUEEZE',
          direction: 'LONG',
          name: 'SHORT SQUEEZE POTANSİYELİ',
          trigger: isSyn ? 0.2250 : null,
          target:  isSyn ? 0.26100 : null,
          stop:    isSyn ? 0.2120 : null,
          rationale: `Balina Long (${posRatio.toFixed(2)}) vs Perakende Short (${globalRatio.toFixed(2)}) uyuşmazlığı.`,
          oiDeltaPct
        };
        tacticalState = 'WATCHING';
      } else if (!userOverridden) {
        currentSetup.type = 'SHORT_SQUEEZE';
        currentSetup.direction = 'LONG';
        currentSetup.name = 'SHORT SQUEEZE POTANSİYELİ';
        currentSetup.oiDeltaPct = oiDeltaPct;
        tacticalState = 'WATCHING';
      }

      const triggerText = currentSetup.trigger ? `<strong>${currentSetup.trigger}</strong>` : 'Direnç';
      const targetText  = currentSetup.target  ? ` Hedef: ${currentSetup.target}.` : '';

      _setVerdict('bull', '🟢', 'SHORT SQUEEZE KURULUMU (İZLENİYOR)',
        `Balinalar Long biriktiriyor (${posRatio.toFixed(2)}), perakende Short'ta (${globalRatio.toFixed(2)}). ` +
        `${triggerText} kırılımı ve OI sıçramasıyla teyit bekleniyor.${targetText}`
      );
      return;
    }

    // ── Senaryo 2: Dip Toplama / Akümülasyon ──────────────────────
    if (takerRatio !== null && takerRatio > 1.15 && posRatio !== null && posRatio > 1.10) {
      if (tacticalState !== 'WATCHING') {
        tacticalState = 'WATCHING';
        _setVerdict('bull', '💎', 'DİP TOPLAMA & ALICI BASKISI',
          `Taker alıcılar agresif (${takerRatio.toFixed(2)}), balinalar Long yönlü. ` +
          `Direnç kırılımı bekleniyor.`
        );
      }
      return;
    }

    // ── Senaryo 3: Dağıtım / Kaçış (AYI) ─────────────────────────
    if (posRatio !== null && posRatio < 1.05 && oiDeltaPct !== null && oiDeltaPct < -4) {
      tacticalState = 'WATCHING';
      _setVerdict('bear', '🔴', 'DAĞITIM / PARA ÇIKIŞI TESPİTİ',
        `Balinalar pozisyon kapatıyor (${posRatio.toFixed(2)}), OI eriyor (%${oiDeltaPct.toFixed(1)}). ` +
        `Destek kırılırsa sert düşüş başlayabilir. Long açmayın!`
      );
      return;
    }

    // ── Varsayılan ───────────────────────────────────────────────
    if (tacticalState === 'IDLE' || tacticalState === 'NEUTRAL') {
      tacticalState = 'WATCHING';
      _setVerdict('neutral', '📊', 'PİYASA GÖZLEM ALTINDA',
        `Balina: ${posRatio?.toFixed(2) ?? '—'} | Perakende: ${globalRatio?.toFixed(2) ?? '—'} | ` +
        `Direnç ve OI ivmesi takip ediliyor.`
      );
    }
  }

  // ─── Canlı Fiyat Kontrolü (WebSocket Tetikleyici) ─────────────
  let lastBreakoutWarnState = null;

  function _evaluateLivePrice(price) {
    if (!price || !currentSetup || !currentSetup.trigger) return;

    const trigger   = currentSetup.trigger;
    const target    = currentSetup.target;
    const stop      = currentSetup.stop;
    const isShort   = currentSetup.direction === 'SHORT';
    const oiDelta   = (currentSetup.oiDeltaPct !== undefined && currentSetup.oiDeltaPct !== null && Number.isFinite(currentSetup.oiDeltaPct))
      ? currentSetup.oiDeltaPct
      : null;

    // 1. TEYİT VEYA KIRILIM ANI:
    // LONG için fiyat >= trigger, SHORT için fiyat <= trigger
    const triggerCrossed = isShort ? (price <= trigger) : (price >= trigger);

    if (tacticalState === 'WATCHING' && triggerCrossed) {
      // D03: OI henüz bilinmiyorsa (null) TEYİT VERME!
      if (oiDelta === null) {
        const warnKey = `no_oi_${currentSymbol}_${trigger}`;
        _setVerdict('warn', '⏳', 'SEVİYE AŞILDI (OI VERİSİ BEKLENİYOR)',
          `Fiyat <strong>${price.toFixed(4)}</strong> ile <strong>${trigger}</strong> seviyesini aştı ancak Açık Pozisyon (OI) teyit verisi henüz gelmedi. Teyit için OI artışı bekleniyor.`
        );
        if (lastBreakoutWarnState !== warnKey) {
          lastBreakoutWarnState = warnKey;
          _addLog('warn', '⏳', 'SEVİYE AŞILDI (OI BEKLENİYOR)',
            `Fiyat ${price.toFixed(4)} ile ${trigger} seviyesini geçti. OI verisi henüz gelmedi.`
          );
        }
        return;
      }

      // H02 / D03: OI düşerken veya değişmemişken teyit üretme!
      if (oiDelta <= 0) {
        const isZero = (oiDelta === 0);
        const warnKey = `oi_drop_${currentSymbol}_${trigger}_${isZero}`;
        _setVerdict('warn', '⚠️', isZero ? 'ŞÜPHELİ KIRILIM (OI DEĞİŞMEDİ)' : 'ŞÜPHELİ KIRILIM (OI DÜŞÜYOR)',
          `Fiyat <strong>${price.toFixed(4)}</strong> ile <strong>${trigger}</strong> seviyesini aştı ancak Açık Pozisyonlar (${isZero ? 'OI değişmedi' : `OI: %${oiDelta.toFixed(1)} düştü`})! Hacim ve OI teyidi yok, tuzak riski yüksek.`
        );
        if (lastBreakoutWarnState !== warnKey) {
          lastBreakoutWarnState = warnKey;
          _addLog('warn', '⚠️', 'ŞÜPHELİ KIRILIM',
            `Fiyat ${price.toFixed(4)} ile ${trigger} seviyesini geçti fakat OI (${isZero ? 'değişmedi' : `%${oiDelta.toFixed(1)} düşüşte`}). Teyitsiz.`
          );
        }
        return;
      }

      tacticalState = 'CONFIRMED';
      lastBreakoutWarnState = null;
      _playChime(true);

      const oiText = ` Açık pozisyonlarda (+%${oiDelta.toFixed(1)}) artışla teyit alındı.`;
      const actionTitle = isShort ? 'DÜŞÜŞ KIRILIMI TETİKLENDİ' : 'SHORT SQUEEZE TETİKLENDİ';

      _setVerdict('bull-flash', '🚨', `TEYİT GELDİ: ${actionTitle}!`,
        `Fiyat <strong>${price.toFixed(4)}</strong> seviyesine ulaşarak <strong>${trigger}</strong> seviyesini kırdı!${oiText} ` +
        `<strong>Hedef: ${target}</strong>, Stop: ${stop}.`
      );

      _speak(`Dikkat! ${currentSymbol} teyit verdi! Fiyat ${trigger} seviyesini kırdı. Hedef ${target}!`);

      _addLog('bull', '🟢', 'TEYİT GELDİ!',
        `Fiyat ${price.toFixed(4)} ile ${trigger} seviyesini kırdı. Hedef: ${target}.`
      );
      return;
    }

    // 2. STOP / İPTAL ANI:
    // LONG için stop desteği altı (price <= stop), SHORT için stop direnci üstü (price >= stop)
    const stopBreached = stop ? (isShort ? (price >= stop) : (price <= stop)) : false;

    if ((tacticalState === 'WATCHING' || tacticalState === 'CONFIRMED') && stopBreached) {
      tacticalState = 'INVALIDATED';

      _playChime(false);
      const levelName = isShort ? 'stop direncinin' : 'stop desteğinin';
      _setVerdict('bear', '⚠️', 'İPTAL / STOP SEVİYESİ AŞILDI!',
        `Fiyat <strong>${price.toFixed(4)}</strong> ile <strong>${stop}</strong> ${levelName} ötesine geçti. ` +
        `Kurulum iptal edildi!`
      );

      _speak(`Dikkat! ${currentSymbol} stop seviyesini aştı, kurulum iptal!`);

      _addLog('bear', '🔴', 'İPTAL / STOP',
        `Fiyat ${price.toFixed(4)} seviyesine ulaşarak ${stop} stop seviyesini kırdı.`
      );
      return;
    }

    // 3. HEDEFE ULAŞILDI:
    // LONG için price >= target, SHORT için price <= target
    const targetReached = target ? (isShort ? (price <= target) : (price >= target)) : false;

    if (tacticalState === 'CONFIRMED' && targetReached) {
      tacticalState = 'TARGET_REACHED';

      _playChime(true);
      _setVerdict('gold', '🎯', 'HEDEFE ULAŞILDI! KÂR ALIN!',
        `Tebrikler! Fiyat <strong>${target}</strong> ana hedefine ulaştı! Kâr realizasyonu yapıp pozisyonu kapatın.`
      );

      _speak(`Tebrikler! ${currentSymbol} ${target} ana hedefine ulaştı!`);

      _addLog('gold', '🎯', 'HEDEFE ULAŞILDI',
        `Fiyat ${price.toFixed(4)} ile ${target} hedefine tam isabet vurdu!`
      );
    }
  }

  // ─── Canlı Mesafe & Hedef Telemetrisi ────────────────────────
  function _updateTelemetry(price) {
    if (!price || !currentSetup || !currentSetup.trigger) return;

    const trigEl = document.getElementById('tele-trigger');
    const stopEl = document.getElementById('tele-stop');
    const targEl = document.getElementById('tele-target');
    const rrEl   = document.getElementById('tele-rr');

    const trigger = currentSetup.trigger;
    const target  = currentSetup.target;
    const stop    = currentSetup.stop;
    const isShort = currentSetup.direction === 'SHORT';

    // 1. Tetiğe Mesafe (Canlı Sayaç)
    if (trigEl) {
      if (!isShort) {
        if (price < trigger) {
          const diffPct = ((trigger - price) / price) * 100;
          const diffVal = trigger - price;
          trigEl.innerHTML = `🎯 Tetiğe: <strong>+${diffPct.toFixed(2)}%</strong> (${diffVal < 1 ? diffVal.toFixed(4) : diffVal.toFixed(2)})`;
          trigEl.className = `tele-item trigger ${diffPct < 1.0 ? 'near-trigger' : ''}`;
        } else {
          const excess = ((price - trigger) / trigger) * 100;
          trigEl.innerHTML = `🔥 TEYİT ALINDI! (<strong>+${excess.toFixed(2)}%</strong>)`;
          trigEl.className = 'tele-item trigger confirmed';
        }
      } else {
        if (price > trigger) {
          const diffPct = ((price - trigger) / price) * 100;
          const diffVal = price - trigger;
          trigEl.innerHTML = `🎯 Tetiğe: <strong>-${diffPct.toFixed(2)}%</strong> (${diffVal < 1 ? diffVal.toFixed(4) : diffVal.toFixed(2)})`;
          trigEl.className = `tele-item trigger ${diffPct < 1.0 ? 'near-trigger' : ''}`;
        } else {
          const excess = ((trigger - price) / trigger) * 100;
          trigEl.innerHTML = `🔥 TEYİT ALINDI! (<strong>-${excess.toFixed(2)}%</strong>)`;
          trigEl.className = 'tele-item trigger confirmed';
        }
      }
    }

    // 2. Stop Güvenlik Payı
    if (stopEl && stop) {
      if (!isShort) {
        const stopMarginPct = ((price - stop) / price) * 100;
        if (price > stop) {
          stopEl.innerHTML = `🛑 Stop Payı: <strong>-%${stopMarginPct.toFixed(2)}</strong> (Güvenli)`;
          stopEl.className = `tele-item stop ${stopMarginPct < 1.5 ? 'near-stop' : ''}`;
        } else {
          stopEl.innerHTML = `⚠️ STOP DESTEĞİ KIRILDI!`;
          stopEl.className = 'tele-item stop breached';
        }
      } else {
        const stopMarginPct = ((stop - price) / price) * 100;
        if (price < stop) {
          stopEl.innerHTML = `🛑 Stop Payı: <strong>+%${stopMarginPct.toFixed(2)}</strong> (Güvenli)`;
          stopEl.className = `tele-item stop ${stopMarginPct < 1.5 ? 'near-stop' : ''}`;
        } else {
          stopEl.innerHTML = `⚠️ STOP DİRENCİ AŞILDI!`;
          stopEl.className = 'tele-item stop breached';
        }
      }
    }

    // 3. Hedefe Potansiyel
    if (targEl && target) {
      if (!isShort) {
        const targPct = ((target - price) / price) * 100;
        targEl.innerHTML = `🏆 Hedef Kârı: <strong>+${targPct.toFixed(2)}%</strong>`;
      } else {
        const targPct = ((price - target) / price) * 100;
        targEl.innerHTML = `🏆 Hedef Kârı: <strong>+${targPct.toFixed(2)}%</strong>`;
      }
    }

    // 4. Risk / Ödül
    if (rrEl && target && trigger && stop) {
      let reward = 0, risk = 0;
      if (!isShort && trigger > stop && target > trigger) {
        reward = target - trigger;
        risk   = trigger - stop;
      } else if (isShort && stop > trigger && trigger > target) {
        reward = trigger - target;
        risk   = stop - trigger;
      }
      if (risk > 0) {
        const rr = reward / risk;
        rrEl.innerHTML = `⚖️ R:R = 1 : <strong>${rr.toFixed(1)}</strong>`;
      }
    }
  }

  // ─── UI Güncelleme Yardımcıları ──────────────────────────────
  function _setVerdict(type, icon, title, htmlText) {
    const panel   = document.getElementById('verdict-panel');
    const iconEl  = document.getElementById('verdict-icon');
    const badgeEl = document.getElementById('verdict-badge');
    const textEl  = document.getElementById('verdict-text');
    if (!panel) return;

    panel.className = type;
    if (iconEl)  iconEl.textContent = icon;
    if (badgeEl) {
      badgeEl.className   = `verdict-badge ${type}`;
      badgeEl.textContent = title;
    }
    if (textEl) {
      textEl.innerHTML = htmlText;
    }
  }

  function _updateUI() {
    if (currentSetup) {
      _fillInputValues(currentSetup.trigger, currentSetup.target, currentSetup.stop);
    }
  }

  // ─── Akış Günlüğü (Feed) ──────────────────────────────────────
  function _addLog(type, icon, title, text) {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;

    logHistory.unshift({
      time: timeStr,
      type,
      icon,
      title,
      text,
      symbol: currentSymbol
    });

    if (logHistory.length > 40) logHistory.pop();

    const countEl = document.getElementById('feed-count');
    if (countEl) countEl.textContent = logHistory.length;

    _renderFeed();
  }

  function _renderFeed() {
    const listEl = document.getElementById('feed-list');
    if (!listEl) return;

    if (!logHistory.length) {
      listEl.innerHTML = '<div class="feed-empty">Henüz kaydedilmiş olay yok. Coin değişimleri ve teyitler burada listelenir.</div>';
      return;
    }

    listEl.innerHTML = logHistory.map(item => `
      <div class="feed-item ${item.type}">
        <div class="feed-item-header">
          <span class="feed-item-icon">${item.icon}</span>
          <span class="feed-item-title">${item.title}</span>
          <span class="feed-item-time">${item.time}</span>
        </div>
        <div class="feed-item-body">${item.text}</div>
      </div>
    `).join('');
  }

  // ─── Türkçe Sesli Spiker Motoru (Web Speech API) ─────────────
  function _speak(text) {
    if (!speechEnabled) return;
    if (!('speechSynthesis' in window)) return;

    // Aynı metni 10 saniye içinde tekrar söyleme
    const now = Date.now();
    if (text === lastSpokenText && now - lastSpokenTime < 10000) return;
    lastSpokenText = text;
    lastSpokenTime = now;

    window.speechSynthesis.cancel(); // Önceki cümleyi kes

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang  = 'tr-TR';
    utterance.rate  = 1.05;
    utterance.pitch = 1.0;

    // Türkçe ses tercihi
    const voices = window.speechSynthesis.getVoices();
    const trVoice = voices.find(v => v.lang.startsWith('tr'));
    if (trVoice) utterance.voice = trVoice;

    window.speechSynthesis.speak(utterance);
  }

  // ─── Yüksek Teknolojili Ses Efekti (Web Audio API) ───────────
  function _playChime(isPositive = true) {
    if (!speechEnabled) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';

      const now = audioCtx.currentTime;
      if (isPositive) {
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.exponentialRampToValueAtTime(880.00, now + 0.15); // A5
      } else {
        osc.frequency.setValueAtTime(659.25, now); // E5
        osc.frequency.exponentialRampToValueAtTime(329.63, now + 0.20); // E4
      }

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.35);
    } catch (e) {
      // Audio izinleri engellenmişse sessizce geç
    }
  }

  return { init };
})();
