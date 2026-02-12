import express from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { createProxySession, getSessionStatus, completeProxySession } from './proxy-session';

// Try to import Solana contract helpers (optional)
let registerDeviceOnChain: ((wallet: string, deviceId: string) => Promise<any>) | null = null;
let releasePaymentOnChain: ((taskId: string, reward: number, recipient: string) => Promise<any>) | null = null;
try {
  const contracts = require('../contracts');
  registerDeviceOnChain = contracts.registerDevice;
  releasePaymentOnChain = contracts.releasePayment;
} catch {
  console.warn('[WARN] Solana contracts not found — on-chain calls will be skipped');
}

// Types
interface ProxyNode {
  deviceId: string;
  name: string;
  carrier: string;
  country: string;
  networkType: string; // '5g' | 'lte' | '3g'
  wallet: string;
  status: 'available' | 'busy' | 'offline';
  bandwidthMbps: number;
  uptimeScore: number;
  registeredAt: string;
}

interface ProxySession {
  sessionId: string;
  agentWallet: string;
  protocol: 'socks5' | 'http';
  country?: string;
  carrier?: string;
  durationMinutes: number;
  escrowLamports: number;
  status: 'pending' | 'active' | 'completed' | 'failed';
  assignedNode?: string;
  proxyUrl?: string;
  bytesTransferred: number;
  createdAt: string;
  completedAt?: string;
}

// In-memory state
const nodes = new Map<string, ProxyNode>();
const sessions = new Map<string, ProxySession>();

const app = express();
app.use(cors());
app.use(express.json());

// ── Health ──────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    nodes: nodes.size,
    activeSessions: Array.from(sessions.values()).filter(s => s.status === 'active').length,
    timestamp: new Date().toISOString(),
  });
});

// ── Proxy Nodes (Phone Registration) ───────────────────────────────

// List available proxy nodes
app.get('/proxy/nodes', (req, res) => {
  const { country, carrier } = req.query;
  let result = Array.from(nodes.values());
  if (country) result = result.filter(n => n.country === country);
  if (carrier) result = result.filter(n => n.carrier === carrier);
  res.json(result);
});

// Register a phone as a proxy node
app.post('/device/register', async (req, res) => {
  try {
    const { deviceId, name, carrier, country, networkType, wallet, bandwidthMbps } = req.body;
    if (!deviceId || !wallet || !carrier || !country) {
      return res.status(400).json({ error: 'deviceId, wallet, carrier, and country are required' });
    }

    const node: ProxyNode = {
      deviceId,
      name: name || `proxy-${deviceId.slice(0, 8)}`,
      carrier,
      country,
      networkType: networkType || 'lte',
      wallet,
      status: 'available',
      bandwidthMbps: bandwidthMbps || 10,
      uptimeScore: 1.0,
      registeredAt: new Date().toISOString(),
    };
    nodes.set(deviceId, node);

    // Register on-chain (fire and forget)
    if (registerDeviceOnChain) {
      registerDeviceOnChain(wallet, deviceId).catch(err =>
        console.error('[Solana] Register device failed:', err.message)
      );
    }

    res.json({ success: true, node });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// List all registered devices
app.get('/device/list', (_req, res) => {
  res.json(Array.from(nodes.values()));
});

// ── Proxy Sessions (Agent-facing) ──────────────────────────────────

// Agent requests a proxy session
app.post('/proxy/request', async (req, res) => {
  try {
    const { agentWallet, protocol, country, carrier, durationMinutes, escrowLamports } = req.body;
    if (!agentWallet) {
      return res.status(400).json({ error: 'agentWallet is required' });
    }

    // Find matching available node
    let candidates = Array.from(nodes.values()).filter(n => n.status === 'available');
    if (country) candidates = candidates.filter(n => n.country === country);
    if (carrier) candidates = candidates.filter(n => n.carrier === carrier);

    // Sort by uptime score (best first)
    candidates.sort((a, b) => b.uptimeScore - a.uptimeScore);

    if (candidates.length === 0) {
      return res.status(400).json({ error: 'No available proxy nodes matching criteria' });
    }

    const selectedNode = candidates[0];
    selectedNode.status = 'busy';

    const session: ProxySession = {
      sessionId: uuidv4(),
      agentWallet,
      protocol: protocol || 'socks5',
      country: selectedNode.country,
      carrier: selectedNode.carrier,
      durationMinutes: durationMinutes || 10,
      escrowLamports: escrowLamports || 0,
      status: 'active',
      assignedNode: selectedNode.deviceId,
      proxyUrl: `${protocol || 'socks5'}://${selectedNode.deviceId}:${session?.sessionId}@router.clawdbot.network:1080`,
      bytesTransferred: 0,
      createdAt: new Date().toISOString(),
    };

    // Fix proxy URL (session wasn't available yet)
    session.proxyUrl = `${session.protocol}://${selectedNode.deviceId}:${session.sessionId}@router.clawdbot.network:1080`;

    sessions.set(session.sessionId, session);

    // Initialize proxy tunnel
    try {
      await createProxySession(selectedNode.deviceId, session.sessionId, session.protocol);
    } catch (err: any) {
      console.error('[Proxy] Tunnel setup failed:', err.message);
    }

    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get session status
app.get('/proxy/session/:sessionId', (req, res) => {
  const session = sessions.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

// Complete a proxy session — release payment
app.post('/proxy/session/:sessionId/complete', async (req, res) => {
  try {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const { bytesTransferred } = req.body;
    session.status = 'completed';
    session.bytesTransferred = bytesTransferred || 0;
    session.completedAt = new Date().toISOString();

    // Free the proxy node
    if (session.assignedNode) {
      const node = nodes.get(session.assignedNode);
      if (node) node.status = 'available';
    }

    // Release escrow payment on-chain
    if (releasePaymentOnChain && session.assignedNode) {
      const node = nodes.get(session.assignedNode);
      if (node) {
        releasePaymentOnChain(session.sessionId, session.escrowLamports, node.wallet).catch(err =>
          console.error('[Solana] Payment release failed:', err.message)
        );
      }
    }

    // Clean up tunnel
    try {
      await completeProxySession(session.sessionId);
    } catch (err: any) {
      console.error('[Proxy] Tunnel cleanup failed:', err.message);
    }

    res.json({ success: true, session });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Clawdbot Proxy Router running on port ${PORT}`);
});
