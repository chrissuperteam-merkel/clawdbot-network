/**
 * Dashboard — Real-time monitoring dashboard
 */
const { Router } = require('express');

function createDashboardRoutes(nodeManager, sessionManager, solanaService) {
  const router = Router();

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
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 20px; }
    .card { background: #1a1a2e; border: 1px solid #333; border-radius: 8px; padding: 16px; }
    .card .label { color: #888; font-size: 12px; text-transform: uppercase; }
    .card .value { color: #00ff88; font-size: 28px; font-weight: bold; margin-top: 4px; }
    .card .unit { color: #666; font-size: 14px; }
    .status-ok { color: #00ff88; }
    .status-warn { color: #ffaa00; }
    .status-err { color: #ff4444; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #222; }
    th { color: #888; font-size: 12px; text-transform: uppercase; }
    td { font-size: 14px; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; }
    .dot-green { background: #00ff88; }
    .dot-red { background: #ff4444; }
    .refresh { color: #666; font-size: 12px; margin-top: 20px; }
    .log { background: #111; border: 1px solid #333; border-radius: 4px; padding: 12px; font-size: 12px; max-height: 200px; overflow-y: auto; margin-top: 10px; }
    .log div { padding: 2px 0; border-bottom: 1px solid #1a1a1a; }
    .tx { color: #00aaff; text-decoration: none; }
    .tx:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>⚡ Clawdbot Network</h1>
  <div class="grid" id="stats"></div>
  
  <h2>📱 Proxy Nodes</h2>
  <table id="nodes"><thead><tr><th>Status</th><th>Device</th><th>Country</th><th>Carrier</th><th>Sessions</th><th>Uptime</th></tr></thead><tbody></tbody></table>
  
  <h2>🔄 Active Sessions</h2>
  <table id="sessions"><thead><tr><th>Session ID</th><th>Node</th><th>Requests</th><th>Bytes</th><th>Duration</th></tr></thead><tbody></tbody></table>

  <h2>📊 Recent Activity</h2>
  <div class="log" id="log"></div>

  <p class="refresh">Auto-refreshes every 5s</p>

  <script>
    const BASE = window.location.origin;
    const logs = [];

    function addLog(msg) {
      logs.unshift('[' + new Date().toLocaleTimeString() + '] ' + msg);
      if (logs.length > 50) logs.pop();
    }

    function formatBytes(b) {
      if (b < 1024) return b + ' B';
      if (b < 1024*1024) return (b/1024).toFixed(1) + ' KB';
      return (b/(1024*1024)).toFixed(1) + ' MB';
    }

    function formatDuration(ms) {
      if (ms < 1000) return ms + 'ms';
      if (ms < 60000) return (ms/1000).toFixed(1) + 's';
      return (ms/60000).toFixed(1) + 'm';
    }

    async function refresh() {
      try {
        const [health, nodes, sessions, balance] = await Promise.all([
          fetch(BASE + '/admin/health').then(r => r.json()),
          fetch(BASE + '/nodes').then(r => r.json()),
          fetch(BASE + '/admin/sessions').then(r => r.json()),
          fetch(BASE + '/admin/balance?_=' + Date.now(), {headers:{'X-Admin-Secret':'clawdbot-dev'}}).then(r => r.json()).catch(() => ({balance: '?'})),
        ]);

        // Stats cards
        document.getElementById('stats').innerHTML = [
          {label: 'Status', value: health.status === 'ok' ? '● ONLINE' : '● DOWN', cls: health.status === 'ok' ? 'status-ok' : 'status-err'},
          {label: 'Nodes', value: health.nodes, unit: 'online'},
          {label: 'Sessions', value: health.activeSessions, unit: 'active'},
          {label: 'Uptime', value: formatDuration(health.uptime * 1000), unit: ''},
          {label: 'Network', value: health.network || 'devnet', unit: ''},
          {label: 'Balance', value: typeof balance.balance === 'number' ? balance.balance.toFixed(4) : '?', unit: 'SOL'},
        ].map(s => '<div class="card"><div class="label">' + s.label + '</div><div class="value ' + (s.cls||'') + '">' + s.value + '</div><div class="unit">' + (s.unit||'') + '</div></div>').join('');

        // Nodes table
        const ntbody = document.querySelector('#nodes tbody');
        if (nodes.nodes.length === 0) {
          ntbody.innerHTML = '<tr><td colspan="6" style="color:#666">No nodes connected</td></tr>';
        } else {
          ntbody.innerHTML = nodes.nodes.map(n => '<tr>' +
            '<td><span class="dot dot-green"></span>Online</td>' +
            '<td>' + n.device + '</td>' +
            '<td>' + n.country + '</td>' +
            '<td>' + n.carrier + '</td>' +
            '<td>' + n.activeSessions + '</td>' +
            '<td>' + formatDuration(n.uptime) + '</td>' +
          '</tr>').join('');
        }

        // Sessions table
        const stbody = document.querySelector('#sessions tbody');
        if (sessions.sessions.length === 0) {
          stbody.innerHTML = '<tr><td colspan="5" style="color:#666">No active sessions</td></tr>';
        } else {
          stbody.innerHTML = sessions.sessions.map(s => '<tr>' +
            '<td style="font-size:12px">' + s.sessionId.slice(0,8) + '...</td>' +
            '<td style="font-size:12px">' + s.nodeId.slice(0,8) + '...</td>' +
            '<td>' + s.requestCount + '</td>' +
            '<td>' + formatBytes(s.bytesIn + s.bytesOut) + '</td>' +
            '<td>' + formatDuration(Date.now() - s.startedAt) + '</td>' +
          '</tr>').join('');
        }

        // Log
        document.getElementById('log').innerHTML = logs.map(l => '<div>' + l + '</div>').join('') || '<div style="color:#666">Waiting for activity...</div>';

        addLog('Refreshed — ' + health.nodes + ' nodes, ' + health.activeSessions + ' sessions');
      } catch(e) {
        addLog('Error: ' + e.message);
      }
    }

    refresh();
    setInterval(refresh, 5000);
  </script>
</body>
</html>`);
  });

  return router;
}

module.exports = createDashboardRoutes;
