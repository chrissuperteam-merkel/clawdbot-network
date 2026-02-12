# CLAW Token — Clawdbot Network Incentive Design

## Token Overview

| Property | Value |
|----------|-------|
| **Name** | CLAW |
| **Standard** | SPL Token (Solana) |
| **Total Supply** | 1,000,000,000 (1B) |
| **Decimals** | 9 |
| **Network** | Solana Devnet → Mainnet |

## Utility

### 1. Pay for Proxy Access
- AI agents pay CLAW tokens for proxy sessions
- Price tiers: Premium (5G) = 10 CLAW/GB, Residential (4G) = 5 CLAW/GB, Basic (WiFi) = 2 CLAW/GB
- SOL payment remains as alternative (dual-token model)

### 2. Stake as Node Operator
- Node operators stake CLAW to signal reliability
- Higher stake → higher priority in node selection
- Slashing for downtime or malicious behavior (e.g., MITM attempts)
- Minimum stake: 1,000 CLAW

### 3. Governance
- Token holders vote on:
  - Fee structure changes
  - New feature priorities
  - Treasury allocation
  - Network parameter updates (min stake, slashing %)

## Distribution

| Allocation | % | Tokens | Vesting |
|-----------|---|--------|---------|
| **Node Rewards** | 40% | 400M | Emitted over 4 years, halving annually |
| **Agent Payments Pool** | 20% | 200M | Circulates via usage |
| **Team** | 15% | 150M | 1-year cliff, 3-year linear vest |
| **Community & Ecosystem** | 15% | 150M | Grants, bounties, partnerships |
| **Treasury** | 10% | 100M | DAO-controlled after 1 year |

## Inflation / Deflation Mechanics

### Inflationary Pressure
- Node reward emissions: 40% of supply over 4 years
- Year 1: 200M CLAW (~20% of supply)
- Year 2: 100M CLAW
- Year 3: 50M CLAW
- Year 4: 25M CLAW
- After Year 4: Governance decides continuation

### Deflationary Pressure
- **Fee Burns**: 5% of every proxy session fee is burned
- **Stake Slashing**: Slashed tokens are burned, not redistributed
- **Buyback & Burn**: 10% of platform revenue used to buy back and burn CLAW quarterly

### Net Effect
Target: Slightly deflationary after Year 2 as emissions decrease and burn increases with network usage.

## Revenue Split (Per Session)

| Recipient | % |
|-----------|---|
| Node Operator | 70% |
| Platform Treasury | 20% |
| Burn | 5% |
| Staker Rewards | 5% |

## Competitive Analysis

### vs GRASS (Wynd Network)
- GRASS: Points-based, no on-chain payments during usage
- CLAW: Real-time on-chain micropayments per session
- GRASS: Centralized node selection
- CLAW: Decentralized, stake-weighted selection
- Advantage: True DePIN with immediate utility

### vs MYST (Mysterium Network)
- MYST: ERC-20 on Ethereum (high gas fees)
- CLAW: SPL on Solana (sub-cent transactions)
- MYST: General VPN focus
- CLAW: AI agent-specific proxy (mobile IPs)
- Advantage: Lower fees, mobile-first, AI-native

### vs Nodepay
- Nodepay: Browser extension, bandwidth sharing
- CLAW: Real phone nodes with real mobile/residential IPs
- Nodepay: Points system pre-token
- CLAW: Token-from-day-one utility
- Advantage: Higher quality IPs (not datacenter browser extensions)

## Roadmap

### Phase 1: Devnet (Current)
- [ ] Deploy SPL Token on Solana Devnet
- [ ] Implement session payments in CLAW
- [ ] Faucet for testing (claim 1000 CLAW/day on devnet)
- [ ] Basic staking contract

### Phase 2: Testnet
- [ ] Staking with slashing
- [ ] Governance voting (Realms integration)
- [ ] Node reputation system tied to stake
- [ ] Burn mechanism active

### Phase 3: Mainnet Launch
- [ ] Token Generation Event (TGE)
- [ ] DEX listing (Raydium, Jupiter)
- [ ] Staking rewards live
- [ ] Full governance transition

### Phase 4: Ecosystem
- [ ] Cross-chain bridges (wCLAW on EVM)
- [ ] SDK token integration (pay with CLAW in one line)
- [ ] Partnership program for AI agent frameworks
- [ ] Mobile app token wallet integration
