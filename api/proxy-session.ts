/**
 * Proxy Session Manager — Manages proxy tunnel sessions between agents and phone nodes.
 *
 * Each proxy session establishes a WireGuard tunnel from the router to the phone,
 * then exposes a SOCKS5 or HTTP proxy endpoint that the agent can connect to.
 *
 * The phone runs a lightweight proxy daemon (part of the Clawdbot APK) that:
 *   - Accepts incoming WireGuard connections from the router
 *   - Runs a local SOCKS5/HTTP proxy server
 *   - Meters bandwidth usage for billing
 *   - Can rotate IP via airplane mode toggle
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

const CONFIG_PATH = path.join(process.env.HOME || '/root', '.config/clawdbot/config.json');

interface ProxyNodeConfig {
  /** WireGuard endpoint (phone's public IP or relay) */
  wireguard_endpoint: string;
  /** WireGuard public key of the phone */
  wireguard_pubkey: string;
  /** Carrier name */
  carrier: string;
  /** Country code */
  country: string;
}

interface ClawdbotConfig {
  nodes: Record<string, ProxyNodeConfig>;
  wireguard_privkey?: string;
  router_port?: number;
}

// Active proxy sessions
interface ActiveSession {
  sessionId: string;
  nodeId: string;
  protocol: string;
  startedAt: number;
  bytesIn: number;
  bytesOut: number;
  status: 'connecting' | 'active' | 'closing' | 'closed';
}

const activeSessions = new Map<string, ActiveSession>();

function loadConfig(): ClawdbotConfig {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch {
    return { nodes: {} };
  }
}

/**
 * Create a new proxy session — establishes tunnel to phone node.
 *
 * In production this would:
 * 1. Set up WireGuard tunnel to the phone
 * 2. Start a local SOCKS5/HTTP proxy that routes through the tunnel
 * 3. Return the proxy endpoint for the agent to use
 */
export async function createProxySession(
  nodeId: string,
  sessionId: string,
  protocol: string = 'socks5'
): Promise<ActiveSession> {
  const config = loadConfig();
  const nodeConfig = config.nodes[nodeId];

  const session: ActiveSession = {
    sessionId,
    nodeId,
    protocol,
    startedAt: Date.now(),
    bytesIn: 0,
    bytesOut: 0,
    status: 'connecting',
  };

  activeSessions.set(sessionId, session);

  // In production: establish WireGuard tunnel to phone
  // For now, mark as active (tunnel would be set up by the APK's daemon)
  if (nodeConfig) {
    console.log(`[Proxy] Establishing WireGuard tunnel to ${nodeConfig.wireguard_endpoint}`);
    console.log(`[Proxy] Phone carrier: ${nodeConfig.carrier} (${nodeConfig.country})`);
  }

  session.status = 'active';
  console.log(`[Proxy] Session ${sessionId} active — ${protocol} proxy via node ${nodeId}`);

  return session;
}

/**
 * Get status of an active proxy session.
 */
export function getSessionStatus(sessionId: string): ActiveSession | undefined {
  return activeSessions.get(sessionId);
}

/**
 * Complete and tear down a proxy session.
 */
export async function completeProxySession(sessionId: string): Promise<ActiveSession | undefined> {
  const session = activeSessions.get(sessionId);
  if (!session) return undefined;

  session.status = 'closing';

  // In production: tear down WireGuard tunnel, collect final bandwidth metrics
  console.log(`[Proxy] Closing session ${sessionId}`);
  console.log(`[Proxy] Bandwidth: ${session.bytesIn + session.bytesOut} bytes transferred`);

  session.status = 'closed';
  return session;
}

/**
 * Request IP rotation on a proxy node (triggers airplane mode toggle on phone).
 */
export async function rotateIP(nodeId: string): Promise<boolean> {
  console.log(`[Proxy] Requesting IP rotation on node ${nodeId} (airplane mode toggle)`);
  // In production: send command to phone APK to toggle airplane mode
  // Phone gets new carrier IP assignment from CGNAT pool
  return true;
}

/**
 * List all active proxy sessions.
 */
export function listActiveSessions(): ActiveSession[] {
  return Array.from(activeSessions.values()).filter(s => s.status === 'active');
}

/**
 * Update bandwidth metrics for a session (called by the metering daemon).
 */
export function updateBandwidth(sessionId: string, bytesIn: number, bytesOut: number): void {
  const session = activeSessions.get(sessionId);
  if (session) {
    session.bytesIn += bytesIn;
    session.bytesOut += bytesOut;
  }
}
