const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const PROXY_PORT = process.env.PROXY_PORT || 1080;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// --- State ---
const phoneNodes = new Map();   // nodeId -> { ws, info, sessions }
const proxySessions = new Map(); // sessionId -> { nodeId, agentWallet, startedAt, bytesIn, bytesOut }
const pendingRequests = new Map(); // requestId -> { socket, nodeId }

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
      console.log(`[PROXY] Error from node ${nodeId}: ${msg.error}`);
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
    const session = sessionId ? proxySessions.get(sessionId) : null;

    if (!session) {
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Type: text/plain\r\n\r\nMissing X-Session-Id header. Create a session via POST /proxy/request first.\r\n');
      clientSocket.end();
      return;
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
server.listen(PORT, () => {
  console.log(`[ROUTER] API + WebSocket server on port ${PORT}`);
  console.log(`[ROUTER] Phone nodes connect to ws://HOST:${PORT}/node`);
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`[ROUTER] HTTP proxy on port ${PROXY_PORT}`);
  console.log(`[ROUTER] Agents use: http://HOST:${PROXY_PORT} with X-Session-Id header`);
});

console.log(`[ROUTER] Solana RPC: ${SOLANA_RPC}`);
