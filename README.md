# Clawdbot Network 📱🌐

**Decentralized mobile proxy network for AI agents, powered by Solana micropayments.**

> Turn old phones into proxy nodes. Earn SOL passively. Give AI agents the mobile IPs they need.

Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) on Solana.

---

## The Problem

AI Agents are blocked everywhere.

- **Datacenter IPs get flagged** — websites detect and block cloud infrastructure IPs instantly
- **CAPTCHAs kill automation** — agents hit verification walls that halt entire workflows
- **Rate limits throttle agents** — aggressive throttling on known proxy ranges
- **Commercial mobile proxies cost $10-15/GB** — prohibitively expensive for agent workloads

The proxy market is worth **$4.5B** and growing. AI agents are the fastest-growing segment of demand — yet they're stuck paying premium prices for mobile IPs from centralized middlemen.

## The Solution

**Clawdbot Network** turns old/unused smartphones into mobile proxy nodes in a decentralized network.

**Phone owners** install an APK, register on-chain (Solana), and earn SOL passively by sharing their mobile internet connection.

**AI Agents** pay per-request via Solana micropayments — no subscriptions, no minimums, just fractions of a cent per request.

### Why Mobile Proxies?

Mobile IPs are the gold standard for web access:

- **Almost never blocked** — carriers use CGNAT (thousands of users share one IP), so websites can't block mobile IPs without blocking real users
- **Fresh IPs on demand** — airplane mode toggle rotates to a new IP in seconds
- **Real device fingerprints** — requests come from real carrier networks with legitimate ASNs
- **Global coverage** — phones in 190+ countries provide geo-distributed access

This is the **#1 pain point** for AI agents trying to interact with the real web.

## How It Works

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌──────────────┐
│   AI Agent   │────▶│  Solana Escrow   │────▶│ Clawdbot Router  │────▶│ Phone Proxy  │────▶ Target
│  (Client)    │     │  (Pay-per-req)   │     │  (Session Mgmt)  │     │  (SOCKS5/HTTP)│
└──────────────┘     └──────────────────┘     └──────────────────┘     └──────────────┘
                              │                                                │
                              └─── Payment released on session complete ───────┘
```

### For Phone Owners (Supply Side)

1. **Install the APK** on any old Android phone (Android 8+)
2. **Register on-chain** — phone gets a Solana identity with specs, carrier, and location
3. **Leave it on charger + mobile data** — phone becomes a proxy node
4. **Earn SOL passively** — payments stream in as agents route traffic through your phone

### For AI Agents (Demand Side)

```typescript
// Request a proxy session through a real mobile IP
const session = await fetch('https://api.clawdbot.network/proxy/request', {
  method: 'POST',
  body: JSON.stringify({
    country: 'US',
    carrier: 'T-Mobile',
    duration_minutes: 10,
    protocol: 'socks5'
  })
});

// Use the proxy — traffic routes through a real phone
const proxy = session.proxy_url; // socks5://node-id:token@router.clawdbot.network:1080
```

## APK Features

The Clawdbot Proxy APK runs as a background service on Android:

- **SOCKS5 & HTTP proxy** — standard proxy protocols, compatible with any HTTP client
- **WireGuard tunnel** — encrypted tunnel between router and phone node
- **IP rotation** — automated airplane mode toggle for fresh carrier IP
- **Bandwidth metering** — precise tracking of bytes proxied for fair payment
- **Battery optimization** — minimal CPU usage, designed for 24/7 operation on charger
- **Auto-reconnect** — handles network changes and carrier switching gracefully

## On-Chain Architecture (Solana)

### Device Registry
- Phone specs (model, OS version, RAM)
- Carrier & network type (5G/LTE/3G)
- Geographic location (country/city)
- Uptime history & availability status
- Owner wallet for receiving payments

### Session Escrow
- Agent deposits SOL before session starts
- Payment held in escrow PDA during proxy session
- Released to phone owner on session completion
- Automatic refund if session fails or times out

### Reputation System
- Uptime score (% time available)
- Success rate (completed sessions / total)
- Bandwidth reliability (actual vs. promised speed)
- Reputation affects task routing priority

## Roadmap

### Phase 1: Proxy Network ← *Current*
Decentralized mobile proxy network. Phones serve as SOCKS5/HTTP proxy nodes. Agents pay per-session via Solana escrow. Focus on reliability, speed, and global coverage.

### Phase 2: Full Device Control (DroidRun OSS)
Leverage [DroidRun](https://github.com/droidrun/droidrun) (7.7k+ ⭐) to give agents full control of phone UI — tap screens, use apps, fill forms, navigate browsers. Turns every phone into a remote automation worker.

## Revenue Model

```
Agent pays:              $X per proxy session
Phone owner receives:    70% of $X
Platform fee:            30% of $X
```

At scale: thousands of phones × hundreds of agent sessions/day = significant volume on micro-transactions only Solana can handle (<$0.001 per tx).

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Payments & Registry | Solana (devnet → mainnet) |
| Phone Proxy APK | Android / Kotlin |
| Tunnel Protocol | WireGuard |
| Router API | Node.js + Express |
| Phase 2 Device Control | [DroidRun OSS](https://github.com/droidrun/droidrun) |

## Project Structure

```
clawdbot-network/
├── contracts/              # Solana on-chain integration
│   ├── device-registry.ts  # Phone registration & metadata
│   ├── task-escrow.ts      # Session payment escrow
│   └── deploy.ts           # Deployment scripts
├── api/                    # Router API
│   ├── server.ts           # Proxy & device endpoints
│   └── proxy-session.ts    # Proxy tunnel session manager
├── demo/                   # End-to-end demo
│   └── full-demo.ts        # Complete proxy flow demo
└── README.md
```

## Quick Start

```bash
# Install dependencies
npm install

# Run the demo (registers phone, creates proxy session, escrows payment)
npx ts-node demo/full-demo.ts

# Start the router API
npx ts-node api/server.ts
```

## Why Now

- **AI agent explosion** — every agent framework needs web access, and they're all blocked
- **3.5B unused phones** — massive untapped supply sitting in drawers worldwide
- **Solana micropayments** — only chain fast/cheap enough for per-request billing
- **DePIN momentum** — proven model (Helium for coverage, we do proxies)
- **$4.5B proxy market** — and AI agents are the fastest-growing demand segment

## Tags

`depin` · `payments` · `infra` · `consumer` · `ai-agents` · `mobile-proxy` · `solana`

## License

MIT
