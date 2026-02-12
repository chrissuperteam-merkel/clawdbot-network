# Clawdbot Network

## Description
Decentralized mobile proxy network for AI agents. Turn old smartphones into proxy nodes and earn SOL. Agents pay per-request via Solana micropayments for mobile IPs that bypass blocks.

## When to Use
- Agent needs mobile IP addresses (bypass datacenter blocks)
- Avoiding CAPTCHAs and rate limits
- Web scraping without getting flagged
- Accessing geo-restricted content
- Need cheap mobile proxies (vs $10-15/GB commercial)

## For Agents (Using Proxies)

```typescript
import { ClawdbotClient } from '@clawdbot/sdk';

const client = new ClawdbotClient({
  wallet: yourSolanaKeypair,
  network: 'mainnet'
});

// Make request through mobile proxy
const response = await client.fetch('https://target-site.com', {
  country: 'US',        // Optional: geo filter
  carrier: 'verizon',   // Optional: carrier filter
  maxCostLamports: 1000 // Budget per request
});
```

## For Node Operators (Earning SOL)

1. Install APK on old Android phone
2. Register on-chain with stake
3. Phone auto-serves requests when on WiFi
4. Earn SOL per request served

## Pricing
- ~0.001 SOL per request (varies by demand)
- No minimums, no subscriptions
- Pay-per-use via Solana micropayments

## Links
- Repository: https://github.com/chrissuperteam-merkel/clawdbot-network
- APK: See releases
