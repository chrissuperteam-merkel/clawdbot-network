# Clawdbot Network 📱⛓️

**Turn old smartphones into AI agent nodes. Earn crypto while your old phone works.**

> Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) on Solana.

## The Problem

3.5 billion old smartphones sit unused in drawers worldwide — another billion added every year. Meanwhile, AI agents are stuck in the cloud: they can call APIs but can't use real apps, real cameras, or real mobile networks. Every service that blocks bots (banking, social media, delivery apps) is unreachable for cloud-based agents.

Old phones have everything agents need: screens, cameras, GPS, mobile IPs, app stores. They're just collecting dust.

## The Solution

**Clawdbot Network** turns old smartphones into nodes in a decentralized mobile compute network.

1. **Install the app** on your old Android phone
2. **Phone becomes a Clawdbot node** — available for AI agent tasks
3. **Agents rent your device** — pay per task in USDC/SOL via Solana
4. **You earn passively** — phone on charger + WiFi = income

### What agents can do on your phone:
- 📱 Use any app (browser, social media, banking, delivery)
- 📸 Take photos and screenshots
- 🌐 Browse with a real mobile IP (undetectable)
- 📍 Access GPS, sensors, real device fingerprint
- 🔄 Multi-step workflows across multiple apps

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Task Creator  │────▶│  Clawdbot Router │────▶│  Device Node     │
│ (Agent/Human) │     │  (Task Matching) │     │  (Old Phone)     │
└──────┬───────┘     └────────┬─────────┘     └────────┬─────────┘
       │                      │                         │
       ▼                      ▼                         ▼
┌──────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Pay SOL/USDC │     │ Escrow & Match   │     │ Execute & Claim  │
│ → Escrow PDA │     │ On-Chain State   │     │ Proof + Payment  │
└──────────────┘     └──────────────────┘     └──────────────────┘
```

## How It Works

### For Device Owners (Supply)
```bash
# 1. Install Clawdbot app on old Android phone
# 2. Register device on Solana
curl -X POST http://api.clawdbot.network/devices/register \
  -d '{"deviceId": "my-old-pixel", "wallet": "YOUR_SOLANA_WALLET"}'

# 3. Phone auto-accepts tasks, you earn SOL/USDC
```

### For Task Creators (Demand)
```bash
# 1. Create a task with payment
curl -X POST http://api.clawdbot.network/tasks/create \
  -d '{
    "description": "Open Chrome, search for pizza near me, screenshot results",
    "reward_lamports": 10000000,
    "creator_wallet": "YOUR_WALLET"
  }'

# 2. Task gets assigned to available device
# 3. Device executes, result hash stored on-chain
# 4. Payment released automatically
```

## Solana Integration

- **Device Registry**: Each phone is registered on-chain with its capabilities and owner wallet
- **Task Escrow**: Payments locked in escrow PDAs, released on task completion
- **Proof of Execution**: Task results hashed (SHA-256) and stored via Memo program
- **Micropayments**: Solana's low fees (<$0.001) make per-task payments viable

## Revenue Model

```
Task Creator pays:    $X per task
Device Owner receives: 70% of $X
Platform fee:          30% of $X
```

No subscriptions. No tokens. Just transaction fees on real work.

## Tech Stack

- **Device Control**: [DroidRun](https://github.com/droidrun/droidrun) (7.7k ⭐) — open-source mobile agent framework
- **Blockchain**: Solana (devnet) — escrow, payments, proofs
- **API**: Node.js + Express — task routing and device management
- **Cloud API**: Mobilerun — remote device orchestration

## Demo

Live demo on a real Solana Seeker device:

1. Device registered on Solana devnet
2. Task created with SOL escrow
3. Task routed to Seeker via Mobilerun API
4. Agent executes task on real phone
5. Result hash committed on-chain
6. Payment released to device owner

## Project Structure

```
clawdbot-network/
├── contracts/          # Solana integration (TypeScript)
│   ├── device-registry.ts
│   ├── task-escrow.ts
│   └── deploy.ts
├── api/               # Router API
│   ├── server.ts
│   └── mobilerun.ts
├── demo/              # End-to-end demo scripts
│   └── full-demo.ts
├── PLAN.md
└── README.md
```

## Why Now

- **3.5B unused phones** — massive untapped supply of mobile compute
- **AI agents need real devices** — cloud can't access real apps
- **DePIN for mobile** — Helium did coverage, we do compute
- **Solana micropayments** — only chain fast/cheap enough for per-task payments
- **Framework exists** — DroidRun already controls Android/iOS with AI

## License

MIT
