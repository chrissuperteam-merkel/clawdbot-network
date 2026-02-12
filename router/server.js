const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const PROXY_PORT = process.env.PROXY_PORT || 1080;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// --- State ---
const phoneNodes = new Map();   // nodeId -> { ws, info, sessions }
const proxySessions = new Map(); // sessionId -> { nodeId, agentWallet, startedAt, bytesIn, bytesOut }
const pendingRequests = new Map(); // requestId -> { socket, nodeId }
const pendingFetches = new Map();  // requestId -> { onData, onError }

const connection = new Connection(SOLANA_RPC, 'confirmed');

// --- WebSocket Server for Phone Nodes ---
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/node' });

wss.on('connection', (ws, req) => {
  const nodeId = uuidv4();
  console.log(`[NODE] Phone connected: ${nodeId}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleNodeMessage(nodeId, ws, msg);
    } catch (e) {
      // Binary data = proxy response
      handleProxyData(nodeId, data);
    }
  });

  ws.on('close', () => {
    console.log(`[NODE] Phone disconnected: ${nodeId}`);
    phoneNodes.delete(nodeId);
  });

  ws.on('error', (err) => {
    console.error(`[NODE] Error for ${nodeId}:`, err.message);
  });

  // Send welcome
  ws.send(JSON.stringify({ type: 'welcome', nodeId }));
});

function handleNodeMessage(nodeId, ws, msg) {
  switch (msg.type) {
    case 'register': {
      phoneNodes.set(nodeId, {
        ws,
        info: {
          device: msg.device || 'unknown',
          carrier: msg.carrier || 'unknown',
          country: msg.country || 'unknown',
          ip: msg.ip || null,
          wallet: msg.wallet || null,
          registeredAt: Date.now()
        },
        sessions: 0
      });
      console.log(`[NODE] Registered: ${nodeId} (${msg.device}, ${msg.carrier}, ${msg.country})`);
      ws.send(JSON.stringify({ type: 'registered', nodeId }));
      break;
    }
    case 'proxy_response': {
      // Forward proxy response back to the agent's TCP connection
      const pending = pendingRequests.get(msg.requestId);
      if (pending && pending.socket && !pending.socket.destroyed) {
        const body = Buffer.from(msg.data, 'base64');
        pending.socket.write(body);
        if (msg.done) {
          pending.socket.end();
          pendingRequests.delete(msg.requestId);
          // Update session bytes
          const session = proxySessions.get(msg.sessionId);
          if (session) {
            session.bytesOut += body.length;
          }
        }
      }
      break;
    }
    case 'proxy_error': {
      const pending2 = pendingRequests.get(msg.requestId);
      if (pending2 && pending2.socket && !pending2.socket.destroyed) {
        pending2.socket.end();
        pendingRequests.delete(msg.requestId);
      }
      // Also check pendingFetches
      const fetch2 = pendingFetches.get(msg.requestId);
      if (fetch2) fetch2.onError(msg.error);
      console.log(`[PROXY] Error from node ${nodeId}: ${msg.error}`);
      break;
    }
    case 'proxy_fetch_response': {
      const fetch = pendingFetches.get(msg.requestId);
      if (fetch) {
        const body = msg.data ? Buffer.from(msg.data, 'base64') : Buffer.alloc(0);
        fetch.onData(body, msg.done !== false);
      }
      break;
    }
  }
}

function handleProxyData(nodeId, data) {
  // Binary frames: first 36 bytes = requestId (UUID), rest = response data
  if (data.length > 36) {
    const requestId = data.slice(0, 36).toString();
    const payload = data.slice(36);
    const pending = pendingRequests.get(requestId);
    if (pending && pending.socket && !pending.socket.destroyed) {
      pending.socket.write(payload);
    }
  }
}

// --- HTTP API for Agents ---

// List available proxy nodes
app.get('/nodes', (req, res) => {
  const nodes = [];
  for (const [id, node] of phoneNodes) {
    if (node.ws.readyState === WebSocket.OPEN) {
      nodes.push({ nodeId: id, ...node.info, activeSessions: node.sessions });
    }
  }
  res.json({ nodes, count: nodes.length });
});

// Request a proxy session
app.post('/proxy/request', (req, res) => {
  const { country, carrier, wallet } = req.body;

  // Find a matching node
  let bestNode = null;
  let bestNodeId = null;
  for (const [id, node] of phoneNodes) {
    if (node.ws.readyState !== WebSocket.OPEN) continue;
    if (country && node.info.country !== country) continue;
    if (carrier && node.info.carrier !== carrier) continue;
    if (!bestNode || node.sessions < bestNode.sessions) {
      bestNode = node;
      bestNodeId = id;
    }
  }

  if (!bestNode) {
    return res.status(503).json({ error: 'No available proxy nodes matching criteria' });
  }

  const sessionId = uuidv4();
  proxySessions.set(sessionId, {
    nodeId: bestNodeId,
    agentWallet: wallet || null,
    startedAt: Date.now(),
    bytesIn: 0,
    bytesOut: 0,
    status: 'active'
  });
  bestNode.sessions++;

  console.log(`[SESSION] Created ${sessionId} on node ${bestNodeId}`);

  res.json({
    sessionId,
    nodeId: bestNodeId,
    nodeInfo: bestNode.info,
    proxy: `http://localhost:${PROXY_PORT}`,
    proxyHeader: `X-Session-Id: ${sessionId}`,
    status: 'active'
  });
});

