# Clawdbot Client SDK

JavaScript SDK for the Clawdbot mobile proxy network.

## Quick Start

```js
const ClawdbotClient = require('./clawdbot-client');

const client = new ClawdbotClient({
  apiKey: 'your-api-key',
  baseUrl: 'http://localhost:3001',
});

// List available nodes
const { nodes } = await client.listNodes({ country: 'DE' });

// Create a session
const session = await client.createSession({ country: 'DE', minStealth: 50 });

// Fetch through proxy
const result = await client.fetch(session.sessionId, 'https://httpbin.org/ip');

// Rotate IP
const rotated = await client.rotateIp(session.sessionId);

// End session
const summary = await client.endSession(session.sessionId);
console.log('Cost:', summary.cost);
```

## API

- `listNodes({ country?, carrier? })` — List online proxy nodes
- `createSession({ country?, carrier?, minStealth?, wallet? })` — Create proxy session
- `fetch(sessionId, url)` — Fetch URL through proxy
- `rotateIp(sessionId)` — Get new IP (mobile airplane mode toggle)
- `endSession(sessionId)` — End session, get cost
- `getSession(sessionId)` — Get session info
- `health()` — Health check
