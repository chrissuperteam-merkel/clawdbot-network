# Clawdbot Network — Build Plan

## Deadline: Feb 13, 17:00 UTC (~29h)

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Task Creator    │────▶│  Clawdbot Router │────▶│  Device (Phone) │
│  (pays USDC)     │     │  (API Server)    │     │  (runs task)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Solana: Pay USDC│     │ Solana: Escrow    │     │ Solana: Claim   │
│ to escrow PDA   │     │ match + release   │     │ payment on done │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Components (3 parallel tracks)

### Track 1: Solana Smart Contracts (TypeScript with @solana/web3.js)
- Device Registry: register device, store metadata (device_id, capabilities, wallet)
- Task Escrow: create_task (lock USDC) → assign_device → complete_task → release_payment
- On-chain proofs: hash of task result stored as memo
- Target: Devnet deployment

### Track 2: Router API (Node.js)
- POST /devices/register — register a device + wallet
- POST /tasks/create — create task, lock payment
- POST /tasks/complete — device submits result, triggers payment
- GET /devices — list available devices
- GET /tasks — list tasks
- Integration with device control API for actual device execution

### Track 3: Demo + Submission
- End-to-end demo: create task → route to Seeker → execute → pay
- README with architecture diagram
- Video/screenshots of real device execution
- Colosseum submission (all 6 required fields)

## Timeline
- Hour 1-2: Solana programs + API skeleton
- Hour 3-4: Integration + device API connection
- Hour 5-6: Demo on real device
- Hour 7-8: Polish, README, submit

## Tech Stack
- Solana devnet + @solana/web3.js + SPL Token
- Node.js API (Express)
- Device control API for remote execution
- AgentWallet for Solana wallet ops