// End a proxy session
app.post('/proxy/end', (req, res) => {
  const { sessionId } = req.body;
  const session = proxySessions.get(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  session.status = 'completed';
  session.endedAt = Date.now();
  const node = phoneNodes.get(session.nodeId);
  if (node) node.sessions = Math.max(0, node.sessions - 1);

  console.log(`[SESSION] Ended ${sessionId} — ${session.bytesIn + session.bytesOut} bytes total`);

  res.json({
    sessionId,
    duration: session.endedAt - session.startedAt,
    bytesIn: session.bytesIn,
    bytesOut: session.bytesOut,
    status: 'completed'
  });
});

// Get session info
app.get('/proxy/session/:id', (req, res) => {
  const session = proxySessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ sessionId: req.params.id, ...session });
});

// Simple proxy fetch — devs just call GET /proxy/fetch?url=https://httpbin.org/ip
// Routes HTTP request through phone's TCP proxy tunnel
app.get('/proxy/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).json({ error: 'Missing ?url= parameter' });

  // Find any available node
  let bestNode = null, bestNodeId = null;
  for (const [id, node] of phoneNodes) {
    if (node.ws.readyState !== WebSocket.OPEN) continue;
    if (!bestNode || node.sessions < bestNode.sessions) {
      bestNode = node; bestNodeId = id;
    }
  }
  if (!bestNode) return res.status(503).json({ error: 'No proxy nodes online' });

  let parsed;
  try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const requestId = uuidv4();
  const sessionId = uuidv4();
  proxySessions.set(sessionId, {
    nodeId: bestNodeId, agentWallet: null, startedAt: Date.now(),
    bytesIn: 0, bytesOut: 0, status: 'active'
  });
  bestNode.sessions++;

  // Build raw HTTP request
  const path = parsed.pathname + parsed.search;
  const rawReq = `GET ${targetUrl} HTTP/1.1\r\nHost: ${parsed.host}\r\nConnection: close\r\nAccept: */*\r\nUser-Agent: ClawdBot-Proxy/1.0\r\n\r\n`;

  // Send as proxy_http to phone (this the APK already understands)
  bestNode.ws.send(JSON.stringify({
    type: 'proxy_http',
    requestId,
    sessionId,
    rawRequest: Buffer.from(rawReq).toString('base64')
  }));

  // Collect response from pendingRequests using a virtual socket
  const chunks = [];
  const timeout = setTimeout(() => {
    pendingRequests.delete(requestId);
    bestNode.sessions = Math.max(0, bestNode.sessions - 1);
    proxySessions.delete(sessionId);
    if (!res.headersSent) res.status(504).json({ error: 'Proxy timeout (15s)' });
  }, 15000);

  // Create a virtual writable that collects data
  const { PassThrough } = require('stream');
  const virtualSocket = new PassThrough();
  virtualSocket.destroyed = false;
  pendingRequests.set(requestId, { socket: virtualSocket, nodeId: bestNodeId });

  virtualSocket.on('data', (chunk) => chunks.push(chunk));
  virtualSocket.on('end', () => {
    clearTimeout(timeout);
    pendingRequests.delete(requestId);
    bestNode.sessions = Math.max(0, bestNode.sessions - 1);
    const session = proxySessions.get(sessionId);
    if (session) { session.status = 'completed'; session.endedAt = Date.now(); }

    const fullResponse = Buffer.concat(chunks).toString();
    // Split HTTP headers from body
    const splitIdx = fullResponse.indexOf('\r\n\r\n');
    const headers = splitIdx >= 0 ? fullResponse.slice(0, splitIdx) : '';
    const body = splitIdx >= 0 ? fullResponse.slice(splitIdx + 4) : fullResponse;

    res.json({
      url: targetUrl,
      nodeId: bestNodeId,
      device: bestNode.info.device,
      country: bestNode.info.country,
      sessionId,
      responseHeaders: headers,
      response: body
    });
  });

  console.log(`[FETCH] ${targetUrl} via ${bestNodeId} (${bestNode.info.device})`);
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    nodes: phoneNodes.size,
    activeSessions: [...proxySessions.values()].filter(s => s.status === 'active').length,
    uptime: process.uptime()
  });
});

