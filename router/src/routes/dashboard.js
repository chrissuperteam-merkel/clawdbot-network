/**
 * Dashboard — Real-time monitoring dashboard with traffic visibility
 */
const { Router } = require('express');

function createDashboardRoutes(nodeManager, sessionManager, solanaService, monitoringService, trafficLog) {
  const router = Router();

  // JSON API endpoints for dashboard AJAX
  router.get('/api/traffic', (req, res) => {
    res.json({ traffic: trafficLog || [] });
  });

  router.get('/api/monitoring', (req, res) => {
    if (!monitoringService) return res.json({ nodes: [] });
    res.json(monitoringService.getStats());
  });

  router.get('/api/bandwidth', (req, res) => {
    if (!monitoringService) return res.json({ totalBytes: 0, perNode: {}, hourly: [] });
    res.json(monitoringService.getBandwidthStats());
  });

  router.get('/api/throughput', (req, res) => {
    if (!monitoringService) return res.json({ global: {}, perNode: {}, peak: {} });
    res.json(monitoringService.getThroughputStats());
  });

  router.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Clawdbot Network — Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'SF Mono', 'Fira Code', monospace; padding: 20px; }
    h1 { color: #00ff88; font-size: 24px; margin-bottom: 20px; }
    h2 { color: #00cc66; font-size: 16px; margin: 20px 0 10px; text-transform: uppercase; letter-spacing: 2px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 20px; }
    .card { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 14px; }
    .card .label { color: #888; font-size: 11px; text-transform: uppercase; }
    .card .value { color: #00ff88; font-size: 26px; font-weight: bold; margin-top: 4px; }
    .card .unit { color: #666; font-size: 13px; }
    .status-ok { color: #00ff88; }
    .status-warn { color: #ffaa00; }
    .status-err { color: #ff4444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #222; }
    th { color: #888; font-size: 11px; text-transform: uppercase; }
    td { font-size: 13px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .dot-green { background: #00ff88; }
    .dot-red { background: #ff4444; }
    .dot-yellow { background: #ffaa00; }
    .refresh { color: #555; font-size: 11px; margin-top: 20px; }
    .traffic-log { background: #111; border: 1px solid #333; border-radius: 4px; padding: 0; font-size: 12px; max-height: 280px; overflow-y: auto; }
    .traffic-log table { margin: 0; }
    .traffic-log th { position: sticky; top: 0; background: #1a1a2e; z-index: 1; }
    .traffic-log td { font-size: 12px; }
    .traffic-log .status-ok { color: #00ff88; }
    .traffic-log .status-err { color: #ff4444; }
    .chart-container { background: #111; border: 1px solid #333; border-radius: 4px; padding: 12px; margin-top: 10px; }
    .chart-title { color: #888; font-size: 11px; text-transform: uppercase; margin-bottom: 8px; }
    .bar-chart { display: flex; align-items: flex-end; gap: 2px; height: 80px; }
    .bar { background: #00ff88; min-width: 8px; flex: 1; border-radius: 2px 2px 0 0; transition: height 0.3s; position: relative; }
    .bar:hover { background: #00ffaa; }
    .bar-label { position: absolute; bottom: -16px; left: 50%; transform: translateX(-50%); font-size: 9px; color: #666; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 800px) { .two-col { grid-template-columns: 1fr; } }
    .monitor-card { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 12px; margin-bottom: 8px; }
    .monitor-card .node-name { color: #00ff88; font-weight: bold; font-size: 14px; }
    .monitor-card .stat { display: inline-block; margin-right: 16px; margin-top: 4px; }
    .monitor-card .stat .lbl { color: #888; font-size: 10px; text-transform: uppercase; }
    .monitor-card .stat .val { color: #e0e0e0; font-size: 14px; }
  </style>
</head>
<body>
  <h1>⚡ Clawdbot Network</h1>
  <div class="grid" id="stats"></div>

  <div class="two-col">
    <div>
      <h2>📱 Proxy Nodes</h2>
      <table id="nodes"><thead><tr><th>Status</th><th>Device</th><th>Country</th><th>Carrier</th><th>Stealth</th><th>Quality</th><th>Sessions</th></tr></thead><tbody></tbody></table>

      <h2>🔄 Active Sessions</h2>
      <table id="sessions"><thead><tr><th>Session</th><th>Node</th><th>Reqs</th><th>Bytes</th><th>Duration</th></tr></thead><tbody></tbody></table>
    </div>
    <div>
      <h2>📊 Node Monitoring</h2>
      <div id="monitoring"></div>

      <h2>📈 Bandwidth (by hour)</h2>
      <div class="chart-container">
        <div class="chart-title">Bytes routed per hour (today)</div>
        <div class="bar-chart" id="bw-chart"></div>
      </div>
    </div>
  </div>

  <h2>🌐 Live Traffic</h2>
  <div class="traffic-log" id="traffic-log">
    <table><thead><tr><th>Time</th><th>Method</th><th>Host</th><th>Node</th><th>Bytes</th><th>Status</th></tr></thead><tbody id="traffic-body"></tbody></table>
  </div>

  <p class="refresh">Traffic: 3s · Stats: 5s · <span id="last-refresh"></span></p>

  <script>
    const pathParts = window.location.pathname.split('/dashboard')[0];
    const BASE = pathParts ? window.location.origin + pathParts : window.location.origin;
    const DASH = BASE + '/dashboard';
    const ADMIN_HEADERS = {'X-Admin-Secret': 'clawdbot-dev'};

    function formatBytes(b) {
      if (!b || b === 0) return '0 B';
      if (b < 1024) return b + ' B';
      if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
      if (b < 1024*1024*1024) return (b/(1024*1024)).toFixed(1) + ' MB';
      return (b/(1024*1024*1024)).toFixed(2) + ' GB';
    }

    function formatDuration(ms) {
      if (!ms) return '-';
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms/1000).toFixed(0) + 's';
      if (ms < 3600000) return (ms/60000).toFixed(1) + 'm';
      return (ms/3600000).toFixed(1) + 'h';
    }

    function timeAgo(iso) {
      const ms = Date.now() - new Date(iso).getTime();
      if (ms < 60000) return Math.floor(ms/1000) + 's ago';
      if (ms < 3600000) return Math.floor(ms/60000) + 'm ago';
      return Math.floor(ms/3600000) + 'h ago';
    }

    async function refreshStats() {
      try {
        const [health, nodes, sessions, balance] = await Promise.all([
          fetch(BASE + '/admin/health').then(r => r.json()),
          fetch(BASE + '/nodes').then(r => r.json()),
          fetch(BASE + '/admin/sessions').then(r => r.json()),
          fetch(BASE + '/admin/balance?_=' + Date.now(), {headers: ADMIN_HEADERS}).then(r => r.json()).catch(() => ({balance: '?'})),
        ]);

        document.getElementById('stats').innerHTML = [
          {label: 'Status', value: health.status === 'ok' ? '● ONLINE' : '● DOWN', cls: health.status === 'ok' ? 'status-ok' : 'status-err'},
          {label: 'Nodes', value: health.nodes, unit: 'online'},
          {label: 'Sessions', value: health.activeSessions, unit: 'active'},
          {label: 'Uptime', value: formatDuration(health.uptime * 1000), unit: ''},
          {label: 'Network', value: health.network || 'devnet', unit: ''},
          {label: 'Balance', value: typeof balance.balance === 'number' ? balance.balance.toFixed(4) : '?', unit: 'SOL'},
        ].map(s => '<div class="card"><div class="label">'+s.label+'</div><div class="value '+(s.cls||'')+'">'+s.value+'</div><div class="unit">'+(s.unit||'')+'</div></div>').join('');

        // Throughput
        const tp = await fetch(DASH + '/api/throughput').then(r => r.json()).catch(() => null);
        if (tp && tp.global) {
          const tpHtml = '<div class="card"><div class="label">Throughput (10s)</div><div class="value">'+(tp.global['10s']?.value||'0')+'</div><div class="unit">'+(tp.global['10s']?.unit||'bps')+'</div></div>' +
            '<div class="card"><div class="label">Throughput (1m)</div><div class="value">'+(tp.global['1m']?.value||'0')+'</div><div class="unit">'+(tp.global['1m']?.unit||'bps')+'</div></div>' +
            '<div class="card"><div class="label">Throughput (5m)</div><div class="value">'+(tp.global['5m']?.value||'0')+'</div><div class="unit">'+(tp.global['5m']?.unit||'bps')+'</div></div>' +
            '<div class="card"><div class="label">Peak</div><div class="value">'+(tp.peak?.value||'0')+'</div><div class="unit">'+(tp.peak?.unit||'bps')+'</div></div>' +
            '<div class="card"><div class="label">Total Routed</div><div class="value">'+formatBytes(tp.totalBytesAllTime||0)+'</div><div class="unit">all time</div></div>';
          document.getElementById('stats').innerHTML += tpHtml;
        }

        // Nodes
        const ntbody = document.querySelector('#nodes tbody');
        ntbody.innerHTML = nodes.nodes.length === 0
          ? '<tr><td colspan="7" style="color:#666">No nodes connected</td></tr>'
          : nodes.nodes.map(n => {
              var sc = n.stealthScore || 0, scC = sc > 70 ? '#00ff88' : sc > 40 ? '#ffaa00' : '#ff4444';
              var qc = n.qualityScore || 0, qcC = qc > 70 ? '#00ff88' : qc > 40 ? '#ffaa00' : '#ff4444';
              return '<tr><td><span class="dot dot-green"></span>ON</td><td>'+n.device+'</td><td>'+n.country+'</td><td>'+n.carrier+'</td><td style="color:'+scC+'">'+sc+'</td><td style="color:'+qcC+'">'+qc+'</td><td>'+n.activeSessions+'</td></tr>';
            }).join('');

        // Sessions
        const stbody = document.querySelector('#sessions tbody');
        stbody.innerHTML = sessions.sessions.length === 0
          ? '<tr><td colspan="5" style="color:#666">No active sessions</td></tr>'
          : sessions.sessions.map(s => '<tr><td>'+s.sessionId.slice(0,8)+'</td><td>'+s.nodeId.slice(0,8)+'</td><td>'+s.requestCount+'</td><td>'+formatBytes(s.bytesIn+s.bytesOut)+'</td><td>'+formatDuration(Date.now()-s.startedAt)+'</td></tr>').join('');

      } catch(e) { console.error('Stats error:', e); }
    }

    async function refreshMonitoring() {
      try {
        const [mon, bw] = await Promise.all([
          fetch(DASH + '/api/monitoring').then(r => r.json()),
          fetch(DASH + '/api/bandwidth').then(r => r.json()),
        ]);

        // Monitoring cards
        const monDiv = document.getElementById('monitoring');
        if (!mon.nodes || mon.nodes.length === 0) {
          monDiv.innerHTML = '<div style="color:#666;font-size:13px">No monitoring data yet</div>';
        } else {
          monDiv.innerHTML = mon.nodes.map(n => {
            const statusDot = n.online ? 'dot-green' : 'dot-red';
            return '<div class="monitor-card"><div class="node-name"><span class="dot '+statusDot+'"></span>'+n.nodeId.slice(0,8)+'</div>' +
              '<div class="stat"><div class="lbl">Uptime</div><div class="val">'+formatDuration(n.uptimeMs)+'</div></div>' +
              '<div class="stat"><div class="lbl">Avg Latency</div><div class="val">'+(n.avgLatencyMs ? n.avgLatencyMs+'ms' : '-')+'</div></div>' +
              '<div class="stat"><div class="lbl">P95 Latency</div><div class="val">'+(n.p95LatencyMs ? n.p95LatencyMs+'ms' : '-')+'</div></div>' +
              '<div class="stat"><div class="lbl">Requests</div><div class="val">'+n.totalRequests+'</div></div>' +
              '<div class="stat"><div class="lbl">Errors</div><div class="val" style="color:'+(n.totalErrors > 0 ? '#ff4444' : '#e0e0e0')+'">'+n.totalErrors+' ('+n.errorRate+')</div></div>' +
              '<div class="stat"><div class="lbl">Last Seen</div><div class="val">'+timeAgo(n.lastSeen)+'</div></div>' +
            '</div>';
          }).join('');
        }

        // Bandwidth chart
        const chart = document.getElementById('bw-chart');
        const hourly = bw.hourly || new Array(24).fill(0);
        const maxB = Math.max(...hourly, 1);
        const currentHour = new Date().getHours();
        // Show last 12 hours
        let bars = '';
        for (let i = 11; i >= 0; i--) {
          const h = (currentHour - i + 24) % 24;
          const pct = Math.max((hourly[h] / maxB) * 100, 2);
          const label = String(h).padStart(2, '0');
          bars += '<div class="bar" style="height:'+pct+'%" title="'+label+':00 — '+formatBytes(hourly[h])+'"><span class="bar-label">'+label+'</span></div>';
        }
        chart.innerHTML = bars;

        // Update total bytes card
        const totalBw = document.getElementById('total-bw');
        if (totalBw) totalBw.textContent = formatBytes(bw.totalBytes || 0);

      } catch(e) { console.error('Monitoring error:', e); }
    }

    async function refreshTraffic() {
      try {
        const data = await fetch(DASH + '/api/traffic').then(r => r.json());
        const tbody = document.getElementById('traffic-body');
        const entries = (data.traffic || []).slice(0, 50);
        tbody.innerHTML = entries.length === 0
          ? '<tr><td colspan="6" style="color:#666">No traffic yet — proxy some requests!</td></tr>'
          : entries.map(t => {
              const time = new Date(t.timestamp).toLocaleTimeString();
              const statusCls = t.status === 'completed' ? 'status-ok' : t.status === 'pending' ? 'status-warn' : 'status-err';
              return '<tr><td style="color:#888">'+time+'</td><td>'+t.method+'</td><td style="color:#00aaff">'+(t.host||'-')+'</td><td>'+((t.nodeId||'').slice(0,8)||'-')+'</td><td>'+formatBytes(t.bytes)+'</td><td class="'+statusCls+'">'+t.status+'</td></tr>';
            }).join('');
        document.getElementById('last-refresh').textContent = 'Updated ' + new Date().toLocaleTimeString();
      } catch(e) { console.error('Traffic error:', e); }
    }

    // Initial load
    refreshStats();
    refreshMonitoring();
    refreshTraffic();

    // Auto-refresh
    setInterval(refreshTraffic, 3000);
    setInterval(() => { refreshStats(); refreshMonitoring(); }, 5000);
  </script>
</body>
</html>`);
  });

  return router;
}

module.exports = createDashboardRoutes;
