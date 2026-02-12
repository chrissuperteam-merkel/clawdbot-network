# Clawdbot Network

**Decentralized Mobile Proxy Network on Solana**

Old phones become proxy nodes. AI agents route traffic through real mobile IPs. Payments via Solana micropayments.

## Why

AI agents need mobile IPs. Datacenter IPs get blocked by platforms like Google, Instagram, LinkedIn. Clawdbot turns old phones into a proxy network — phone owners earn SOL, agents get unblocked access.

## Architecture

```
[AI Agent] → HTTPS API → [Router] → WebSocket → [Phone Node] → Internet
                              ↕
                         [Solana Devnet]
                     (escrow + micropayments)
```

## Quick Test

```bash
# Check available nodes
curl https://static.114.67.225.46.clients.your-server.de/clawdbot/nodes

# Route a request through a phone
curl "https://static.114.67.225.46.clients.your-server.de/clawdbot/proxy/fetch?url=http://httpbin.org/ip"
```

The response IP is the phone's mobile IP, not the server.

## API Reference

### Public Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/nodes` | List online proxy nodes |
| `GET` | `/proxy/fetch?url=` | One-liner proxy test |
| `GET` | `/admin/health` | Health check |

### Authenticated Endpoints (API Key required)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/proxy/session` | Create proxy session |
| `POST` | `/proxy/session/:id/end` | End session + trigger payout |
| `GET` | `/proxy/session/:id` | Get session info |

### Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/keys` | Create API key |
| `GET` | `/admin/keys` | List API keys |
| `GET` | `/admin/balance` | Platform wallet balance |
| `GET` | `/admin/sessions` | Active sessions |

## Agent SDK Usage

```bash
# 1. Get an API key
curl -X POST https://HOST/clawdbot/admin/keys \
  -H "X-Admin-Secret: YOUR_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"label": "my-agent", "wallet": "YOUR_SOLANA_WALLET"}'

# 2. Create a paid session
# First, send 0.005 SOL to platform wallet, then:
curl -X POST https://HOST/clawdbot/proxy/session \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"country": "DE", "escrowTx": "TX_SIGNATURE"}'

# 3. Use the proxy
curl -x http://HOST:1080 \
  -H "X-Session-Id: SESSION_ID" \
  https://target-website.com

# 4. End session (triggers node payout)
curl -X POST https://HOST/clawdbot/proxy/session/SESSION_ID/end
```

## Payment Flow

```
Agent pays 0.005 SOL → Platform Escrow
  ↓
Agent uses proxy session
  ↓
Session ends → Payout:
  • 70% (0.0035 SOL) → Phone node owner
  • 30% (0.0015 SOL) → Platform
```

All transactions on Solana Devnet. Verifiable on-chain.

## Phone App (Android)

Download: [v1.1.0 APK](https://github.com/chrissuperteam-merkel/clawdbot-network/releases/download/v1.1.0/clawdbot-proxy-v1.1.0.apk)

Features:
- Foreground service (stays alive)
- Auto-reconnect with exponential backoff
- WebSocket tunnel to router
- HTTP + HTTPS CONNECT proxy
- Dark UI with live stats
- Heartbeat keepalive

## Router

```
router/src/
├── index.js              # Entry point
├── config.js             # Configuration
├── websocket-handler.js  # Phone node connections
├── tcp-proxy.js          # HTTP/HTTPS CONNECT proxy
├── middleware/
│   └── auth.js           # API key auth + rate limiting
├── routes/
│   ├── nodes.js          # Node listing
│   ├── proxy.js          # Session + fetch endpoints
│   └── admin.js          # Health, keys, balance
└── services/
    ├── node-manager.js   # Node lifecycle
    ├── session-manager.js # Session management
    ├── solana-service.js  # Escrow + payouts
    └── api-key-manager.js # API key CRUD
```

### Run locally

```bash
cd router
npm install
node src/index.js
```

### Run as service

```bash
sudo systemctl enable clawdbot-router
sudo systemctl start clawdbot-router
journalctl -u clawdbot-router -f
```

### Test suite

```bash
cd router && bash test.sh
```

## Tech Stack

- **Router:** Node.js, Express, WebSocket (ws)
- **Phone:** Kotlin, OkHttp, Android Foreground Service
- **Payments:** Solana Web3.js, Devnet
- **Proxy:** HTTPS via Caddy reverse proxy
- **Infra:** Hetzner VPS, UFW + Fail2ban

## On-Chain Transactions (Devnet)

- Device Registration: [`45MMyTa4...`](https://explorer.solana.com/tx/45MMyTa4kZthjd8xASeE28TfbNs3ERTqnCuVpvgEy8gV7xTDbBRVrtyFo57BgCQJobvRzMc2dReDi1GkHEcCQ3iH?cluster=devnet)
- Session Escrow: [`2okDunDB...`](https://explorer.solana.com/tx/2okDunDB3eTsgUuwvCYnaERcvKDmGDm8cAJ68T1jXLuvqfXNsUn2P6YKekTygmN6fRcdkNcFKQvXbyCoogG7JoZa?cluster=devnet)
- Payment Release: [`4Cq8LTjJ...`](https://explorer.solana.com/tx/4Cq8LTjJzuZRbpwxzkW4PWdFmG8aC1VUJVnSmDSfa2hHkaWLMUP1Afe7k5fCGhmq2m79167gSyR3HUjEFDkHTr1p?cluster=devnet)

## License

MIT
