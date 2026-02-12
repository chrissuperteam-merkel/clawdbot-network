/**
 * SessionManager — Manages proxy sessions between agents and phone nodes
 */
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const { child } = require('./logger');

const log = child('session-manager');

class SessionManager {
  constructor(nodeManager, db) {
    this.sessions = new Map();
    this.nodeManager = nodeManager;
    this.db = db || null;
    this._startCleanup();
  }

  create({ nodeId, agentWallet, apiKey, escrowTx, pricePerGB, paid }) {
    const sessionId = uuidv4();
    const session = {
      sessionId,
      nodeId,
      agentWallet: agentWallet || null,
      apiKey: apiKey || null,
      escrowTx: escrowTx || null,
      paid: !!paid,
      pricePerGB: pricePerGB || 0.002,
      startedAt: Date.now(),
      lastActivity: Date.now(),
      bytesIn: 0,
      bytesOut: 0,
      requestCount: 0,
      status: 'active',
    };

    this.sessions.set(sessionId, session);
    this.nodeManager.incrementSessions(nodeId);
    log.info({ sessionId, nodeId, paid: session.paid }, 'Session created');
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  recordActivity(sessionId, bytesIn = 0, bytesOut = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActivity = Date.now();
    session.bytesIn += bytesIn;
    session.bytesOut += bytesOut;
    session.requestCount++;
  }

  end(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'completed';
    session.endedAt = Date.now();
    session.duration = session.endedAt - session.startedAt;

    const totalBytes = session.bytesIn + session.bytesOut;
    const totalGB = totalBytes / (1024 * 1024 * 1024);
    session.cost = {
      totalBytes,
      totalGB: parseFloat(totalGB.toFixed(6)),
      pricePerGB: session.pricePerGB,
      totalSOL: parseFloat((totalGB * session.pricePerGB).toFixed(8)),
    };

    this.nodeManager.decrementSessions(session.nodeId);
    log.info({ sessionId, requests: session.requestCount, bytes: totalBytes, duration: session.duration, cost: session.cost.totalSOL }, 'Session ended');

    // Persist to DB
    if (this.db) {
      try { this.db.saveSession(session); } catch (e) {
        log.warn({ err: e.message }, 'Failed to save session to DB');
      }
    }

    return session;
  }

  activeCountByKey(apiKey) {
    let count = 0;
    for (const [, s] of this.sessions) {
      if (s.apiKey === apiKey && s.status === 'active') count++;
    }
    return count;
  }

  listActive() {
    return [...this.sessions.values()].filter(s => s.status === 'active');
  }

  _startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (session.status !== 'active') {
          if (session.endedAt && now - session.endedAt > 5 * 60 * 1000) {
            this.sessions.delete(id);
          }
          continue;
        }
        if (now - session.lastActivity > config.SESSION_TIMEOUT_MS) {
          log.info({ sessionId: id }, 'Idle timeout');
          this.end(id);
        }
      }
    }, 30000);
  }
}

module.exports = SessionManager;
