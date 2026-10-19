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
      if (!bot) return res.status(404).json({ error: 'Bot bulunamadi' });

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
      const rawSymbol = req.query.symbol || req.query.coin || '';
      const symbol = typeof rawSymbol === 'string' ? rawSymbol.toUpperCase().trim() : '';
      if (!/^[A-Z0-9]{1,30}USDT$/.test(symbol)) {
        return res.status(400).json({ error: 'symbol parametresi zorunludur (örn: ?symbol=SUIUSDT)' });
      }

      const days = req.query.days === undefined ? 60 : Number(req.query.days);
      if (!Number.isInteger(days) || days < 1 || days > 60) {
        return res.status(400).json({ error: 'days 1 ile 60 arasinda tam sayi olmalidir' });
      }
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
      if (!signalData || typeof signalData !== 'object' || Array.isArray(signalData) || typeof (signalData.symbol || signalData.coin) !== 'string') {
        return res.status(400).json({ error: 'Gecersiz sinyal verisi' });
      }
      if (!/^[A-Z0-9_]+USDT$/.test((signalData.symbol || signalData.coin).trim().toUpperCase())) {
        return res.status(400).json({ error: 'Gecersiz sembol' });
      }
      if (!botManager.getBot(signalData.botId || signalData.botType)) {
        return res.status(400).json({ error: 'Bilinmeyen bot' });
      }

      const result = botManager.emitSignal(signalData);
      if (!result.affectedBots.length) {
        return res.status(422).json({ success: false, rejected: true, ...result, message: 'Sinyal strateji kosullarini saglamadi veya daha once kaydedildi' });
      }
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
