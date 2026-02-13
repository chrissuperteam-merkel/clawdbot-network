/**
 * Admin routes — API key management, health, stats, payouts
 */
const { Router } = require('express');

function createAdminRoutes(nodeManager, sessionManager, solanaService, apiKeyManager, db, monitoringService, trafficLog) {
  const router = Router();
  const adminSecret = process.env.ADMIN_SECRET || 'clawdbot-dev';

  function requireAdmin(req, res) {
    const secret = req.headers['x-admin-secret'];
    if (secret !== adminSecret) {
      res.status(403).json({ error: 'Invalid admin secret' });
      return false;
    }
    return true;
  }

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.0.0',
      network: 'devnet',
      nodes: nodeManager.count,
      activeSessions: sessionManager.listActive().length,
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    });
  });

  // Fix 1: Historical stats from SQLite
  router.get('/stats', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!db) return res.status(500).json({ error: 'Database not available' });
    try {
      const stats = db.getStats();
      res.json({
        ...stats,
        currentNodes: nodeManager.count,
        currentActiveSessions: sessionManager.listActive().length,
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Fix 3: Recent payouts
  router.get('/payouts', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!db) return res.status(500).json({ error: 'Database not available' });
    try {
      const payouts = db.getRecentPayouts(parseInt(req.query.limit) || 20);
      res.json({ payouts });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/keys', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { wallet, label } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });
    const key = apiKeyManager.create({ wallet, label });
    res.json(key);
  });

  router.get('/keys', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ keys: apiKeyManager.list() });
  });

  router.delete('/keys/:apiKey', (req, res) => {
    if (!requireAdmin(req, res)) return;
    const revoked = apiKeyManager.revoke(req.params.apiKey);
    res.json({ revoked });
  });

  router.get('/balance', async (req, res) => {
    const balance = await solanaService.getBalance(solanaService.platformWallet.toBase58());
    res.json({ wallet: solanaService.platformWallet.toBase58(), balance, network: 'devnet' });
  });

  router.get('/sessions', (req, res) => {
    res.json({ sessions: sessionManager.listActive() });
  });

  // Bandwidth stats
  router.get('/bandwidth', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!monitoringService) return res.status(501).json({ error: 'Monitoring not available' });
    res.json(monitoringService.getBandwidthStats());
  });

  // Traffic log
  router.get('/traffic', (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ traffic: trafficLog || [] });
  });

  // Node monitoring stats (Phase 3)
  router.get('/monitoring', (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!monitoringService) {
      return res.status(501).json({ error: 'Monitoring service not available' });
    }
    res.json(monitoringService.getStats());
  });

  return router;
}

module.exports = createAdminRoutes;
