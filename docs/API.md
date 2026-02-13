# Clawdbot Proxy Network — API Documentation

Base URL: `https://your-server/clawdbot` (or `http://localhost:3001` for local dev)

## Authentication

### API Key (Bearer Token)
```
Authorization: Bearer YOUR_API_KEY
```
Get an API key via the admin endpoint (requires admin secret).

### x402 USDC Payment
When `X402_ENABLED=true`, you can pay per-session with USDC:
```
X-Payment: <x402-payment-header>
```
Price: $0.01 per session, $2.00 per GB. Solana mainnet USDC.

### SOL Escrow (Legacy)
Provide an `escrowTx` in the session creation body. The router verifies the on-chain payment.

---

## Endpoints

### Health Check
```
GET /admin/health
```
```bash
curl https://your-server/clawdbot/admin/health
```
Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "network": "devnet",
  "nodes": 2,
  "activeSessions": 1,
  "uptime": 3600
}
```

### List Nodes
```
GET /nodes
```
```bash
curl https://your-server/clawdbot/nodes
```
Response:
```json
{
  "count": 1,
  "nodes": [{
    "nodeId": "abc-123",
    "device": "Pixel 7",
    "carrier": "T-Mobile",
    "country": "DE",
    "connectionType": "mobile_5g",
    "stealthScore": 95,
    "pricePerGB": 0.01,
    "pricingTier": "premium",
    "qualityScore": 85
  }]
}
```

### Create Proxy Session
```
POST /proxy/session
```
```bash
curl -X POST https://your-server/clawdbot/proxy/session \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"country": "DE", "carrier": "T-Mobile"}'
```
Body (all optional):
| Field | Type | Description |
|-------|------|-------------|
| country | string | Country code filter |
| carrier | string | Carrier name filter |
| wallet | string | Your Solana wallet (for SOL escrow) |
| escrowTx | string | SOL escrow transaction signature |
| minStealth | number | Minimum stealth score (0-100) |
| preferredNodeId | string | Request specific node |

Response:
```json
{
  "sessionId": "uuid",
  "nodeId": "uuid",
  "node": { "device": "Pixel 7", "carrier": "T-Mobile", "country": "DE", "stealthScore": 95 },
  "pricing": { "tier": "premium", "pricePerGB": 0.01, "currency": "SOL" },
  "proxy": { "host": "localhost", "port": 1080, "header": "X-Session-Id: uuid" },
  "status": "active"
}
```

### End Session
```
POST /proxy/session/:sessionId/end
```
```bash
curl -X POST https://your-server/clawdbot/proxy/session/SESSION_ID/end
```
Response:
```json
{
  "sessionId": "uuid",
  "status": "completed",
  "duration": 120000,
  "bytesIn": 51200,
  "bytesOut": 1024,
  "cost": { "totalSOL": 0.005 },
  "paid": false
}
```

### Rotate IP
```
POST /proxy/session/:sessionId/rotate
```
Mobile connections only. WiFi returns 400.
```bash
curl -X POST https://your-server/clawdbot/proxy/session/SESSION_ID/rotate
```
Response:
```json
{ "sessionId": "uuid", "newIp": "203.0.113.42", "rotated": true }
```

### Proxy Fetch (One-liner)
```
GET /proxy/fetch?url=https://httpbin.org/ip
```
```bash
curl "https://your-server/clawdbot/proxy/fetch?url=https://httpbin.org/ip" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### TCP/SOCKS5 Proxy
```bash
# HTTP CONNECT (HTTPS)
curl -x http://localhost:1080 --proxy-user YOUR_API_KEY:auto https://httpbin.org/ip

# SOCKS5
curl -x socks5://YOUR_API_KEY:auto@localhost:1080 https://httpbin.org/ip
```

### Node Monitoring (Admin)
```
GET /admin/monitoring
```
```bash
curl https://your-server/clawdbot/admin/monitoring -H "X-Admin-Secret: YOUR_SECRET"
```
Response:
```json
{
  "timestamp": "2026-02-13T14:00:00Z",
  "totalTrackedNodes": 3,
  "currentlyOnline": 2,
  "nodes": [{
    "nodeId": "uuid",
    "online": true,
    "lastSeen": "2026-02-13T13:59:30Z",
    "avgLatencyMs": 150,
    "totalRequests": 500,
    "errorRate": "2.0%"
  }]
}
```

### x402 Bazaar Discovery
```
GET /x402/bazaar
```
Returns the x402 Bazaar service descriptor for automated discovery.

### Admin: API Keys
```bash
# Create key
curl -X POST https://your-server/clawdbot/admin/keys \
  -H "X-Admin-Secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label": "my-agent", "wallet": "SolanaWalletAddress"}'

# List keys
curl https://your-server/clawdbot/admin/keys -H "X-Admin-Secret: YOUR_SECRET"

# Revoke key
curl -X DELETE https://your-server/clawdbot/admin/keys/API_KEY -H "X-Admin-Secret: YOUR_SECRET"
```

### Admin: Stats & Payouts
```bash
curl https://your-server/clawdbot/admin/stats -H "X-Admin-Secret: YOUR_SECRET"
curl https://your-server/clawdbot/admin/payouts -H "X-Admin-Secret: YOUR_SECRET"
curl https://your-server/clawdbot/admin/balance -H "X-Admin-Secret: YOUR_SECRET"
```

---

## SDK Quickstart

### Python
```python
from clawdbot import ClawdbotClient

client = ClawdbotClient(api_key="your-key", base_url="https://your-server/clawdbot")
session = client.create_session(country="DE")

import requests
resp = requests.get("https://httpbin.org/ip", proxies=client.proxy_dict(session["sessionId"]))
print(resp.json())

client.end_session(session["sessionId"])
```

### JavaScript (Node.js)
```javascript
const ClawdbotClient = require('./sdk/clawdbot-client');

const client = new ClawdbotClient({ apiKey: 'your-key', baseUrl: 'https://your-server/clawdbot' });
const session = await client.createSession({ country: 'DE' });
const result = await client.fetch('https://httpbin.org/ip');
console.log(result);
await client.endSession(session.sessionId);
```
