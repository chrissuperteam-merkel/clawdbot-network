/**
 * ClawdbotClient — JavaScript SDK for the Clawdbot mobile proxy network
 */
class ClawdbotClient {
  constructor({ apiKey, baseUrl = 'http://localhost:3001' }) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  async _request(method, path, body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`${this.baseUrl}${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  /** List available proxy nodes */
  async listNodes({ country, carrier } = {}) {
    const params = new URLSearchParams();
    if (country) params.set('country', country);
    if (carrier) params.set('carrier', carrier);
    const qs = params.toString();
    return this._request('GET', `/nodes${qs ? '?' + qs : ''}`);
  }

  /** Create a proxy session */
  async createSession({ country, carrier, minStealth, wallet } = {}) {
    return this._request('POST', '/proxy/session', { country, carrier, minStealth, wallet });
  }

  /** Fetch a URL through the proxy */
  async fetch(sessionId, url) {
    return this._request('GET', `/proxy/fetch?url=${encodeURIComponent(url)}`);
  }

  /** End a proxy session */
  async endSession(sessionId) {
    return this._request('POST', `/proxy/session/${sessionId}/end`);
  }

  /** Rotate IP for a session */
  async rotateIp(sessionId) {
    return this._request('POST', `/proxy/session/${sessionId}/rotate`);
  }

  /** Get session info */
  async getSession(sessionId) {
    return this._request('GET', `/proxy/session/${sessionId}`);
  }

  /** Health check */
  async health() {
    return this._request('GET', '/admin/health');
  }
}

module.exports = ClawdbotClient;
