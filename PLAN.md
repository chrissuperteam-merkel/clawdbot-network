# Clawdbot Network — Build Plan

## Deadline: Feb 13, 17:00 UTC

## Core Thesis

AI agents need mobile proxies. Old phones have mobile IPs. Connect them via Solana micropayments.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   AI Agent       │────▶│  Clawdbot Router │────▶│  Phone Proxy     │
│  (requests proxy)│     │  (session mgmt)  │     │  (SOCKS5/HTTP)   │
└──────────────────┘     └──────────────────┘     └──────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Solana: Escrow   │     │ Solana: Registry │     │ Solana: Payment  │
│ SOL for session  │     │ device metadata  │     │ released on done │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## Components

### Track 1: Solana On-Chain
- **Device Registry**: register phone as proxy node (specs, carrier, location, wallet)
- **Session Escrow**: agent deposits SOL → session runs → payment released to phone owner
- **Reputation**: uptime, success rate, bandwidth reliability scores
- Target: Devnet deployment

### Track 2: Router API (Node.js)
- `POST /proxy/request` — agent requests a proxy session (country, carrier, duration)
- `GET /proxy/nodes` — list available proxy nodes
- `POST /device/register` — phone registers as proxy node
- `GET /device/list` — list registered devices
- Session lifecycle management (create → active → complete)

### Track 3: Proxy Session Manager
- WireGuard tunnel setup between router and phone
- SOCKS5/HTTP proxy protocol handling
- Bandwidth metering and session tracking
- IP rotation via airplane mode toggle

### Track 4: Demo + Submission
- End-to-end demo: register phone → agent requests proxy → escrow SOL → route traffic → release payment
- README with architecture, market opportunity, roadmap
- Colosseum submission

## Roadmap
- **Phase 1** (hackathon): Proxy network MVP — registration, escrow, session routing
- **Phase 2** (post-hackathon): Full device control via DroidRun OSS — agents control phone UI

## Timeline
- Hour 1-2: Solana contracts + API skeleton
- Hour 3-4: Proxy session manager + integration
- Hour 5-6: Demo on real device
- Hour 7-8: Polish, README, submit
