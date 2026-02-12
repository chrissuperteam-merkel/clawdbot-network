# Node Onboarding Guide — For Phone Owners

## Start Earning in 3 Minutes

### Step 1: Download the APK
- Visit: `https://static.114.67.225.46.clients.your-server.de/clawdbot/onboard.html`
- Or scan the QR code (see below)
- Download `clawdbot-proxy.apk` to your Android phone

### Step 2: Install & Open
1. Open the downloaded APK file
2. If prompted, enable "Install from unknown sources" in Settings
3. Tap **Install**
4. Open **Clawdbot Proxy**
5. Grant all requested permissions (network access)

### Step 3: Start Earning
1. Tap the big **START PROXY** button
2. That's it! Your phone is now a proxy node
3. You'll see live stats: connections, bytes routed, earnings

## Requirements
- Android 8.0+ (API 26+)
- WiFi or mobile data connection
- No root required
- Works on any Android phone (Samsung, Pixel, Xiaomi, Solana Seeker, etc.)

## Estimated Earnings
| Connection Type | Tier | Price/GB | Est. Monthly* |
|----------------|------|----------|---------------|
| 5G Mobile | Premium | 0.01 SOL | 0.5-2 SOL |
| 4G/LTE | Residential | 0.005 SOL | 0.2-1 SOL |
| WiFi | Basic | 0.002 SOL | 0.1-0.5 SOL |

*Depends on network demand and uptime

## QR Code Concept
Each onboarding URL can include a referral code:
```
https://static.114.67.225.46.clients.your-server.de/clawdbot/onboard.html?ref=YOUR_WALLET
```

The QR code encodes this URL. When a new node installs via your referral:
- You earn 5% of their proxy earnings for 90 days
- They get a 100 CLAW welcome bonus (when token launches)

QR codes can be generated programmatically using any QR library or printed on stickers for physical distribution at events.

## Troubleshooting

**App won't install?**
→ Enable "Install from unknown sources" in Android Settings > Security

**Can't connect to network?**
→ Check WiFi/mobile data is active. The app connects to `wss://static.114.67.225.46.clients.your-server.de/clawdbot/node`

**No earnings showing?**
→ Earnings appear when agents route traffic through your node. Keep the app running and connected.

**Battery drain?**
→ Minimal. The proxy runs as a lightweight background service. Expect <5% extra battery usage per day.
