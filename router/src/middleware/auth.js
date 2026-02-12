/**
 * Authentication middleware
 */
const config = require('../config');

/**
 * Require valid API key in Authorization header
 * Passes if valid, rejects with 401 otherwise
 * Sets req.agent = { wallet, label, ... }
 */
function requireApiKey(apiKeyManager) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const apiKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : req.headers['x-api-key'] || req.query.apiKey;

    if (!apiKey) {
      return res.status(401).json({
        error: 'Authentication required',
        hint: 'Set Authorization: Bearer <api-key> or X-Api-Key header',
      });
    }

    const agent = apiKeyManager.validate(apiKey);
    if (!agent) {
      return res.status(401).json({ error: 'Invalid or revoked API key' });
    }

    req.agent = agent;
    req.apiKey = apiKey;
    next();
  };
}

/**
 * Optional API key — passes even without key (for public endpoints)
 */
function optionalApiKey(apiKeyManager) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'] || '';
    const apiKey = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : req.headers['x-api-key'] || req.query.apiKey;

    if (apiKey) {
      req.agent = apiKeyManager.validate(apiKey);
      req.apiKey = apiKey;
    }
    next();
  };
}

/**
 * Rate limiter per API key
 */
function rateLimit() {
  const windows = new Map(); // key -> { count, resetAt }

  return (req, res, next) => {
    const key = req.apiKey || req.ip;
    const now = Date.now();
    let window = windows.get(key);

    if (!window || now > window.resetAt) {
      window = { count: 0, resetAt: now + 60000 };
      windows.set(key, window);
    }

    window.count++;
    res.setHeader('X-RateLimit-Limit', config.MAX_REQUESTS_PER_MINUTE);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, config.MAX_REQUESTS_PER_MINUTE - window.count));

    if (window.count > config.MAX_REQUESTS_PER_MINUTE) {
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: Math.ceil((window.resetAt - now) / 1000) });
    }

    next();
  };
}

module.exports = { requireApiKey, optionalApiKey, rateLimit };
