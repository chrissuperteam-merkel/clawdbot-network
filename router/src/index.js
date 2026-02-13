/**
 * Clawdbot Network — Router Server
 */
const express = require('express');
const http = require('http');
const cors = require('cors');
const config = require('./config');
const { child } = require('./services/logger');
const { getDatabase } = require('./services/database');

const log = child('router');

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

const MonitoringService = require('./services/monitoring');
const { x402PaymentMiddleware, getBazaarDescriptor } = require('./middleware/x402-payment');

// Infra
const setupWebSocket = require('./websocket-handler');
const createTcpProxy = require('./tcp-proxy');
const { optionalApiKey, rateLimit } = require('./middleware/auth');

// --- Initialize ---
const db = getDatabase();
const nodeManager = new NodeManager(db);
const sessionManager = new SessionManager(nodeManager, db);
const solanaService = new SolanaService(db);
const apiKeyManager = new ApiKeyManager();
const monitoringService = new MonitoringService(nodeManager);

// Shared state for pending proxy requests
const pendingRequests = new Map();

// Shared in-memory traffic log (last 100 entries)
const trafficLog = [];

// --- Express App ---
const app = express();
app.use(express.json());
app.use(cors());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (req.path !== '/health') {
      log.info({ method: req.method, url: req.path, status: res.statusCode, duration: ms }, 'request');
    }
  });
  next();
});

// Rate limiting on all routes
// Rate limit only proxy routes, not dashboard/admin
app.use((req, res, next) => {
  if (req.path.startsWith('/dashboard') || req.path.startsWith('/admin') || req.path === '/nodes' || req.path === '/') {
    return next();
  }
  return rateLimit()(req, res, next);
});

// Optional auth on all routes
app.use(optionalApiKey(apiKeyManager));

// --- Mount Routes ---
app.use('/nodes', createNodeRoutes(nodeManager));
// x402 payment middleware on proxy routes (alternative to SOL escrow)
app.use('/proxy/session', x402PaymentMiddleware());
app.use('/proxy', createProxyRoutes(nodeManager, sessionManager, solanaService, pendingRequests, monitoringService, trafficLog));
app.use('/admin', createAdminRoutes(nodeManager, sessionManager, solanaService, apiKeyManager, db, monitoringService, trafficLog));

// x402 Bazaar discovery endpoint
app.get('/x402/bazaar', (req, res) => {
  res.json(getBazaarDescriptor());
});
app.use('/dashboard', createDashboardRoutes(nodeManager, sessionManager, solanaService, monitoringService, trafficLog));

// Root
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
      'POST /proxy/session/:id/rotate': 'Rotate IP (mobile only)',
      'GET /admin/health': 'Health check',
      'GET /admin/balance': 'Platform wallet balance',
      'GET /admin/stats': 'Historical stats (from SQLite)',
      'GET /admin/payouts': 'Recent payouts',
      'POST /admin/keys': 'Create API key (admin)',
      'GET /admin/monitoring': 'Node monitoring stats (admin)',
      'GET /x402/bazaar': 'x402 Bazaar service descriptor',
      'GET /dashboard': 'Live monitoring dashboard',
    },
    docs: 'https://github.com/chrissuperteam-merkel/clawdbot-network',
  });
});

// --- HTTP + WebSocket Server ---
const server = http.createServer(app);
setupWebSocket(server, nodeManager, pendingRequests, sessionManager, monitoringService, trafficLog);

server.listen(config.PORT, '127.0.0.1', () => {
  log.info({ port: config.PORT, network: config.SOLANA_NETWORK }, 'Clawdbot Network Router v1.0.0 started');
});

// --- TCP Proxy ---
const tcpProxy = createTcpProxy(nodeManager, sessionManager, pendingRequests, apiKeyManager);
tcpProxy.listen(config.PROXY_PORT, '127.0.0.1', () => {
  log.info({ port: config.PROXY_PORT }, 'TCP proxy started');
});

// --- Graceful Shutdown ---
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function shutdown(signal) {
  log.info({ signal }, 'Shutting down');
  server.close();
  tcpProxy.close();
  db.close();
  process.exit(0);
}
