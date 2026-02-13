/**
 * Node Monitoring Service
 * Tracks node uptime, latency, last seen timestamps.
 * Alerts when a node goes offline for >5 minutes.
 */
const { child } = require('./logger');

const log = child('monitoring');

class MonitoringService {
  constructor(nodeManager) {
    this.nodeManager = nodeManager;
    // nodeId -> { firstSeen, lastSeen, latencies[], uptimeMs, offlineAlerted }
    this.nodeStats = new Map();
    this._alertCallbacks = [];

    // Check for offline nodes every 60s
    this._interval = setInterval(() => this._checkOfflineNodes(), 60000);
  }

  /**
   * Register a callback for offline node alerts
   */
  onAlert(callback) {
    this._alertCallbacks.push(callback);
  }

  /**
   * Record a heartbeat/activity for a node
   */
  recordHeartbeat(nodeId, latencyMs = null) {
    const now = Date.now();
    let stats = this.nodeStats.get(nodeId);
    if (!stats) {
      stats = {
        firstSeen: now,
        lastSeen: now,
        latencies: [],
        totalRequests: 0,
        totalErrors: 0,
        offlineAlerted: false,
      };
      this.nodeStats.set(nodeId, stats);
    }
    stats.lastSeen = now;
    stats.offlineAlerted = false; // Reset alert on new activity
    if (latencyMs !== null) {
      stats.latencies.push(latencyMs);
      // Keep last 100 latency measurements
      if (stats.latencies.length > 100) stats.latencies.shift();
    }
  }

  /**
   * Record a proxy request result
   */
  recordRequest(nodeId, success) {
    const stats = this.nodeStats.get(nodeId);
    if (!stats) return;
    stats.totalRequests++;
    if (!success) stats.totalErrors++;
  }

  /**
   * Get monitoring stats for all nodes
   */
  getStats() {
    const now = Date.now();
    const nodes = [];

    for (const [nodeId, stats] of this.nodeStats) {
      const isOnline = this.nodeManager.isAlive(nodeId);
      const avgLatency = stats.latencies.length > 0
        ? Math.round(stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length)
        : null;
      const p95Latency = stats.latencies.length > 0
        ? stats.latencies.slice().sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
        : null;

      nodes.push({
        nodeId,
        online: isOnline,
        firstSeen: new Date(stats.firstSeen).toISOString(),
        lastSeen: new Date(stats.lastSeen).toISOString(),
        uptimeMs: now - stats.firstSeen,
        offlineSinceMs: isOnline ? 0 : now - stats.lastSeen,
        avgLatencyMs: avgLatency,
        p95LatencyMs: p95Latency,
        totalRequests: stats.totalRequests,
        totalErrors: stats.totalErrors,
        errorRate: stats.totalRequests > 0
          ? (stats.totalErrors / stats.totalRequests * 100).toFixed(1) + '%'
          : '0%',
      });
    }

    return {
      timestamp: new Date().toISOString(),
      totalTrackedNodes: this.nodeStats.size,
      currentlyOnline: nodes.filter(n => n.online).length,
      nodes,
    };
  }

  /**
   * Check for nodes that have been offline >5 minutes and fire alerts
   */
  _checkOfflineNodes() {
    const now = Date.now();
    const OFFLINE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

    for (const [nodeId, stats] of this.nodeStats) {
      const isOnline = this.nodeManager.isAlive(nodeId);
      if (!isOnline && !stats.offlineAlerted) {
        const offlineMs = now - stats.lastSeen;
        if (offlineMs > OFFLINE_THRESHOLD) {
          stats.offlineAlerted = true;
          const alert = {
            type: 'node_offline',
            nodeId,
            offlineSinceMs: offlineMs,
            lastSeen: new Date(stats.lastSeen).toISOString(),
            message: `Node ${nodeId.slice(0, 8)} offline for ${Math.round(offlineMs / 60000)} minutes`,
          };
          log.warn(alert, 'Node offline alert');
          for (const cb of this._alertCallbacks) {
            try { cb(alert); } catch (e) { log.error({ err: e.message }, 'Alert callback error'); }
          }
        }
      }
    }
  }

  /**
   * Clean up interval on shutdown
   */
  destroy() {
    if (this._interval) clearInterval(this._interval);
  }
}

module.exports = MonitoringService;
