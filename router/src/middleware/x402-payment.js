/**
 * x402 Payment Middleware — USDC payments via x402 protocol
 * 
 * Alternative payment method alongside the existing SOL escrow system.
 * When X402_ENABLED=true, clients can pay with USDC via the x402 protocol.
 * The SOL escrow system remains as fallback.
 */
const config = require('../config');
const { child } = require('../services/logger');

const log = child('x402');

/**
 * Express middleware that adds x402 payment as an alternative to SOL escrow.
 * If x402 is disabled or client provides escrowTx (SOL), passes through.
 * If x402 is enabled and no SOL escrow, checks for X-PAYMENT header (x402 receipt).
 */
function x402PaymentMiddleware() {
  return async (req, res, next) => {
    // If x402 is not enabled, skip entirely (SOL escrow handles payment)
    if (!config.X402_ENABLED) {
      return next();
    }

    // If client already provided SOL escrow tx, use legacy flow
    if (req.body && req.body.escrowTx) {
      return next();
    }

    // Check for x402 payment header
    const paymentHeader = req.headers['x-payment'];
    if (paymentHeader) {
      try {
        // Verify payment with the x402 facilitator
        const verified = await verifyX402Payment(paymentHeader);
        if (verified) {
          req.x402Paid = true;
          req.x402Receipt = paymentHeader;
          log.info('x402 USDC payment verified');
          return next();
        }
      } catch (err) {
        log.warn({ err: err.message }, 'x402 payment verification failed');
      }
    }

    // If REQUIRE_PAYMENT is true and no payment provided, return 402
    if (config.REQUIRE_PAYMENT && !req.body?.escrowTx && !req.x402Paid) {
      return res.status(402).json({
        error: 'Payment required',
        accepts: {
          x402: {
            scheme: 'exact',
            network: 'solana-mainnet',
            token: config.USDC_MINT,
            amount: config.USDC_SESSION_PRICE,
            recipient: config.PLATFORM_WALLET,
            facilitator: config.X402_FACILITATOR_URL,
            description: 'Clawdbot proxy session — route traffic through real mobile phone IPs',
          },
          sol_escrow: {
            amount: config.SESSION_COST_SOL,
            currency: 'SOL',
            recipient: config.PLATFORM_WALLET,
            network: config.SOLANA_NETWORK,
          },
        },
      });
    }

    // No payment but REQUIRE_PAYMENT=false (devnet mode) — pass through
    next();
  };
}

/**
 * Verify x402 payment receipt with the facilitator
 */
async function verifyX402Payment(paymentHeader) {
  try {
    const resp = await fetch(`${config.X402_FACILITATOR_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        payment: paymentHeader,
        payTo: config.PLATFORM_WALLET,
        amount: config.USDC_SESSION_PRICE,
        token: config.USDC_MINT,
        network: 'solana-mainnet',
      }),
    });
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.valid === true;
  } catch (err) {
    log.error({ err: err.message }, 'Failed to contact x402 facilitator');
    return false;
  }
}

/**
 * x402 Bazaar service descriptor for discovery
 */
function getBazaarDescriptor() {
  return {
    name: 'clawdbot-proxy',
    description: 'Route traffic through real mobile phone IPs',
    version: '1.0.0',
    pricing: {
      scheme: 'exact',
      network: 'solana-mainnet',
      token: config.USDC_MINT,
      amount: config.USDC_SESSION_PRICE,
      recipient: config.PLATFORM_WALLET,
      facilitator: config.X402_FACILITATOR_URL,
    },
    input: {
      type: 'object',
      properties: {
        targetUrl: { type: 'string', description: 'URL to route through proxy' },
        country: { type: 'string', description: 'Country code filter (optional)' },
        carrier: { type: 'string', description: 'Mobile carrier filter (optional)' },
      },
      required: ['targetUrl'],
    },
    output: {
      type: 'object',
      properties: {
        proxyIp: { type: 'string', description: 'IP address of the proxy node' },
        carrier: { type: 'string', description: 'Mobile carrier of the proxy' },
        country: { type: 'string', description: 'Country of the proxy' },
        sessionId: { type: 'string', description: 'Session ID for subsequent requests' },
      },
    },
    endpoint: '/proxy/session',
    method: 'POST',
  };
}

module.exports = { x402PaymentMiddleware, getBazaarDescriptor };
