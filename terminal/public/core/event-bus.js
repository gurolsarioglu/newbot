/**
 * EventBus — Mikro Mimari İletişim Katmanı
 * Her plugin bu bus üzerinden veri yayar ve dinler.
 * Bir plugin çökerse diğerlerini etkilemez.
 */
const EventBus = (() => {
  const listeners = {};

  function on(event, callback) {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(callback);
  }

  function off(event, callback) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(cb => cb !== callback);
  }

  function emit(event, data) {
    if (!listeners[event]) return;
    listeners[event].forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`[EventBus] "${event}" handler error:`, err);
      }
    });
  }

  function once(event, callback) {
    const wrapper = (data) => {
      callback(data);
      off(event, wrapper);
    };
    on(event, wrapper);
  }

  return { on, off, emit, once };
})();
