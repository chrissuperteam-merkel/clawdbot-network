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

    // Throughput tracking: sliding window of byte samples
    // Each sample: { timestamp, bytes }
    this.throughputSamples = []; // global samples
    this.nodeThroughputSamples = new Map(); // nodeId -> samples[]

    // Check for offline nodes every 60s
    this._interval = setInterval(() => this._checkOfflineNodes(), 60000);
    // Clean old throughput samples every 30s
    this._cleanupInterval = setInterval(() => this._cleanupSamples(), 30000);
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
        totalBytes: 0,
        bytesPerHour: new Array(24).fill(0),
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
  recordRequest(nodeId, success, bytes = 0) {
    const stats = this.nodeStats.get(nodeId);
    if (!stats) return;
    stats.totalRequests++;
    if (!success) stats.totalErrors++;
    if (bytes > 0) {
      stats.totalBytes += bytes;
      const hour = new Date().getHours();
      stats.bytesPerHour[hour] += bytes;

      // Record throughput sample
      const sample = { timestamp: Date.now(), bytes };
      this.throughputSamples.push(sample);
      if (!this.nodeThroughputSamples.has(nodeId)) {
        this.nodeThroughputSamples.set(nodeId, []);
      }
      this.nodeThroughputSamples.get(nodeId).push(sample);
    }
  }

  /**
   * Calculate throughput (bits/sec) over a time window
   */
  _calcThroughput(samples, windowMs) {
    const cutoff = Date.now() - windowMs;
    const recent = samples.filter(s => s.timestamp > cutoff);
    if (recent.length === 0) return 0;
    const totalBytes = recent.reduce((sum, s) => sum + s.bytes, 0);
    return (totalBytes * 8) / (windowMs / 1000); // bits per second
  }

  /**
   * Format bits/sec to human readable
   */
  static formatBitsPerSec(bps) {
    if (bps < 1000) return { value: bps.toFixed(1), unit: 'bps', raw: bps };
    if (bps < 1000000) return { value: (bps / 1000).toFixed(2), unit: 'Kbps', raw: bps };
    if (bps < 1000000000) return { value: (bps / 1000000).toFixed(2), unit: 'Mbps', raw: bps };
    return { value: (bps / 1000000000).toFixed(3), unit: 'Gbps', raw: bps };
  }

  /**
   * Get throughput stats
   */
  getThroughputStats() {
    const windows = {
      '10s': 10000,
      '1m': 60000,
      '5m': 300000,
      '1h': 3600000,
    };

    const global = {};
    for (const [label, ms] of Object.entries(windows)) {
      const bps = this._calcThroughput(this.throughputSamples, ms);
      global[label] = MonitoringService.formatBitsPerSec(bps);
    }

    const perNode = {};
    for (const [nodeId, samples] of this.nodeThroughputSamples) {
      perNode[nodeId] = {};
      for (const [label, ms] of Object.entries(windows)) {
        const bps = this._calcThroughput(samples, ms);
        perNode[nodeId][label] = MonitoringService.formatBitsPerSec(bps);
      }
    }

    // Peak throughput (max 10s window seen)
    let peakBps = 0;
    // Check sliding 10s windows in last hour
    const hourAgo = Date.now() - 3600000;
    const hourSamples = this.throughputSamples.filter(s => s.timestamp > hourAgo);
    // Simple approach: just track max from current windows
    const current10s = this._calcThroughput(this.throughputSamples, 10000);
    if (current10s > peakBps) peakBps = current10s;

    return {
      timestamp: new Date().toISOString(),
      global,
      perNode,
      peak: MonitoringService.formatBitsPerSec(peakBps),
      totalBytesAllTime: Array.from(this.nodeStats.values()).reduce((s, n) => s + (n.totalBytes || 0), 0),
    };
  }

  /**
   * Clean old throughput samples (keep last hour)
   */
  _cleanupSamples() {
    const cutoff = Date.now() - 3600000;
    this.throughputSamples = this.throughputSamples.filter(s => s.timestamp > cutoff);
    for (const [nodeId, samples] of this.nodeThroughputSamples) {
      this.nodeThroughputSamples.set(nodeId, samples.filter(s => s.timestamp > cutoff));
    }
  }

  /**
   * Get bandwidth stats (total today, per node, hourly)
   */
  getBandwidthStats() {
    const result = { totalBytes: 0, perNode: {}, hourly: new Array(24).fill(0) };
    for (const [nodeId, stats] of this.nodeStats) {
      result.totalBytes += stats.totalBytes || 0;
      result.perNode[nodeId] = stats.totalBytes || 0;
      if (stats.bytesPerHour) {
        for (let i = 0; i < 24; i++) {
          result.hourly[i] += stats.bytesPerHour[i] || 0;
        }
      }
    }
    return result;
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
    if (this._cleanupInterval) clearInterval(this._cleanupInterval);
  }
}

module.exports = MonitoringService;
