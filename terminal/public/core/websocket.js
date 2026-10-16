/**
 * WebSocketManager — Binance Futures Canlı Piyasa & Kline Akışı
 * 
 * Binance USD-M Futures güncel mimarisi:
 * wss://fstream.binance.com/market/stream?streams=<symbol>@kline_<interval>/<symbol>@ticker
 * Bu sayede hem mumlar (kline) hem de anlık fiyat (24hr ticker) kesintisiz akar.
 */
const WebSocketManager = (() => {
  let ws = null;
  let currentSymbol = null;
  let currentInterval = null;
  let reconnectTimer = null;
  let pingInterval = null;
  let generation = 0;

  const BASE_WS = 'wss://fstream.binance.com/market/stream';

  function connect(symbol, interval) {
    const myGen = ++generation;

    clearTimeout(reconnectTimer);
    clearInterval(pingInterval);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      ws = null;
    }

    currentSymbol   = symbol.toLowerCase();
    currentInterval = interval;

    const streams = `${currentSymbol}@kline_1m/${currentSymbol}@kline_5m/${currentSymbol}@kline_1h/${currentSymbol}@kline_1d/${currentSymbol}@ticker/${currentSymbol}@aggTrade/${currentSymbol}@forceOrder`;
    const fullUrl = `${BASE_WS}?streams=${streams}`;

    try {
      ws = new WebSocket(fullUrl);
    } catch (e) {
      console.error('[WS] Bağlantı kurulamadı:', e);
      return;
    }

    ws.onopen = () => {
      if (myGen !== generation) { ws.close(); return; }
      console.log(`[WS] Bağlandı: ${streams}`);
      EventBus.emit('ws:status', 'connected');
      // Market stream uses native websocket transport pings; no JSON ping needed.
    };

    ws.onmessage = (event) => {
      if (myGen !== generation) return;
      try {
        const raw = JSON.parse(event.data);
        if (raw.pong || raw.result !== undefined) return;
        const msg = raw.data || raw;

        // 1. Kline Verisi
        if (msg.e === 'kline') {
          const k = msg.k;
          EventBus.emit('ws:kline', {
            symbol:   k.s,
            interval: k.i,
            kline: {
              openTime: k.t,
              open:     parseFloat(k.o),
              high:     parseFloat(k.h),
              low:      parseFloat(k.l),
              close:    parseFloat(k.c),
              volume:   parseFloat(k.v),
              isClosed: k.x,
            }
          });
        }
        // 2. Anlık Ticker Fiyat Verisi (Her işlemde akar)
        else if (msg.e === '24hrTicker') {
          EventBus.emit('ws:ticker', {
            symbol:             msg.s,
            lastPrice:          parseFloat(msg.c),
            priceChangePercent: parseFloat(msg.P),
            highPrice:          parseFloat(msg.h),
            lowPrice:           parseFloat(msg.l),
            volume:             parseFloat(msg.v),
            quoteVolume:        parseFloat(msg.q),
          });
        }
        // 3. Anlık Piyasa İşlemi (AggTrade - Balina & Flow Takibi)
        else if (msg.e === 'aggTrade') {
          const price = parseFloat(msg.p);
          const qty   = parseFloat(msg.q);
          const val   = price * qty;
          EventBus.emit('ws:aggTrade', {
            symbol:       msg.s,
            price,
            qty,
            val,
            isBuyerMaker: msg.m, // true = Taker Sell, false = Taker Buy
            time:         msg.T,
          });
        }
        // 4. Anlık Likidasyon (ForceOrder)
        else if (msg.e === 'forceOrder') {
          const o = msg.o;
          if (o) {
            const price = parseFloat(o.ap || o.p);
            const qty   = parseFloat(o.q);
            const val   = price * qty;
            EventBus.emit('ws:liquidation', {
              symbol: o.s,
              side:   o.S, // 'BUY' = Short patladı, 'SELL' = Long patladı
              price,
              qty,
              val,
              time:   o.T,
            });
          }
        }
      } catch (err) {
        // parse hatası
      }
    };

    ws.onclose = (event) => {
      if (myGen !== generation) return;
      clearInterval(pingInterval);
      EventBus.emit('ws:status', 'disconnected');
      console.warn(`[WS] Kapandı (${event.code}), 2sn sonra yeniden bağlanılıyor...`);
      EventBus.emit('ws:status', 'reconnecting');
      reconnectTimer = setTimeout(() => {
        if (myGen === generation) connect(symbol, interval);
      }, 2000);
    };

    ws.onerror = (e) => {
      if (myGen !== generation) return;
      console.error('[WS] Bağlantı hatası:', e);
    };
  }

  function disconnect() {
    generation++;
    clearTimeout(reconnectTimer);
    clearInterval(pingInterval);
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      ws.close();
      ws = null;
    }
    EventBus.emit('ws:status', 'disconnected');
  }

  function switchTo(symbol, interval) {
    if (currentSymbol === symbol.toLowerCase() && currentInterval === interval && ws && ws.readyState === WebSocket.OPEN) return;
    connect(symbol, interval);
  }

  return { connect, disconnect, switchTo };
})();
