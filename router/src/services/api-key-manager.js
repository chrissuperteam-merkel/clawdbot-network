/**
 * ApiKeyManager — Manages API keys for agent authentication
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { child } = require('./logger');

const log = child('auth');
const KEYS_FILE = path.join(__dirname, '../../data/api-keys.json');

class ApiKeyManager {
  constructor() {
    this.keys = new Map();
    this._load();
  }

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
    log.info({ key: apiKey.slice(0, 12), label }, 'API key created');
    return { apiKey, ...entry };
  }

  validate(apiKey) {
    if (!apiKey) return null;
    const entry = this.keys.get(apiKey);
    if (!entry || !entry.active) return null;
    entry.requestCount++;
    return entry;
  }

  revoke(apiKey) {
    const entry = this.keys.get(apiKey);
    if (!entry) return false;
    entry.active = false;
    this._save();
    return true;
  }

  list() {
    const result = [];
    for (const [key, entry] of this.keys) {
      result.push({ apiKey: `${key.slice(0, 12)}...${key.slice(-4)}`, ...entry });
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
        log.info({ count: this.keys.size }, 'Loaded API keys');
      }
    } catch (e) {
      log.warn({ err: e.message }, 'Could not load keys');
    }
  }

  _save() {
    try {
      const dir = path.dirname(KEYS_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const obj = Object.fromEntries(this.keys);
      fs.writeFileSync(KEYS_FILE, JSON.stringify(obj, null, 2));
    } catch (e) {
      log.warn({ err: e.message }, 'Could not save keys');
    }
  }
}

module.exports = ApiKeyManager;