// --- HTTP CONNECT Proxy (for agents) ---
const proxyServer = net.createServer((clientSocket) => {
  let headerData = Buffer.alloc(0);

  clientSocket.once('data', (chunk) => {
    headerData = Buffer.concat([headerData, chunk]);
    const headerStr = headerData.toString();

    // Parse CONNECT or regular HTTP request
    const connectMatch = headerStr.match(/^CONNECT (.+):(\d+) HTTP/);
    const httpMatch = headerStr.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (https?:\/\/[^\s]+) HTTP/);

    // Find session from header
    const sessionMatch = headerStr.match(/X-Session-Id:\s*([^\r\n]+)/i);
    const sessionId = sessionMatch ? sessionMatch[1].trim() : null;
    let session = sessionId ? proxySessions.get(sessionId) : null;

    // Auto-create session if no header provided
    if (!session) {
      let autoNode = null, autoNodeId = null;
      for (const [id, node] of phoneNodes) {
        if (node.ws.readyState !== WebSocket.OPEN) continue;
        if (!autoNode || node.sessions < autoNode.sessions) { autoNode = node; autoNodeId = id; }
      }
      if (!autoNode) {
        clientSocket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\nNo proxy nodes online.\r\n');
        clientSocket.end();
        return;
      }
      const autoSessionId = uuidv4();
      proxySessions.set(autoSessionId, { nodeId: autoNodeId, agentWallet: null, startedAt: Date.now(), bytesIn: 0, bytesOut: 0, status: 'active' });
      autoNode.sessions++;
      session = proxySessions.get(autoSessionId);
      console.log(`[SESSION] Auto-created ${autoSessionId} on node ${autoNodeId}`);
    }

    const node = phoneNodes.get(session.nodeId);
    if (!node || node.ws.readyState !== WebSocket.OPEN) {
      clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nProxy node disconnected.\r\n');
      clientSocket.end();
      return;
    }

    const requestId = uuidv4();
    pendingRequests.set(requestId, { socket: clientSocket, nodeId: session.nodeId });
    session.bytesIn += chunk.length;

    if (connectMatch) {
      // HTTPS tunnel
      const targetHost = connectMatch[1];
      const targetPort = parseInt(connectMatch[2]);
      node.ws.send(JSON.stringify({
        type: 'proxy_connect',
        requestId,
        sessionId,
        host: targetHost,
        port: targetPort
      }));
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      // Pipe remaining data
      clientSocket.on('data', (d) => {
        session.bytesIn += d.length;
        node.ws.send(JSON.stringify({
          type: 'proxy_data',
          requestId,
          sessionId,
          data: d.toString('base64')
        }));
      });
    } else {
      // HTTP proxy
      node.ws.send(JSON.stringify({
        type: 'proxy_http',
        requestId,
        sessionId,
        rawRequest: chunk.toString('base64')
      }));
      clientSocket.on('data', (d) => {
        session.bytesIn += d.length;
        node.ws.send(JSON.stringify({
          type: 'proxy_data',
          requestId,
          sessionId,
          data: d.toString('base64')
        }));
      });
    }

    clientSocket.on('close', () => pendingRequests.delete(requestId));
    clientSocket.on('error', () => pendingRequests.delete(requestId));
  });
});

// --- Start ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ROUTER] API + WebSocket server on port ${PORT} (all interfaces)`);
  console.log(`[ROUTER] Phone nodes connect to ws://HOST:${PORT}/node`);
});

proxyServer.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`[ROUTER] HTTP proxy on port ${PROXY_PORT} (all interfaces)`);
  console.log(`[ROUTER] Agents use: http://HOST:${PROXY_PORT} with X-Session-Id header`);
});

console.log(`[ROUTER] Solana RPC: ${SOLANA_RPC}`);
