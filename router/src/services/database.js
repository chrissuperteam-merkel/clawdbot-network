/**
 * Database — SQLite persistence for sessions, nodes, quality metrics, payouts
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/clawdbot.db');

class DatabaseService {
  constructor() {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this._createTables();
    this._prepareStatements();
  }

  _createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sessionId TEXT PRIMARY KEY,
        nodeId TEXT,
        agentWallet TEXT,
        apiKey TEXT,
        escrowTx TEXT,
        paid INTEGER DEFAULT 0,
        startedAt INTEGER,
        endedAt INTEGER,
        bytesIn INTEGER DEFAULT 0,
        bytesOut INTEGER DEFAULT 0,
        requestCount INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        pricePerGB REAL DEFAULT 0,
        cost REAL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS node_history (
        nodeId TEXT PRIMARY KEY,
        device TEXT,
        carrier TEXT,
        country TEXT,
        connectionType TEXT,
        wallet TEXT,
        stealthScore INTEGER DEFAULT 0,
        qualityScore INTEGER DEFAULT 50,
        firstSeen INTEGER,
        lastSeen INTEGER,
        totalSessions INTEGER DEFAULT 0,
        totalBytes INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS quality_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nodeId TEXT,
        timestamp INTEGER,
        latencyMs INTEGER,
        success INTEGER,
        bytesTransferred INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS payouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT,
        nodeWallet TEXT,
        amount REAL,
        txSignature TEXT,
        success INTEGER,
        error TEXT,
        timestamp INTEGER
      );
    `);
  }

  _prepareStatements() {
    this._insertSession = this.db.prepare(`
      INSERT OR REPLACE INTO sessions (sessionId, nodeId, agentWallet, apiKey, escrowTx, paid, startedAt, endedAt, bytesIn, bytesOut, requestCount, status, pricePerGB, cost)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this._upsertNode = this.db.prepare(`
      INSERT INTO node_history (nodeId, device, carrier, country, connectionType, wallet, stealthScore, qualityScore, firstSeen, lastSeen, totalSessions, totalBytes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
      ON CONFLICT(nodeId) DO UPDATE SET
        device=excluded.device, carrier=excluded.carrier, country=excluded.country,
        connectionType=excluded.connectionType, wallet=excluded.wallet,
        stealthScore=excluded.stealthScore, lastSeen=excluded.lastSeen
    `);
    this._insertMetric = this.db.prepare(`
      INSERT INTO quality_metrics (nodeId, timestamp, latencyMs, success, bytesTransferred) VALUES (?, ?, ?, ?, ?)
    `);
    this._insertPayout = this.db.prepare(`
      INSERT INTO payouts (sessionId, nodeWallet, amount, txSignature, success, error, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this._updateNodeStats = this.db.prepare(`
      UPDATE node_history SET totalSessions = totalSessions + 1, totalBytes = totalBytes + ?, lastSeen = ? WHERE nodeId = ?
    `);
  }

  saveSession(session) {
    const totalBytes = (session.bytesIn || 0) + (session.bytesOut || 0);
    const costSol = session.cost?.totalSOL || 0;
    this._insertSession.run(
      session.sessionId, session.nodeId, session.agentWallet, session.apiKey,
      session.escrowTx, session.paid ? 1 : 0, session.startedAt, session.endedAt || null,
      session.bytesIn || 0, session.bytesOut || 0, session.requestCount || 0,
      session.status, session.pricePerGB || 0, costSol
    );
    // Update node stats
    if (session.nodeId) {
      try { this._updateNodeStats.run(totalBytes, Date.now(), session.nodeId); } catch {}
    }
  }

  upsertNode(nodeId, info, stealthScore, qualityScore) {
    const now = Date.now();
    this._upsertNode.run(
      nodeId, info.device || 'unknown', info.carrier || 'unknown',
      info.country || 'unknown', info.connectionType || 'unknown',
      info.wallet || null, stealthScore || 0, qualityScore || 50, now, now
    );
  }

  saveQualityMetric(nodeId, latencyMs, success, bytesTransferred) {
    this._insertMetric.run(nodeId, Date.now(), latencyMs, success ? 1 : 0, bytesTransferred || 0);
  }

  savePayout(sessionId, nodeWallet, amount, txSignature, success, error) {
    this._insertPayout.run(sessionId, nodeWallet, amount, txSignature || null, success ? 1 : 0, error || null, Date.now());
  }

  getStats() {
    const totalSessions = this.db.prepare('SELECT COUNT(*) as c FROM sessions').get().c;
    const totalBytes = this.db.prepare('SELECT COALESCE(SUM(bytesIn + bytesOut), 0) as b FROM sessions').get().b;
    const totalNodes = this.db.prepare('SELECT COUNT(*) as c FROM node_history').get().c;
    const totalSOL = this.db.prepare('SELECT COALESCE(SUM(amount), 0) as s FROM payouts WHERE success = 1').get().s;
    return { totalSessions, totalBytes, totalNodes, totalSOLEarned: totalSOL };
  }

  getRecentPayouts(limit = 20) {
    return this.db.prepare('SELECT * FROM payouts ORDER BY timestamp DESC LIMIT ?').all(limit);
  }

  loadNodeHistory() {
    return this.db.prepare('SELECT * FROM node_history').all();
  }

  close() {
    this.db.close();
  }
}

// Singleton
let instance = null;
function getDatabase() {
  if (!instance) instance = new DatabaseService();
  return instance;
}

module.exports = { getDatabase, DatabaseService };
