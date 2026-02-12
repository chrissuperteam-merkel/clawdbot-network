const express = require('express');
const http = require('http');
const net = require('net');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const crypto = require('crypto');

const app = express();

// Security Configuration
const API_KEY = process.env.API_KEY || crypto.randomBytes(32).toString('hex');
const MAX_CONNECTIONS = 1000;
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
    },
  }
}));

app.use(express.json({ limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: 'Too many requests from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Stricter rate limiting for critical endpoints
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Only 10 proxy requests per 15 minutes per IP
});

const PORT = process.env.PORT || 3001;
const PROXY_PORT = process.env.PROXY_PORT || 1080;
const SOLANA_RPC = process.env.SOLANA_RPC || 'https://api.devnet.solana.com';

// --- Secured State with proper cleanup ---
const phoneNodes = new Map();   // nodeId -> { ws, info, sessions, lastSeen }
const proxySessions = new Map(); // sessionId -> { nodeId, agentWallet, startedAt, bytesIn, bytesOut, lastActivity }
const pendingRequests = new Map(); // requestId -> { socket, nodeId, createdAt }

const connection = new Connection(SOLANA_RPC, 'confirmed');

// Input validation helpers
function validateNodeRegistration(msg) {
  if (!msg.device || typeof msg.device !== 'string' || msg.device.length > 100) {
    throw new Error('Invalid device name');
  }
  if (!msg.carrier || typeof msg.carrier !== 'string' || msg.carrier.length > 50) {
    throw new Error('Invalid carrier');
  }
  if (!msg.country || typeof msg.country !== 'string' || msg.country.length !== 2) {
    throw new Error('Invalid country code');
  }
  if (msg.wallet && !validator.isAlphanumeric(msg.wallet.replace(/[+/=]/g, ''))) {
    throw new Error('Invalid wallet format');
  }
}

function validateProxyRequest(req) {
  const { country, carrier, wallet } = req.body;
  
  if (country && (typeof country !== 'string' || country.length !== 2)) {
    throw new Error('Invalid country code');
  }
  if (carrier && (typeof carrier !== 'string' || carrier.length > 50)) {
    throw new Error('Invalid carrier');
  }
  if (wallet && !validator.isAlphanumeric(wallet.replace(/[+/=]/g, ''))) {
    throw new Error('Invalid wallet format');
  }
}

// API Key middleware for critical operations
function requireApiKey(req, res, next) {
  const providedKey = req.headers['x-api-key'];
  if (!providedKey || providedKey !== API_KEY) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

// --- WebSocket Server for Phone Nodes ---
const server = http.createServer(app);
const wss = new WebSocketServer({ 
  server, 
  path: '/node',
  maxPayload: 16 * 1024 * 1024 // 16MB limit
});

// Connection limit
let connectionCount = 0;

wss.on('connection', (ws, req) => {
  if (connectionCount >= MAX_CONNECTIONS) {
    ws.close(1013, 'Server overloaded');
    return;
  }
  
  connectionCount++;
  const nodeId = uuidv4();
  const clientIP = req.socket.remoteAddress;
  
  console.log(`[NODE] Phone connected: ${nodeId} from ${clientIP}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleNodeMessage(nodeId, ws, msg);
    } catch (e) {
      // Binary data = proxy response
      try {
        handleProxyData(nodeId, data);
      } catch (err) {
        console.error(`[NODE] Error handling data from ${nodeId}: ${err.message}`);
        ws.close(1002, 'Protocol error');
      }
    }
  });

  ws.on('close', () => {
    console.log(`[NODE] Phone disconnected: ${nodeId}`);
    connectionCount--;
    cleanupNode(nodeId);
  });

  ws.on('error', (err) => {
    console.error(`[NODE] Error for ${nodeId}:`, err.message);
    connectionCount--;
    cleanupNode(nodeId);
  });

  // Send welcome
  ws.send(JSON.stringify({ type: 'welcome', nodeId }));
});

function cleanupNode(nodeId) {
  phoneNodes.delete(nodeId);
  
  // Cleanup sessions for this node
  for (const [sessionId, session] of proxySessions) {
    if (session.nodeId === nodeId) {
      session.status = 'failed';
      // Note: In production, issue refunds here
    }
  }
  
  // Cleanup pending requests
  for (const [requestId, pending] of pendingRequests) {
    if (pending.nodeId === nodeId && pending.socket && !pending.socket.destroyed) {
      pending.socket.end();
      pendingRequests.delete(requestId);
    }
  }
}

function handleNodeMessage(nodeId, ws, msg) {
  try {
    switch (msg.type) {
      case 'register': {
        validateNodeRegistration(msg);
        
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
          sessions: 0,
          lastSeen: Date.now()
        });
        
        console.log(`[NODE] Registered: ${nodeId} (${msg.device}, ${msg.carrier}, ${msg.country})`);
        ws.send(JSON.stringify({ type: 'registered', nodeId }));
        break;
      }
      
      case 'proxy_response': {
        if (!msg.requestId || !msg.sessionId) {
          throw new Error('Missing requestId or sessionId');
        }
        
        const pending = pendingRequests.get(msg.requestId);
        if (pending && pending.socket && !pending.socket.destroyed) {
          try {
            const body = Buffer.from(msg.data, 'base64');
            pending.socket.write(body);
            
            if (msg.done) {
              pending.socket.end();
              pendingRequests.delete(msg.requestId);
              
              // Update session bytes
              const session = proxySessions.get(msg.sessionId);
              if (session) {
                session.bytesOut += body.length;
                session.lastActivity = Date.now();
              }
            }
          } catch (err) {
            console.error(`[PROXY] Error writing response: ${err.message}`);
            pending.socket.end();
            pendingRequests.delete(msg.requestId);
          }
        }
        break;
      }
      
      case 'proxy_error': {
        const pending = pendingRequests.get(msg.requestId);
        if (pending && pending.socket && !pending.socket.destroyed) {
          pending.socket.end();
          pendingRequests.delete(msg.requestId);
        }
        console.log(`[PROXY] Error from node ${nodeId}: ${msg.error}`);
        break;
      }
      
      default:
        console.warn(`[NODE] Unknown message type: ${msg.type}`);
    }
    
    // Update last seen
    const node = phoneNodes.get(nodeId);
    if (node) {
      node.lastSeen = Date.now();
    }
    
  } catch (err) {
    console.error(`[NODE] Error handling message from ${nodeId}: ${err.message}`);
    ws.send(JSON.stringify({ type: 'error', message: err.message }));
  }
}

function handleProxyData(nodeId, data) {
  // Binary frames: first 36 bytes = requestId (UUID), rest = response data
  if (data.length > 36) {
    const requestId = data.slice(0, 36).toString();
    const payload = data.slice(36);
    const pending = pendingRequests.get(requestId);
    if (pending && pending.socket && !pending.socket.destroyed) {
      try {
        pending.socket.write(payload);
      } catch (err) {
        console.error(`[PROXY] Error writing binary data: ${err.message}`);
        pending.socket.end();
        pendingRequests.delete(requestId);
      }
    }
  }
}

// --- HTTP API for Agents ---

// Health check - public
app.get('/health', (req, res) => {
  const activeNodes = Array.from(phoneNodes.values()).filter(n => 
    n.ws.readyState === WebSocket.OPEN && (Date.now() - n.lastSeen) < 60000
  ).length;
  
  const activeSessions = Array.from(proxySessions.values()).filter(s => 
    s.status === 'active' && (Date.now() - s.lastActivity) < SESSION_TIMEOUT
  ).length;
  
  res.json({
    status: 'ok',
    nodes: activeNodes,
    activeSessions: activeSessions,
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// List available proxy nodes - requires API key
app.get('/nodes', requireApiKey, (req, res) => {
  const nodes = [];
  const now = Date.now();
  
  for (const [id, node] of phoneNodes) {
    if (node.ws.readyState === WebSocket.OPEN && (now - node.lastSeen) < 60000) {
      nodes.push({ 
        nodeId: id, 
        ...node.info, 
        activeSessions: node.sessions,
        lastSeen: node.lastSeen
      });
    }
  }
  
  res.json({ nodes, count: nodes.length });
});

// Request a proxy session - requires API key + strict rate limiting
app.post('/proxy/request', strictLimiter, requireApiKey, (req, res) => {
  try {
    validateProxyRequest(req);
    
    const { country, carrier, wallet } = req.body;

    // Find a matching node
    let bestNode = null;
    let bestNodeId = null;
    const now = Date.now();
    
    for (const [id, node] of phoneNodes) {
      if (node.ws.readyState !== WebSocket.OPEN) continue;
      if ((now - node.lastSeen) > 60000) continue; // Node must be active
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
      lastActivity: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      status: 'active'
    });
    bestNode.sessions++;

    console.log(`[SESSION] Created ${sessionId} on node ${bestNodeId} for IP ${req.ip}`);

    res.json({
      sessionId,
      nodeId: bestNodeId,
      nodeInfo: bestNode.info,
      proxy: `http://localhost:${PROXY_PORT}`,
      proxyHeader: `X-Session-Id: ${sessionId}`,
      status: 'active',
      expiresAt: new Date(Date.now() + SESSION_TIMEOUT).toISOString()
    });
    
  } catch (err) {
    console.error(`[API] Proxy request error: ${err.message}`);
    res.status(400).json({ error: err.message });
  }
});

