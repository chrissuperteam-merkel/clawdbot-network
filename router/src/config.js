/**
 * Clawdbot Network — Router Configuration
 */
module.exports = {
  PORT: parseInt(process.env.PORT) || 3001,
  PROXY_PORT: parseInt(process.env.PROXY_PORT) || 1080,
  SOLANA_RPC: process.env.SOLANA_RPC || 'https://api.devnet.solana.com',
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'devnet',

  // Platform fee split: node owner gets 70%, platform gets 30%
  NODE_SHARE: 0.70,
  PLATFORM_SHARE: 0.30,

  // Session pricing (in SOL) — legacy/fallback
  SESSION_COST_SOL: 0.005,         // Cost per proxy session
  MIN_ESCROW_SOL: 0.005,           // Minimum escrow deposit

  // Dynamic pricing tiers (SOL per GB) based on stealth score
  PRICING_TIERS: {
    premium: 0.01,      // Stealth 80-100 (mobile)
    residential: 0.005,  // Stealth 50-79 (residential wifi)
    basic: 0.002,        // Stealth 0-49 (unknown)
  },

  // x402 USDC pricing (alternative to SOL escrow)
  USDC_MINT: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',  // Solana mainnet USDC
  USDC_SESSION_PRICE: '0.01',       // $0.01 per session
  USDC_PER_GB: '2.00',              // $2.00 per GB
  X402_FACILITATOR_URL: process.env.X402_FACILITATOR_URL || 'https://x402.org/facilitator',
  X402_ENABLED: process.env.X402_ENABLED === 'true' || false,

  // Timeouts
  SESSION_TIMEOUT_MS: 5 * 60 * 1000,    // 5 min idle timeout
  PROXY_REQUEST_TIMEOUT_MS: 15000,       // 15s per request
  NODE_HEARTBEAT_INTERVAL_MS: 30000,     // 30s heartbeat
  NODE_HEARTBEAT_TIMEOUT_MS: 5 * 60 * 1000, // 5 min before disconnect

  // Payment enforcement (false for devnet, true for mainnet)
  REQUIRE_PAYMENT: process.env.REQUIRE_PAYMENT === 'true' || false,

  // Rate limiting
  MAX_SESSIONS_PER_KEY: 10,
  MAX_SESSIONS_PER_NODE: 5,
  MAX_REQUESTS_PER_MINUTE: 60,

  // Platform wallet (receives platform share)
  PLATFORM_WALLET: process.env.PLATFORM_WALLET || '2hRGZqn5hZgr2U6A9ihYxTGoZNnt7XhzNkJCE5eiF5UB',
  PLATFORM_KEYPAIR_PATH: process.env.PLATFORM_KEYPAIR || `${process.env.HOME}/.config/solana/id.json`,
};
