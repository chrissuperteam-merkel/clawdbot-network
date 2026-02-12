/**
 * NodeManager — Manages connected phone proxy nodes
 */
const { WebSocket } = require('ws');
const config = require('../config');
const { calculateStealthScore, getPricePerGB, getPricingTier } = require('./stealth-scoring');
const QualityScorer = require('./quality-scorer');
const { child } = require('./logger');

const log = child('node-manager');

class NodeManager {
  constructor(db) {
    this.nodes = new Map();
    this.qualityScorer = new QualityScorer();
    this.db = db || null;
    this._loadHistory();
    this._startCleanup();
  }

  _loadHistory() {
    if (!this.db) return;
    try {
      const rows = this.db.loadNodeHistory();
      for (const row of rows) {
        this.qualityScorer.initNode(row.nodeId);
      }
      log.info({ count: rows.length }, 'Loaded node history from DB');
    } catch (e) {
      log.warn({ err: e.message }, 'Failed to load node history');
    }
  }

  register(nodeId, ws, info) {
    const nodeInfo = {
      device: info.device || 'unknown',
      carrier: info.carrier || 'unknown',
      country: info.country || 'unknown',
      connectionType: info.connectionType || 'unknown',
      ip: info.ip || null,
      wallet: info.wallet || null,
      registeredAt: Date.now(),
    };
    const stealthScore = calculateStealthScore(nodeInfo);
    this.nodes.set(nodeId, {
      ws,
      info: nodeInfo,
      stealthScore,
      pricePerGB: getPricePerGB(stealthScore),
      pricingTier: getPricingTier(stealthScore),
      sessions: 0,
      lastHeartbeat: Date.now(),
    });
    this.qualityScorer.initNode(nodeId);

    // Persist to DB
    if (this.db) {
      try {
        this.db.upsertNode(nodeId, nodeInfo, stealthScore, this.qualityScorer.getQualityScore(nodeId));
      } catch (e) {
        log.warn({ err: e.message }, 'Failed to upsert node');
      }
    }

    log.info({ nodeId, device: info.device, carrier: info.carrier, country: info.country, stealth: stealthScore }, 'Node registered');
  }

  unregister(nodeId) {
    this.qualityScorer.recordDisconnect(nodeId);
    this.nodes.delete(nodeId);
    log.info({ nodeId }, 'Node disconnected');
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
   * Find best available node matching criteria.
   * Fix 7: weighted scoring with session load + preferredNodeId support
   */
  findNode({ country, carrier, minStealth, preferredNodeId } = {}) {
    // If preferred node requested and available, use it
    if (preferredNodeId) {
      const node = this.nodes.get(preferredNodeId);
      if (node && node.ws.readyState === WebSocket.OPEN) {
        return { nodeId: preferredNodeId, node };
      }
    }

    let best = null;
    let bestId = null;
    let bestScore = -1;

    for (const [id, node] of this.nodes) {
      if (node.ws.readyState !== WebSocket.OPEN) continue;
      if (country && node.info.country !== country) continue;
      if (carrier && node.info.carrier !== carrier) continue;
      if (minStealth && node.stealthScore < minStealth) continue;

      const qualityScore = this.qualityScorer.getQualityScore(id);
      const sessionLoad = node.sessions / config.MAX_SESSIONS_PER_NODE;
      const score = qualityScore * 0.6 + (1 - Math.min(1, sessionLoad)) * 100 * 0.4;

      if (!best || score > bestScore) {
        best = node;
        bestId = id;
        bestScore = score;
      }
    }

    return bestId ? { nodeId: bestId, node: best } : null;
  }

  /**
   * Find next best node excluding a set of nodeIds (for failover)
   */
  findAlternativeNode(excludeNodeIds = [], criteria = {}) {
    let best = null;
    let bestId = null;
    let bestScore = -1;

    for (const [id, node] of this.nodes) {
      if (excludeNodeIds.includes(id)) continue;
      if (node.ws.readyState !== WebSocket.OPEN) continue;
      if (criteria.country && node.info.country !== criteria.country) continue;

      const qualityScore = this.qualityScorer.getQualityScore(id);
      const sessionLoad = node.sessions / config.MAX_SESSIONS_PER_NODE;
      const score = qualityScore * 0.6 + (1 - Math.min(1, sessionLoad)) * 100 * 0.4;

      if (!best || score > bestScore) {
        best = node;
        bestId = id;
        bestScore = score;
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

  listNodes() {
    const nodes = [];
    for (const [id, node] of this.nodes) {
      if (node.ws.readyState === WebSocket.OPEN) {
        nodes.push({
          nodeId: id,
          ...node.info,
          activeSessions: node.sessions,
          uptime: Date.now() - node.info.registeredAt,
          stealthScore: node.stealthScore,
          pricePerGB: node.pricePerGB,
          pricingTier: node.pricingTier,
          qualityScore: this.qualityScorer.getQualityScore(id),
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

  _startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, node] of this.nodes) {
        if (node.ws.readyState !== WebSocket.OPEN) {
          this.nodes.delete(id);
          continue;
        }
        if (now - node.lastHeartbeat > config.NODE_HEARTBEAT_TIMEOUT_MS) {
          log.info({ nodeId: id }, 'Stale node removed');
          node.ws.close();
          this.nodes.delete(id);
        }
      }
    }, config.NODE_HEARTBEAT_INTERVAL_MS);
  }
}

module.exports = NodeManager;
