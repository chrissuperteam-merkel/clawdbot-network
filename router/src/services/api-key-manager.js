/**
 * ApiKeyManager — Manages API keys for agent authentication
 *
 * For devnet: simple in-memory store with file persistence
 * For production: replace with DB-backed store
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEYS_FILE = path.join(__dirname, '../../data/api-keys.json');

class ApiKeyManager {
  constructor() {
    this.keys = new Map(); // apiKey -> { wallet, label, createdAt, requestCount, active }
    this._load();
  }

  /**
   * Generate a new API key for an agent
   */
  create({ wallet, label }) {
    const apiKey = `cb_${crypto.randomBytes(24).toString('hex')}`;
    const entry = {
      wallet: wallet || null,
      label: label || 'unnamed',
      createdAt: Date.now(),
      requestCount: 0,
      active: true,
    };
    this.keys.set(apiKey, entry);
    this._save();
    console.log(`[AUTH] API key created: ${apiKey.slice(0, 12)}... (${label})`);
    return { apiKey, ...entry };
  }

  /**
   * Validate an API key
   */
  validate(apiKey) {
    if (!apiKey) return null;
    const entry = this.keys.get(apiKey);
    if (!entry || !entry.active) return null;
    entry.requestCount++;
    return entry;
  }

  /**
   * Revoke an API key
   */
  revoke(apiKey) {
    const entry = this.keys.get(apiKey);
    if (!entry) return false;
    entry.active = false;
    this._save();
    return true;
  }

  /**
   * List all keys (redacted)
   */
  list() {
    const result = [];
    for (const [key, entry] of this.keys) {
      result.push({
        apiKey: `${key.slice(0, 12)}...${key.slice(-4)}`,
        ...entry,
      });
    }
    return result;
  }

  _load() {
    try {
      if (fs.existsSync(KEYS_FILE)) {
        const data = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
        for (const [k, v] of Object.entries(data)) {
          this.keys.set(k, v);
        }
        console.log(`[AUTH] Loaded ${this.keys.size} API keys`);
      }
    } catch (e) {
      console.warn(`[AUTH] Could not load keys: ${e.message}`);
    }
  }

  _save() {
    try {
      const dir = path.dirname(KEYS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(this.keys);
      fs.writeFileSync(KEYS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
      console.warn(`[AUTH] Could not save keys: ${e.message}`);
    }
  }
}

module.exports = ApiKeyManager;
