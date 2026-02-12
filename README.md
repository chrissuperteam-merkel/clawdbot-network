# Clawdbot Network 📱⛓️

**Turn old smartphones into AI agent nodes. Earn crypto while your old phone works.**

> Built for the [Colosseum Agent Hackathon](https://colosseum.com/agent-hackathon) on Solana.

## The Problem

3.5 billion old smartphones sit unused in drawers worldwide — another billion added every year. Meanwhile, AI agents are stuck in the cloud: they can call APIs but can't use real apps, real cameras, or real mobile networks. Every service that blocks bots (banking, social media, delivery apps) is unreachable for cloud-based agents.

Old phones have everything agents need: screens, cameras, GPS, mobile IPs, app stores. They're just collecting dust.

## The Solution

**Clawdbot Network** turns old smartphones into nodes in a decentralized mobile compute network.

1. **Install [DroidRun](https://github.com/droidrun/droidrun)** on your old Android phone (open-source, 7.7k+ ⭐)
2. **Register on-chain** — your device gets a Solana identity
3. **Receive tasks peer-to-peer** — agents send tasks directly to your phone via local network/ADB
4. **Earn passively** — phone on charger + WiFi = income, paid in SOL/USDC

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
│ Pay SOL/USDC │     │ Escrow & Match   │     │ DroidRun Agent   │
│ → Escrow PDA │     │ On-Chain State   │     │ (Local ADB/P2P)  │
└──────────────┘     └──────────────────┘     └──────────────────┘
```

**No cloud API. No hosted service. Fully peer-to-peer.**

The Clawdbot Router matches tasks to devices. DroidRun executes tasks locally on the phone via ADB — the LLM controls the real Android UI directly.

## Device Control: DroidRun OSS

We use **[DroidRun](https://github.com/droidrun/droidrun)** (7.7k+ ⭐) — an open-source Android agent framework that lets LLMs control real phones.

- **Fully open-source** — no paid API, no hosted service
- **Local execution** — tasks run via ADB (USB or WiFi), not through any cloud
- **LLM-powered** — supports OpenAI, Anthropic, and other providers
- **Real device control** — tap, swipe, type, screenshot, navigate apps

### How it works:
1. Phone owner installs DroidRun agent + enables ADB
2. Phone registers on Solana (gets on-chain identity)
3. Router assigns tasks → DroidRun executes locally via ADB
4. Proof of execution stored on-chain → payment released

## How It Works

### For Device Owners (Supply)
```bash
# 1. Install DroidRun on your Android phone
#    See: https://github.com/droidrun/droidrun
pip install droidrun

# 2. Enable ADB on your phone and connect via WiFi
adb connect 192.168.1.42:5555

# 3. Register device on Solana
npx ts-node demo/full-demo.ts

# 4. Phone receives tasks via local network, you earn SOL/USDC
```

### For Task Creators (Demand)
```typescript
import { executeTask } from './api/device-executor';

// Task gets routed to a registered device and executed locally
const result = await executeTask('seeker-001', 
  'Open Chrome, search for pizza near me, screenshot results'
);
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

- **Device Control**: [DroidRun](https://github.com/droidrun/droidrun) — open-source Android agent framework (7.7k+ ⭐)
- **Blockchain**: Solana (devnet) — escrow, payments, proofs
- **API**: Node.js + Express — task routing and device management
- **Connection**: ADB over USB/WiFi — fully local, no cloud dependency

## Setup

```bash
# Install DroidRun
pip install droidrun

# Install Node dependencies
npm install

# Configure devices in ~/.config/clawdbot/config.json
cat > ~/.config/clawdbot/config.json << 'EOF'
{
  "devices": {
    "seeker-001": {
      "adb_target": "192.168.1.42:5555",
      "llm_model": "gpt-4o"
    }
  },
  "default_device": "seeker-001",
  "llm_api_key": "your-openai-key"
}
EOF

# Connect your phone via ADB
adb connect 192.168.1.42:5555

# Run the demo
npx ts-node demo/full-demo.ts
```

## Demo

Live demo on a real Solana Seeker device:

1. Device registered on Solana devnet
2. Task created with SOL escrow
3. Task routed to Seeker via **DroidRun OSS** (local ADB)
4. Agent executes task on real phone — no cloud, fully local
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
│   └── device-executor.ts   # DroidRun OSS integration
├── demo/              # End-to-end demo scripts
│   └── full-demo.ts
└── README.md
```

## Why Now

- **3.5B unused phones** — massive untapped supply of mobile compute
- **AI agents need real devices** — cloud can't access real apps
- **DePIN for mobile** — Helium did coverage, we do compute
- **Solana micropayments** — only chain fast/cheap enough for per-task payments
- **[DroidRun](https://github.com/droidrun/droidrun) exists** — battle-tested OSS framework for Android AI agents (7.7k+ ⭐)

## License

MIT
