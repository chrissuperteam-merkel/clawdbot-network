/**
 * Quality Scorer — Track per-node metrics and calculate quality scores
 */

class QualityScorer {
  constructor() {
    this.metrics = new Map(); // nodeId -> { connectTime, disconnects, requests, failures, latencies, bytesTransferred, lastUpdate }
  }

  initNode(nodeId) {
    if (!this.metrics.has(nodeId)) {
      this.metrics.set(nodeId, {
        connectTime: Date.now(),
        totalConnectedMs: 0,
        disconnects: [],
        requests: 0,
        failures: 0,
        latencies: [],
        bytesTransferred: 0,
        lastUpdate: Date.now(),
      });
    }
  }

  recordDisconnect(nodeId) {
    const m = this.metrics.get(nodeId);
    if (m) {
      m.totalConnectedMs += Date.now() - m.connectTime;
      m.disconnects.push(Date.now());
    }
  }

  recordReconnect(nodeId) {
    const m = this.metrics.get(nodeId);
    if (m) {
      m.connectTime = Date.now();
    } else {
      this.initNode(nodeId);
    }
  }

  recordRequest(nodeId, latencyMs, success, bytes = 0) {
    const m = this.metrics.get(nodeId);
    if (!m) return;
    m.requests++;
    if (!success) m.failures++;
    m.latencies.push(latencyMs);
    // Keep last 100 latencies
    if (m.latencies.length > 100) m.latencies.shift();
    m.bytesTransferred += bytes;
    m.lastUpdate = Date.now();
  }

  getQualityScore(nodeId) {
    const m = this.metrics.get(nodeId);
    if (!m) return 50; // default score

    // Uptime: % of last 24h connected
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const currentSessionMs = now - m.connectTime;
    const totalMs = m.totalConnectedMs + currentSessionMs;
    const uptimeScore = Math.min(100, (totalMs / day) * 100);

    // Latency: lower is better (0-2000ms range mapped to 100-0)
    const avgLatency = m.latencies.length > 0
      ? m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length
      : 1000;
    const latencyScore = Math.max(0, Math.min(100, 100 - (avgLatency / 20)));

    // Success rate
    const successRate = m.requests > 0 ? ((m.requests - m.failures) / m.requests) * 100 : 50;

    // Bandwidth: bytes/sec over session
    const sessionDuration = Math.max(1, (now - m.connectTime) / 1000);
    const bps = m.bytesTransferred / sessionDuration;
    const bandwidthScore = Math.min(100, (bps / 10000) * 100); // 10KB/s = 100

    // Weighted average
    const score = (uptimeScore * 0.30) + (latencyScore * 0.25) + (successRate * 0.30) + (bandwidthScore * 0.15);
    return Math.round(Math.max(0, Math.min(100, score)));
  }

  cleanup(nodeId) {
    this.metrics.delete(nodeId);
  }
}

module.exports = QualityScorer;
