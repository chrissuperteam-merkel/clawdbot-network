# Clawdbot Network - External Access Configuration

## ✅ COMPLETED SETUP

### Router Server
- **Status**: ✅ Running (PID: check with `ps aux | grep server.js`)
- **Local Port**: 3001 (alle Interfaces 0.0.0.0:3001)
- **Proxy Port**: 1080 (alle Interfaces 0.0.0.0:1080)

### Caddy Reverse Proxy
- **Config**: `/etc/caddy/Caddyfile` 
- **Domain**: `static.114.67.225.46.clients.your-server.de`
- **SSL**: Automatisch via Caddy (Let's Encrypt)
- **Path Prefix**: `/clawdbot/`

### 🔗 FINALE URLs FÜR DIE APK:

#### WebSocket für Phone Nodes (Seeker)
```
wss://static.114.67.225.46.clients.your-server.de/clawdbot/node
```

#### API Endpoints für Agents
```
Base URL: https://static.114.67.225.46.clients.your-server.de/clawdbot/
Health Check: https://static.114.67.225.46.clients.your-server.de/clawdbot/health
Nodes List: https://static.114.67.225.46.clients.your-server.de/clawdbot/nodes
```

### ✅ TESTS BESTANDEN:
1. **API Test**: `curl -s https://static.114.67.225.46.clients.your-server.de/clawdbot/health`
   - Response: `{"status":"ok","nodes":0,"activeSessions":0,"uptime":XX.X}`

2. **WebSocket Test**: Erfolgreiche Verbindung zu `wss://static.114.67.225.46.clients.your-server.de/clawdbot/node`
   - Response: `{"type":"welcome","nodeId":"..."}`

### 🛡️ Firewall Status
- Port 22 (SSH): ✅ Offen
- Port 80 (HTTP): ✅ Offen  
- Port 443 (HTTPS): ✅ Offen
- Port 3001 (Router): ❌ Nicht direkt erreichbar (über Caddy Proxy)

### 📝 ÄNDERUNGEN GEMACHT:

1. **Router Server** (`/root/.openclaw/workspace/clawdbot-network/router/server.js`):
   - Port von 3000 → 3001 geändert
   - Listen auf `0.0.0.0` statt localhost (alle Interfaces)

2. **Caddy Config** (`/etc/caddy/Caddyfile`):
   - WebSocket Proxy von `/clawdbot/node` → `localhost:3001/node` (mit URL rewrite)
   - API Proxy von `/clawdbot/*` → `localhost:3001/*` (mit URL rewrite)
   - SSL automatisch via Let's Encrypt

### 🚀 NÄCHSTE SCHRITTE FÜR DIE APK:
Die Android APK muss die WebSocket URL ändern von:
```
ws://46.225.67.114:3001/node
```
zu:
```
wss://static.114.67.225.46.clients.your-server.de/clawdbot/node
```

### 🔧 WARTUNG:
- Router Server läuft als Background-Prozess (Session: warm-bloom)
- Logs anzeigen: `process log warm-bloom`
- Router stoppen: `process kill warm-bloom`
- Router neu starten: `cd /root/.openclaw/workspace/clawdbot-network/router && node server.js`
- Caddy reload nach Config-Änderungen: `caddy reload --config /etc/caddy/Caddyfile`