/**
 * NodeManager — Manages connected phone proxy nodes
 */
const { WebSocket } = require('ws');
const config = require('../config');

class NodeManager {
  constructor() {
    this.nodes = new Map(); // nodeId -> { ws, info, sessions, lastHeartbeat }
    this._startCleanup();
  }

  register(nodeId, ws, info) {
    this.nodes.set(nodeId, {
      ws,
      info: {
        device: info.device || 'unknown',
        carrier: info.carrier || 'unknown',
        country: info.country || 'unknown',
        connectionType: info.connectionType || 'unknown',
        ip: info.ip || null,
        wallet: info.wallet || null,
        registeredAt: Date.now(),
      },
      sessions: 0,
      lastHeartbeat: Date.now(),
    });
    console.log(`[NODE] Registered: ${nodeId} (${info.device}, ${info.carrier}, ${info.country})`);
  }

  unregister(nodeId) {
    this.nodes.delete(nodeId);
    console.log(`[NODE] Disconnected: ${nodeId}`);
  }

  heartbeat(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) node.lastHeartbeat = Date.now();
  }

  get(nodeId) {
    return this.nodes.get(nodeId);
  }

  isAlive(nodeId) {
    const node = this.nodes.get(nodeId);
    return node && node.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Find best available node matching criteria
   */
  findNode({ country, carrier } = {}) {
    let best = null;
    let bestId = null;

    for (const [id, node] of this.nodes) {
      if (node.ws.readyState !== WebSocket.OPEN) continue;
      if (country && node.info.country !== country) continue;
      if (carrier && node.info.carrier !== carrier) continue;
      if (!best || node.sessions < best.sessions) {
        best = node;
        bestId = id;
      }
    }

    return bestId ? { nodeId: bestId, node: best } : null;
  }

  incrementSessions(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) node.sessions++;
  }

  decrementSessions(nodeId) {
    const node = this.nodes.get(nodeId);
    if (node) node.sessions = Math.max(0, node.sessions - 1);
  }

  /**
   * List all online nodes (public info only)
   */
  listNodes() {
    const nodes = [];
    for (const [id, node] of this.nodes) {
      if (node.ws.readyState === WebSocket.OPEN) {
        nodes.push({
          nodeId: id,
          ...node.info,
          activeSessions: node.sessions,
          uptime: Date.now() - node.info.registeredAt,
        });
      }
    }
    return nodes;
  }

  get count() {
    let c = 0;
    for (const [, node] of this.nodes) {
      if (node.ws.readyState === WebSocket.OPEN) c++;
    }
    return c;
  }

  /**
   * Cleanup stale nodes (missed heartbeats)
   */
  _startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, node] of this.nodes) {
        if (node.ws.readyState !== WebSocket.OPEN) {
          this.nodes.delete(id);
          continue;
        }
        if (now - node.lastHeartbeat > config.NODE_HEARTBEAT_TIMEOUT_MS) {
          console.log(`[NODE] Stale node removed: ${id}`);
          node.ws.close();
          this.nodes.delete(id);
        }
      }
    }, config.NODE_HEARTBEAT_INTERVAL_MS);
  }
}

module.exports = NodeManager;
