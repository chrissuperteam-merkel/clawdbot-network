/**
 * Admin routes — API key management, health, stats
 */
const { Router } = require('express');

function createAdminRoutes(nodeManager, sessionManager, solanaService, apiKeyManager) {
  const router = Router();

  // Health check
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

  // Create API key (admin only — protected by admin secret in production)
  router.post('/keys', (req, res) => {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== (process.env.ADMIN_SECRET || 'clawdbot-dev')) {
      return res.status(403).json({ error: 'Invalid admin secret' });
    }

    const { wallet, label } = req.body;
    if (!label) return res.status(400).json({ error: 'Label required' });

    const key = apiKeyManager.create({ wallet, label });
    res.json(key);
  });

  // List API keys (admin only)
  router.get('/keys', (req, res) => {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== (process.env.ADMIN_SECRET || 'clawdbot-dev')) {
      return res.status(403).json({ error: 'Invalid admin secret' });
    }
    res.json({ keys: apiKeyManager.list() });
  });

  // Revoke API key (admin only)
  router.delete('/keys/:apiKey', (req, res) => {
    const adminSecret = req.headers['x-admin-secret'];
    if (adminSecret !== (process.env.ADMIN_SECRET || 'clawdbot-dev')) {
      return res.status(403).json({ error: 'Invalid admin secret' });
    }

    const revoked = apiKeyManager.revoke(req.params.apiKey);
    res.json({ revoked });
  });

  // Platform wallet balance
  router.get('/balance', async (req, res) => {
    const balance = await solanaService.getBalance(solanaService.platformWallet.toBase58());
    res.json({
      wallet: solanaService.platformWallet.toBase58(),
      balance,
      network: 'devnet',
    });
  });

  // Active sessions
  router.get('/sessions', (req, res) => {
    res.json({ sessions: sessionManager.listActive() });
  });

  return router;
}

module.exports = createAdminRoutes;
