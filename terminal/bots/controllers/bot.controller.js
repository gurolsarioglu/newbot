/**
 * bot.controller.js — Bot MVC Controller Katmanı
 * HTTP isteklerini işler, BotManager ve SignalStoreService üzerinden yanıt döner.
 */

const botManager = require('../index');
const signalStoreService = require('../../services/signal-store.service');

class BotController {
  /**
   * GET /api/signals?bot=...
   */
  getSignals(req, res) {
    try {
      const requestedBotId = req.query.bot || 'hammerproplus';
      const bot = botManager.getBot(requestedBotId);

      return res.json({
        bot: bot.name,
        count: bot.getCount(),
        signals: bot.getSignals()
      });
    } catch (err) {
      console.error('[BotController.getSignals] Hata:', err.message);
      return res.status(500).json({ error: 'Sinyaller alinamadi' });
    }
  }

  /**
   * GET /api/signals/coin-history?symbol=SUIUSDT&days=60
   * Belirli bir coin'in son 60 günlük tüm bot sinyallerini döner.
   */
  getCoinHistory(req, res) {
    try {
      const symbol = (req.query.symbol || req.query.coin || '').toUpperCase().trim();
      if (!symbol) {
        return res.status(400).json({ error: 'symbol parametresi zorunludur (örn: ?symbol=SUIUSDT)' });
      }

      const days = parseInt(req.query.days || 60, 10);
      const signals = signalStoreService.getSignalsByCoin(symbol, days);
      const stats = signalStoreService.getStatsByCoin(symbol, days);

      return res.json({
        symbol,
        days,
        count: signals.length,
        stats,
        signals
      });
    } catch (err) {
      console.error('[BotController.getCoinHistory] Hata:', err.message);
      return res.status(500).json({ error: 'Gecmis sinyaller alinamadi' });
    }
  }

  /**
   * POST /api/signals/emit
   * Harici veya yerel botlardan gelen sinyalleri işler
   */
  emitSignal(req, res) {
    try {
      const signalData = req.body;
      if (!signalData || (!signalData.coin && !signalData.symbol)) {
        return res.status(400).json({ error: 'Gecersiz sinyal verisi' });
      }

      const result = botManager.emitSignal(signalData);
      console.log(`[Signal Ingest] ✅ Yeni sinyal eklendi: #${result.symbol} -> [${result.affectedBots.join(', ')}] [${result.time}]`);
      
      return res.json({
        success: true,
        symbol: result.symbol,
        affectedBots: result.affectedBots,
        time: result.time
      });
    } catch (err) {
      console.error('[BotController.emitSignal] Hata:', err.message);
      return res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new BotController();
