/**
 * Proxy routes — session management + simple fetch endpoint
 */
const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { PassThrough } = require('stream');
const config = require('../config');
const { child } = require('../services/logger');

const log = child('proxy');

function createProxyRoutes(nodeManager, sessionManager, solanaService, pendingRequests) {
  const router = Router();

  // Create a proxy session
  router.post('/session', async (req, res) => {
    const { country, carrier, wallet, escrowTx, minStealth, preferredNodeId } = req.body;

    // Fix 2: Payment enforcement
    if (config.REQUIRE_PAYMENT && !escrowTx) {
      return res.status(402).json({
        error: 'Payment required',
        detail: 'REQUIRE_PAYMENT is enabled. Provide escrowTx.',
        required: {
          amount: config.SESSION_COST_SOL,
          currency: 'SOL',
          recipient: config.PLATFORM_WALLET,
          network: config.SOLANA_NETWORK,
        },
      });
    }

    const match = nodeManager.findNode({ country, carrier, minStealth, preferredNodeId });
    if (!match) {
      return res.status(503).json({ error: 'No proxy nodes available matching criteria' });
    }

    if (req.apiKey) {
      const activeCount = sessionManager.activeCountByKey(req.apiKey);
      if (activeCount >= config.MAX_SESSIONS_PER_KEY) {
        return res.status(429).json({ error: `Max ${config.MAX_SESSIONS_PER_KEY} concurrent sessions per key` });
      }
    }

    // Verify escrow payment on-chain
    let paymentInfo = null;
    if (escrowTx) {
      paymentInfo = await solanaService.verifyEscrowPayment(escrowTx, config.SESSION_COST_SOL);
      if (!paymentInfo.valid) {
        return res.status(402).json({
          error: 'Payment verification failed',
          detail: paymentInfo.error,
          required: {
            amount: config.SESSION_COST_SOL,
            currency: 'SOL',
            recipient: config.PLATFORM_WALLET,
            network: config.SOLANA_NETWORK,
          },
        });
      }
    }

    const session = sessionManager.create({
      nodeId: match.nodeId,
      agentWallet: wallet || (paymentInfo && paymentInfo.sender) || (req.agent && req.agent.wallet) || null,
      apiKey: req.apiKey || null,
      escrowTx: escrowTx || null,
      pricePerGB: match.node.pricePerGB,
      paid: !!paymentInfo,
    });

    const response = {
      sessionId: session.sessionId,
      nodeId: match.nodeId,
      node: {
        device: match.node.info.device,
        carrier: match.node.info.carrier,
        country: match.node.info.country,
        stealthScore: match.node.stealthScore,
        qualityScore: nodeManager.qualityScorer.getQualityScore(match.nodeId),
      },
      pricing: {
        tier: match.node.pricingTier,
        pricePerGB: match.node.pricePerGB,
        currency: 'SOL',
      },
      proxy: {
        host: 'localhost',
        port: config.PROXY_PORT,
        header: `X-Session-Id: ${session.sessionId}`,
        usage: `curl -x http://HOST:${config.PROXY_PORT} -H "X-Session-Id: ${session.sessionId}" http://example.com`,
      },
      status: 'active',
    };

    if (paymentInfo) {
      response.payment = { verified: true, tx: escrowTx, amount: paymentInfo.amount, sender: paymentInfo.sender };
    } else {
      response.payment = {
        verified: false,
        warning: 'No escrow TX provided — session is unpaid (devnet mode)',
        required: { amount: config.SESSION_COST_SOL, recipient: config.PLATFORM_WALLET, network: config.SOLANA_NETWORK },
      };
    }

    res.json(response);
  });

  // End a proxy session + trigger payout
  router.post('/session/:sessionId/end', async (req, res) => {
    const session = sessionManager.end(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Fix 2: Only attempt payout if session was paid
    let payout = null;
    if (session.paid) {
      const node = nodeManager.get(session.nodeId);
      if (node && node.info.wallet && solanaService.platformKeypair) {
        const nodeAmount = config.SESSION_COST_SOL * config.NODE_SHARE;
        payout = await solanaService.releasePayment(node.info.wallet, nodeAmount, session.sessionId);
      }
    }

    res.json({
      sessionId: session.sessionId,
      status: 'completed',
      duration: session.duration,
      bytesIn: session.bytesIn,
      bytesOut: session.bytesOut,
      requestCount: session.requestCount,
      cost: session.cost || null,
      paid: session.paid,
      payout: payout || { note: session.paid ? 'No payout (missing node wallet or keypair)' : 'No payout (unpaid session)' },
    });
  });

  // Rotate IP — Fix 5: only for mobile connections
  router.post('/session/:sessionId/rotate', (req, res) => {
    const session = sessionManager.get(req.params.sessionId);
    if (!session || session.status !== 'active') {
      return res.status(404).json({ error: 'Active session not found' });
    }

    const node = nodeManager.get(session.nodeId);
    if (!node || node.ws.readyState !== 1) {
      return res.status(502).json({ error: 'Node disconnected' });
    }

    // Fix 5: Check connection type — WiFi cannot rotate IP
    const connType = (node.info.connectionType || '').toLowerCase();
    if (connType === 'wifi' || (!connType.includes('mobile') && !connType.includes('cellular') && connType !== 'mobile_5g' && connType !== 'mobile_4g' && connType !== 'mobile_3g')) {
      return res.status(400).json({
        error: 'IP rotation not available for WiFi connections. Mobile connection required.',
        connectionType: node.info.connectionType,
        note: 'WiFi reconnection gives the same IP (same router). Only mobile connections (airplane mode toggle) get a new CGNAT IP.',
      });
    }

    const rotateId = require('uuid').v4();
    node.ws.send(JSON.stringify({
      type: 'ip_rotate',
      rotateId,
      sessionId: session.sessionId,
    }));

    const timeout = setTimeout(() => {
      if (pendingRequests.has('rotate_' + rotateId)) {
        pendingRequests.delete('rotate_' + rotateId);
        if (!res.headersSent) {
          res.status(504).json({ error: 'IP rotation timeout — phone did not respond in 30s' });
        }
      }
    }, 30000);

    pendingRequests.set('rotate_' + rotateId, {
      resolve: (newIp) => {
        clearTimeout(timeout);
        pendingRequests.delete('rotate_' + rotateId);
        node.info.ip = newIp;
        if (!res.headersSent) {
          res.json({ sessionId: session.sessionId, newIp, rotated: true });
        }
      },
    });
  });

  // Get session info
  router.get('/session/:sessionId', (req, res) => {
    const session = sessionManager.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  // Simple fetch — one-liner proxy test
  router.get('/fetch', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl) return res.status(400).json({ error: 'Missing ?url= parameter', example: '/proxy/fetch?url=https://httpbin.org/ip' });

    let parsed;
    try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

    const match = nodeManager.findNode();
    if (!match) return res.status(503).json({ error: 'No proxy nodes online' });

    const session = sessionManager.create({
      nodeId: match.nodeId,
      apiKey: req.apiKey || 'fetch-api',
      pricePerGB: match.node.pricePerGB,
    });

    const requestId = uuidv4();

    const rawReq = `GET ${targetUrl} HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: close\r\nAccept: */*\r\nUser-Agent: ClawdBot-Proxy/1.0\r\n\r\n`;
    // Fix 4: rawReq sent TO phone = bytesOut for agent
    sessionManager.recordActivity(session.sessionId, 0, rawReq.length);

    match.node.ws.send(JSON.stringify({
      type: 'proxy_http',
      requestId,
      sessionId: session.sessionId,
      rawRequest: Buffer.from(rawReq).toString('base64'),
    }));

    const chunks = [];
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      sessionManager.end(session.sessionId);
      if (!res.headersSent) res.status(504).json({ error: 'Proxy timeout' });
    }, config.PROXY_REQUEST_TIMEOUT_MS);

    const virtualSocket = new PassThrough();
    virtualSocket.destroyed = false;
    pendingRequests.set(requestId, { socket: virtualSocket, nodeId: match.nodeId });

    virtualSocket.on('data', (chunk) => {
      chunks.push(chunk);
      // Fix 4: data FROM phone = bytesIn for agent
      sessionManager.recordActivity(session.sessionId, chunk.length, 0);
    });
    virtualSocket.on('end', () => {
      clearTimeout(timeout);
      pendingRequests.delete(requestId);
      sessionManager.end(session.sessionId);

      const fullResponse = Buffer.concat(chunks).toString();
      const splitIdx = fullResponse.indexOf('\r\n\r\n');
      const headers = splitIdx >= 0 ? fullResponse.slice(0, splitIdx) : '';
      const body = splitIdx >= 0 ? fullResponse.slice(splitIdx + 4) : fullResponse;

      res.json({
        url: targetUrl,
        nodeId: match.nodeId,
        device: match.node.info.device,
        country: match.node.info.country,
        carrier: match.node.info.carrier,
        sessionId: session.sessionId,
        responseHeaders: headers,
        response: body,
      });
    });

    log.info({ url: targetUrl, nodeId: match.nodeId, device: match.node.info.device }, 'Fetch request');
  });

  return router;
}

module.exports = createProxyRoutes;
