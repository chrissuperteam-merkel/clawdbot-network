/**
 * Clawdbot Network — Router Server
 *
 * Decentralized mobile proxy network on Solana.
 * Phones connect as proxy nodes via WebSocket.
 * AI agents route traffic through real mobile IPs.
 * Payments handled via Solana micropayments.
 *
 * Architecture:
 *   [Agent] → HTTP API / TCP Proxy → [Router] → WebSocket → [Phone Node] → Internet
 *
 * @version 1.0.0
 */

const express = require('express');
const http = require('http');
const cors = require('cors');
const config = require('./config');

// Services
const NodeManager = require('./services/node-manager');
const SessionManager = require('./services/session-manager');
const SolanaService = require('./services/solana-service');
const ApiKeyManager = require('./services/api-key-manager');

// Routes
const createNodeRoutes = require('./routes/nodes');
const createProxyRoutes = require('./routes/proxy');
const createAdminRoutes = require('./routes/admin');
const createDashboardRoutes = require('./routes/dashboard');

// Infra
const setupWebSocket = require('./websocket-handler');
const createTcpProxy = require('./tcp-proxy');
const { optionalApiKey, rateLimit } = require('./middleware/auth');

// --- Initialize ---
const nodeManager = new NodeManager();
const sessionManager = new SessionManager(nodeManager);
const solanaService = new SolanaService();
const apiKeyManager = new ApiKeyManager();

// Shared state for pending proxy requests
const pendingRequests = new Map();

// --- Express App ---
const app = express();
app.use(express.json());
app.use(cors());

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`[HTTP] ${req.method} ${req.path} → ${res.statusCode} (${ms}ms)`);
    }
  });
  next();
});

// Rate limiting on all routes
app.use(rateLimit());

// Optional auth on all routes (required only on specific ones)
app.use(optionalApiKey(apiKeyManager));

// --- Mount Routes ---
app.use('/nodes', createNodeRoutes(nodeManager));
app.use('/proxy', createProxyRoutes(nodeManager, sessionManager, solanaService, pendingRequests));
app.use('/admin', createAdminRoutes(nodeManager, sessionManager, solanaService, apiKeyManager));
app.use('/dashboard', createDashboardRoutes(nodeManager, sessionManager, solanaService));

// Root — API overview
app.get('/', (req, res) => {
  res.json({
    name: 'Clawdbot Network Router',
    version: '1.0.0',
    network: config.SOLANA_NETWORK,
    endpoints: {
      'GET /nodes': 'List available proxy nodes',
      'POST /proxy/session': 'Create a proxy session',
      'POST /proxy/session/:id/end': 'End session + trigger payout',
      'GET /proxy/fetch?url=': 'One-liner proxy test',
      'GET /admin/health': 'Health check',
      'GET /admin/balance': 'Platform wallet balance',
      'POST /admin/keys': 'Create API key (admin)',
      'GET /dashboard': 'Live monitoring dashboard',
    },
    docs: 'https://github.com/chrissuperteam-merkel/clawdbot-network',
  });
});

// --- HTTP + WebSocket Server ---
const server = http.createServer(app);
setupWebSocket(server, nodeManager, pendingRequests);

server.listen(config.PORT, '0.0.0.0', () => {
  console.log(`[ROUTER] Clawdbot Network Router v1.0.0`);
  console.log(`[ROUTER] Network: ${config.SOLANA_NETWORK}`);
  console.log(`[ROUTER] API server: http://0.0.0.0:${config.PORT}`);
  console.log(`[ROUTER] WebSocket: ws://0.0.0.0:${config.PORT}/node`);
});

// --- TCP Proxy ---
const tcpProxy = createTcpProxy(nodeManager, sessionManager, pendingRequests);
tcpProxy.listen(config.PROXY_PORT, '0.0.0.0', () => {
  console.log(`[ROUTER] TCP proxy: http://0.0.0.0:${config.PROXY_PORT}`);
  console.log(`[ROUTER] Ready. Waiting for phone nodes...`);
});

// --- Graceful Shutdown ---
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal) {
  console.log(`[ROUTER] ${signal} received, shutting down...`);
  server.close();
  tcpProxy.close();
  process.exit(0);
}
