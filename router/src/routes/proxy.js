/**
 * Proxy routes — session management + simple fetch endpoint
 */
const { Router } = require('express');
const { v4: uuidv4 } = require('uuid');
const { PassThrough } = require('stream');
const config = require('../config');

function createProxyRoutes(nodeManager, sessionManager, solanaService, pendingRequests) {
  const router = Router();

  // Create a proxy session
  router.post('/session', (req, res) => {
    const { country, carrier, wallet, escrowTx } = req.body;

    const match = nodeManager.findNode({ country, carrier });
    if (!match) {
      return res.status(503).json({ error: 'No proxy nodes available matching criteria' });
    }

    // Check session limit per API key
    if (req.apiKey) {
      const activeCount = sessionManager.activeCountByKey(req.apiKey);
      if (activeCount >= config.MAX_SESSIONS_PER_KEY) {
        return res.status(429).json({ error: `Max ${config.MAX_SESSIONS_PER_KEY} concurrent sessions per key` });
      }
    }

    const session = sessionManager.create({
      nodeId: match.nodeId,
      agentWallet: wallet || (req.agent && req.agent.wallet) || null,
      apiKey: req.apiKey || null,
      escrowTx: escrowTx || null,
    });

    res.json({
      sessionId: session.sessionId,
      nodeId: match.nodeId,
      node: {
        device: match.node.info.device,
        carrier: match.node.info.carrier,
        country: match.node.info.country,
      },
      proxy: {
        host: `localhost`,
        port: config.PROXY_PORT,
        header: `X-Session-Id: ${session.sessionId}`,
        usage: `curl -x http://HOST:${config.PROXY_PORT} -H "X-Session-Id: ${session.sessionId}" http://example.com`,
      },
      pricing: {
        costPerSession: config.SESSION_COST_SOL,
        currency: 'SOL',
        network: config.SOLANA_NETWORK,
      },
      status: 'active',
    });
  });

  // End a proxy session + trigger payout
  router.post('/session/:sessionId/end', async (req, res) => {
    const session = sessionManager.end(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    // Attempt payout to node owner
    let payout = null;
    const node = nodeManager.get(session.nodeId);
    if (node && node.info.wallet && solanaService.platformKeypair) {
      const nodeAmount = config.SESSION_COST_SOL * config.NODE_SHARE;
      payout = await solanaService.releasePayment(node.info.wallet, nodeAmount);
    }

    res.json({
      sessionId: session.sessionId,
      status: 'completed',
      duration: session.duration,
      bytesIn: session.bytesIn,
      bytesOut: session.bytesOut,
      requestCount: session.requestCount,
      payout: payout || { note: 'No payout (missing node wallet or keypair)' },
    });
  });

  // Get session info
  router.get('/session/:sessionId', (req, res) => {
    const session = sessionManager.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  });

  // Simple fetch — one-liner proxy test
  // GET /proxy/fetch?url=https://httpbin.org/ip
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
    });

    const requestId = uuidv4();

    // Build raw HTTP request
    const rawReq = `GET ${targetUrl} HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: close\r\nAccept: */*\r\nUser-Agent: ClawdBot-Proxy/1.0\r\n\r\n`;

    // Send to phone via existing proxy_http message type
    match.node.ws.send(JSON.stringify({
      type: 'proxy_http',
      requestId,
      sessionId: session.sessionId,
      rawRequest: Buffer.from(rawReq).toString('base64'),
    }));

    // Collect response via virtual socket
    const chunks = [];
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      sessionManager.end(session.sessionId);
      if (!res.headersSent) res.status(504).json({ error: 'Proxy timeout' });
    }, config.PROXY_REQUEST_TIMEOUT_MS);

    const virtualSocket = new PassThrough();
    virtualSocket.destroyed = false;
    pendingRequests.set(requestId, { socket: virtualSocket, nodeId: match.nodeId });

    virtualSocket.on('data', (chunk) => chunks.push(chunk));
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
        sessionId: session.sessionId,
        responseHeaders: headers,
        response: body,
      });
    });

    console.log(`[FETCH] ${targetUrl} via ${match.nodeId} (${match.node.info.device})`);
  });

  return router;
}

module.exports = createProxyRoutes;
