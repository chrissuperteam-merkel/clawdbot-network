/**
 * SessionManager — Manages proxy sessions between agents and phone nodes
 */
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

class SessionManager {
  constructor(nodeManager) {
    this.sessions = new Map(); // sessionId -> Session
    this.nodeManager = nodeManager;
    this._startCleanup();
  }

  /**
   * Create a new proxy session
   */
  create({ nodeId, agentWallet, apiKey, escrowTx, pricePerGB }) {
    const sessionId = uuidv4();
    const session = {
      sessionId,
      nodeId,
      agentWallet: agentWallet || null,
      apiKey: apiKey || null,
      escrowTx: escrowTx || null,
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
    console.log(`[SESSION] Created ${sessionId} → node ${nodeId}`);
    return session;
  }

  get(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Record activity on a session
   */
  recordActivity(sessionId, bytesIn = 0, bytesOut = 0) {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.lastActivity = Date.now();
    session.bytesIn += bytesIn;
    session.bytesOut += bytesOut;
    session.requestCount++;
  }

  /**
   * End a session and return usage stats
   */
  end(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    session.status = 'completed';
    session.endedAt = Date.now();
    session.duration = session.endedAt - session.startedAt;

    // Calculate bandwidth-based cost
    const totalBytes = session.bytesIn + session.bytesOut;
    const totalGB = totalBytes / (1024 * 1024 * 1024);
    session.cost = {
      totalBytes,
      totalGB: parseFloat(totalGB.toFixed(6)),
      pricePerGB: session.pricePerGB,
      totalSOL: parseFloat((totalGB * session.pricePerGB).toFixed(8)),
    };

    this.nodeManager.decrementSessions(session.nodeId);
    console.log(`[SESSION] Ended ${sessionId} — ${session.requestCount} requests, ${totalBytes} bytes, ${session.duration}ms, cost=${session.cost.totalSOL} SOL`);

    return session;
  }

  /**
   * Get active session count for an API key
   */
  activeCountByKey(apiKey) {
    let count = 0;
    for (const [, s] of this.sessions) {
      if (s.apiKey === apiKey && s.status === 'active') count++;
    }
    return count;
  }

  /**
   * List all active sessions
   */
  listActive() {
    return [...this.sessions.values()].filter(s => s.status === 'active');
  }

  /**
   * Cleanup idle sessions
   */
  _startCleanup() {
    setInterval(() => {
      const now = Date.now();
      for (const [id, session] of this.sessions) {
        if (session.status !== 'active') {
          // Remove completed sessions after 5 min
          if (session.endedAt && now - session.endedAt > 5 * 60 * 1000) {
            this.sessions.delete(id);
          }
          continue;
        }
        // Timeout idle active sessions
        if (now - session.lastActivity > config.SESSION_TIMEOUT_MS) {
          console.log(`[SESSION] Idle timeout: ${id}`);
          this.end(id);
        }
      }
    }, 30000);
  }
}

module.exports = SessionManager;