// End a proxy session - requires API key
app.post('/proxy/end', requireApiKey, (req, res) => {
  try {
    const { sessionId } = req.body;
    
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'Invalid sessionId' });
    }
    
    const session = proxySessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.status = 'completed';
    session.endedAt = Date.now();
    
    const node = phoneNodes.get(session.nodeId);
    if (node) {
      node.sessions = Math.max(0, node.sessions - 1);
    }

    console.log(`[SESSION] Ended ${sessionId} — ${session.bytesIn + session.bytesOut} bytes total`);

    res.json({
      sessionId,
      duration: session.endedAt - session.startedAt,
      bytesIn: session.bytesIn,
      bytesOut: session.bytesOut,
      status: 'completed'
    });
    
  } catch (err) {
    console.error(`[API] Session end error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session info - requires API key
app.get('/proxy/session/:id', requireApiKey, (req, res) => {
  try {
    const sessionId = req.params.id;
    
    if (!validator.isUUID(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }
    
    const session = proxySessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    
    res.json({ sessionId, ...session });
    
  } catch (err) {
    console.error(`[API] Session info error: ${err.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// --- HTTP CONNECT Proxy (for agents) ---
const proxyServer = net.createServer((clientSocket) => {
  let headerData = Buffer.alloc(0);
  let timeoutHandle = null;

  // Set up timeout
  timeoutHandle = setTimeout(() => {
    if (!clientSocket.destroyed) {
      clientSocket.end();
    }
  }, 30000); // 30 second timeout

  clientSocket.once('data', (chunk) => {
    try {
      clearTimeout(timeoutHandle);
      
      headerData = Buffer.concat([headerData, chunk]);
      const headerStr = headerData.toString();

      // Parse CONNECT or regular HTTP request
      const connectMatch = headerStr.match(/^CONNECT (.+):(\d+) HTTP/);
      const httpMatch = headerStr.match(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS) (https?:\/\/[^\s]+) HTTP/);

      // Find session from header
      const sessionMatch = headerStr.match(/X-Session-Id:\s*([^\r\n]+)/i);
      const sessionId = sessionMatch ? sessionMatch[1].trim() : null;
      
      if (!sessionId || !validator.isUUID(sessionId)) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Type: text/plain\r\n\r\nMissing or invalid X-Session-Id header. Create a session via POST /proxy/request first.\r\n');
        clientSocket.end();
        return;
      }
      
      const session = proxySessions.get(sessionId);
      if (!session || session.status !== 'active') {
        clientSocket.write('HTTP/1.1 410 Gone\r\nContent-Type: text/plain\r\n\r\nSession expired or invalid.\r\n');
        clientSocket.end();
        return;
      }
      
      // Check session timeout
      if (Date.now() - session.lastActivity > SESSION_TIMEOUT) {
        session.status = 'expired';
        clientSocket.write('HTTP/1.1 408 Request Timeout\r\nContent-Type: text/plain\r\n\r\nSession timed out.\r\n');
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
      pendingRequests.set(requestId, { 
        socket: clientSocket, 
        nodeId: session.nodeId,
        createdAt: Date.now()
      });
      
      session.bytesIn += chunk.length;
      session.lastActivity = Date.now();

      if (connectMatch) {
        // HTTPS tunnel
        const targetHost = connectMatch[1];
        const targetPort = parseInt(connectMatch[2]);
        
        // Validate target
        if (!validator.isFQDN(targetHost) && !validator.isIP(targetHost)) {
          clientSocket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nInvalid target host.\r\n');
          clientSocket.end();
          return;
        }
        
        if (targetPort < 1 || targetPort > 65535) {
          clientSocket.write('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\n\r\nInvalid target port.\r\n');
          clientSocket.end();
          return;
        }
        
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
          session.lastActivity = Date.now();
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
          session.lastActivity = Date.now();
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
      
    } catch (err) {
      console.error(`[PROXY] Error handling request: ${err.message}`);
      if (!clientSocket.destroyed) {
        clientSocket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
        clientSocket.end();
      }
    }
  });

  clientSocket.on('error', (err) => {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    console.error(`[PROXY] Client socket error: ${err.message}`);
  });
});

// --- Cleanup Tasks ---
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  // Clean up expired sessions
  for (const [sessionId, session] of proxySessions) {
    if (session.status === 'active' && (now - session.lastActivity) > SESSION_TIMEOUT) {
      session.status = 'expired';
      const node = phoneNodes.get(session.nodeId);
      if (node) {
        node.sessions = Math.max(0, node.sessions - 1);
      }
      cleaned++;
    }
  }
  
  // Clean up old pending requests
  for (const [requestId, pending] of pendingRequests) {
    if ((now - pending.createdAt) > 60000) { // 1 minute timeout
      if (pending.socket && !pending.socket.destroyed) {
        pending.socket.end();
      }
      pendingRequests.delete(requestId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`[CLEANUP] Cleaned up ${cleaned} expired items`);
  }
}, CLEANUP_INTERVAL);

// --- Error Handling ---
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  // In production: log to external service and gracefully shutdown
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    process.exit(0);
  });
});

// --- Start Servers ---
server.listen(PORT, () => {
  console.log(`[ROUTER] 🔒 HARDENED API + WebSocket server on port ${PORT}`);
  console.log(`[ROUTER] 📱 Phone nodes connect to ws://HOST:${PORT}/node`);
  if (!process.env.API_KEY) {
    console.log(`[ROUTER] 🔑 Generated API Key: ${API_KEY}`);
    console.log(`[ROUTER] ⚠️  Set API_KEY environment variable in production!`);
  }
});

proxyServer.listen(PROXY_PORT, () => {
  console.log(`[ROUTER] 🌐 HTTP proxy on port ${PROXY_PORT}`);
  console.log(`[ROUTER] 🤖 Agents use: http://HOST:${PROXY_PORT} with X-Session-Id header`);
});

console.log(`[ROUTER] 🔗 Solana RPC: ${SOLANA_RPC}`);