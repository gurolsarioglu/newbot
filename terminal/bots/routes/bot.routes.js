/**
 * bot.routes.js — Bot Express Rotaları (Router Katmanı)
 * /api/signals, /api/signals/coin-history ve /api/signals/emit isteklerini BotController'a yönlendirir.
 */

const express = require('express');
const router = express.Router();
const botController = require('../controllers/bot.controller');

// 1. GET /api/signals/coin-history?symbol=SUIUSDT&days=60 (veya /history)
router.get('/coin-history', (req, res) => botController.getCoinHistory(req, res));
router.get('/history', (req, res) => botController.getCoinHistory(req, res));

// 2. GET /api/signals?bot=hammerproplus | 4ssniper | v3 | div | fr | m1a | m1premium | 4s | hammerpro
router.get('/', (req, res) => botController.getSignals(req, res));

// 3. POST /api/signals/emit (veya POST /api/signals)
router.post('/emit', (req, res) => botController.emitSignal(req, res));
router.post('/', (req, res) => botController.emitSignal(req, res));

module.exports = router;
