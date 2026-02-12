/**
 * TCP Proxy — HTTP/HTTPS CONNECT + SOCKS5 proxy for agents
 * Fix 6: Authentication required
 * Fix 10: Rate limiting per source IP
 */
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { WebSocket } = require('ws');
const config = require('./config');
const { child } = require('./services/logger');

const log = child('tcp-proxy');

// Fix 10: Rate limiting state
const connCountPerIp = new Map();   // ip -> current concurrent count
const connRatePerIp = new Map();    // ip -> { count, resetAt }
const MAX_CONCURRENT = 10;
const MAX_PER_MINUTE = 100;

function checkRateLimit(ip) {
  // Concurrent check
  const concurrent = connCountPerIp.get(ip) || 0;
  if (concurrent >= MAX_CONCURRENT) return false;

  // Per-minute check
  const now = Date.now();
  let rate = connRatePerIp.get(ip);
  if (!rate || now > rate.resetAt) {
    rate = { count: 0, resetAt: now + 60000 };
    connRatePerIp.set(ip, rate);
  }
  if (rate.count >= MAX_PER_MINUTE) return false;

  rate.count++;
  connCountPerIp.set(ip, concurrent + 1);
  return true;
}

function releaseConnection(ip) {
  const c = connCountPerIp.get(ip) || 1;
  if (c <= 1) connCountPerIp.delete(ip);
  else connCountPerIp.set(ip, c - 1);
}

function createTcpProxy(nodeManager, sessionManager, pendingRequests, apiKeyManager) {
  const proxyServer = net.createServer((clientSocket) => {
    const clientIp = clientSocket.remoteAddress;

    // Fix 10: Rate limit
    if (!checkRateLimit(clientIp)) {
      log.warn({ ip: clientIp }, 'Rate limit exceeded on TCP proxy');
      clientSocket.destroy();
      return;
    }

    clientSocket.on('close', () => releaseConnection(clientIp));
    clientSocket.on('error', () => releaseConnection(clientIp));

    let headerData = Buffer.alloc(0);

    clientSocket.once('data', (chunk) => {
      headerData = Buffer.concat([headerData, chunk]);

      // SOCKS5 detection
      if (headerData[0] === 0x05) {
        handleSocks5(clientSocket, headerData, nodeManager, sessionManager, pendingRequests, apiKeyManager);
        return;
      }

      const headerStr = headerData.toString();

      // Fix 6: Extract auth from Proxy-Authorization or X-Session-Id
      const sessionMatch = headerStr.match(/X-Session-Id:\s*([^\r\n]+)/i);
      const sessionId = sessionMatch ? sessionMatch[1].trim() : null;
      let session = sessionId ? sessionManager.get(sessionId) : null;

      const proxyAuthMatch = headerStr.match(/Proxy-Authorization:\s*Basic\s+([^\r\n]+)/i);
      let authApiKey = null;
      if (proxyAuthMatch) {
        try {
          const decoded = Buffer.from(proxyAuthMatch[1].trim(), 'base64').toString();
          const [user] = decoded.split(':');
          authApiKey = user;
        } catch {}
      }

      // Also check X-Api-Key header
      const apiKeyMatch = headerStr.match(/X-Api-Key:\s*([^\r\n]+)/i);
      if (apiKeyMatch) authApiKey = apiKeyMatch[1].trim();

      // Fix 6: Require auth
      if (!session && !authApiKey) {
        clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="ClawdBot Proxy"\r\nContent-Type: application/json\r\n\r\n{"error":"Authentication required. Use Proxy-Authorization header or X-Session-Id."}\r\n');
        clientSocket.end();
        return;
      }

      // Validate API key if provided
      if (authApiKey && apiKeyManager) {
        const agent = apiKeyManager.validate(authApiKey);
        if (!agent) {
          clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Type: application/json\r\n\r\n{"error":"Invalid API key"}\r\n');
          clientSocket.end();
          return;
        }
      }

      // Auto-create session if none
      if (!session) {
        const match = nodeManager.findNode();
        if (!match) {
          clientSocket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{"error":"No proxy nodes online"}\r\n');
          clientSocket.end();
          return;
        }
        session = sessionManager.create({ nodeId: match.nodeId, apiKey: authApiKey || 'auto' });
      }

      const node = nodeManager.get(session.nodeId);
      if (!node || node.ws.readyState !== WebSocket.OPEN) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\n\r\n{"error":"Proxy node disconnected"}\r\n');
        clientSocket.end();
        return;
      }

      const requestId = uuidv4();
      // Fix 4: data FROM client TO phone = bytesOut
      sessionManager.recordActivity(session.sessionId, 0, chunk.length);

      // HTTPS CONNECT tunnel
      const connectMatch = headerStr.match(/^CONNECT (.+):(\d+) HTTP/);
      if (connectMatch) {
        const targetHost = connectMatch[1];
        const targetPort = parseInt(connectMatch[2]);
        const pending = { socket: clientSocket, nodeId: session.nodeId, sessionId: session.sessionId, bufferedData: [], ready: false };
        pendingRequests.set(requestId, pending);

        node.ws.send(JSON.stringify({
          type: 'proxy_connect',
          requestId,
          sessionId: session.sessionId,
          host: targetHost,
          port: targetPort,
        }));

        log.info({ requestId: requestId.slice(0, 8), target: `${targetHost}:${targetPort}` }, 'CONNECT tunnel');

        const connectTimeout = setTimeout(() => {
          if (!pending.ready) {
            log.warn({ requestId: requestId.slice(0, 8) }, 'CONNECT timeout');
            clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
            clientSocket.end();
            pendingRequests.delete(requestId);
          }
        }, 15000);

        clientSocket.on('data', (d) => {
          // Fix 4: data FROM client TO phone = bytesOut
          sessionManager.recordActivity(session.sessionId, 0, d.length);
          if (!pending.ready) {
            pending.bufferedData.push(Buffer.from(d));
            return;
          }
          node.ws.send(JSON.stringify({
            type: 'proxy_data',
            requestId,
            sessionId: session.sessionId,
            data: d.toString('base64'),
          }));
        });

        clientSocket.on('close', () => clearTimeout(connectTimeout));
      } else {
        // Plain HTTP proxy
        pendingRequests.set(requestId, { socket: clientSocket, nodeId: session.nodeId, sessionId: session.sessionId });

        node.ws.send(JSON.stringify({
          type: 'proxy_http',
          requestId,
          sessionId: session.sessionId,
          rawRequest: chunk.toString('base64'),
        }));

        clientSocket.on('data', (d) => {
          sessionManager.recordActivity(session.sessionId, 0, d.length);
          node.ws.send(JSON.stringify({
            type: 'proxy_data',
            requestId,
            sessionId: session.sessionId,
            data: d.toString('base64'),
          }));
        });
      }

      clientSocket.on('close', () => pendingRequests.delete(requestId));
      clientSocket.on('error', () => pendingRequests.delete(requestId));
    });
  });

  return proxyServer;
}

function handleSocks5(clientSocket, initialData, nodeManager, sessionManager, pendingRequests, apiKeyManager) {
  // Fix 6: SOCKS5 with username/password auth (method 0x02)
  const nmethods = initialData[1];
  const methods = initialData.slice(2, 2 + nmethods);
  const hasUserPass = methods.includes(0x02);

  if (!hasUserPass) {
    // Require username/password auth
    clientSocket.write(Buffer.from([0x05, 0xFF])); // no acceptable method
    clientSocket.end();
    return;
  }

  // Request username/password auth
  clientSocket.write(Buffer.from([0x05, 0x02]));

  clientSocket.once('data', (authData) => {
    // Username/password auth: VER(1)=0x01 ULEN(1) UNAME(var) PLEN(1) PASSWD(var)
    if (authData[0] !== 0x01) {
      clientSocket.write(Buffer.from([0x01, 0x01])); // auth failure
      clientSocket.end();
      return;
    }

    const ulen = authData[1];
    const username = authData.slice(2, 2 + ulen).toString(); // apiKey
    const plen = authData[2 + ulen];
    const password = authData.slice(3 + ulen, 3 + ulen + plen).toString(); // sessionId or "auto"

    // Validate API key
    let validKey = false;
    if (apiKeyManager) {
      const agent = apiKeyManager.validate(username);
      if (agent) validKey = true;
    }

    if (!validKey) {
      clientSocket.write(Buffer.from([0x01, 0x01])); // auth failure
      clientSocket.end();
      return;
    }

    // Auth success
    clientSocket.write(Buffer.from([0x01, 0x00]));

    // Now handle SOCKS5 connect request
    clientSocket.once('data', (connectReq) => {
      if (connectReq[0] !== 0x05 || connectReq[1] !== 0x01) {
        const reply = Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        clientSocket.write(reply);
        clientSocket.end();
        return;
      }

      let targetHost, targetPort;
      const atyp = connectReq[3];

      if (atyp === 0x01) {
        targetHost = `${connectReq[4]}.${connectReq[5]}.${connectReq[6]}.${connectReq[7]}`;
        targetPort = connectReq.readUInt16BE(8);
      } else if (atyp === 0x03) {
        const domainLen = connectReq[4];
        targetHost = connectReq.slice(5, 5 + domainLen).toString();
        targetPort = connectReq.readUInt16BE(5 + domainLen);
      } else {
        const reply = Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        clientSocket.write(reply);
        clientSocket.end();
        return;
      }

      const match = nodeManager.findNode();
      if (!match) {
        const reply = Buffer.from([0x05, 0x03, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
        clientSocket.write(reply);
        clientSocket.end();
        return;
      }

      // Use existing session or create new
      let session = null;
      if (password && password !== 'auto') {
        session = sessionManager.get(password);
      }
      if (!session) {
        session = sessionManager.create({ nodeId: match.nodeId, apiKey: username, pricePerGB: match.node.pricePerGB });
      }

      const requestId = uuidv4();
      const pending = { socket: clientSocket, nodeId: match.nodeId, sessionId: session.sessionId, bufferedData: [], ready: false, socks5: true };
      pendingRequests.set(requestId, pending);

      match.node.ws.send(JSON.stringify({
        type: 'proxy_connect',
        requestId,
        sessionId: session.sessionId,
        host: targetHost,
        port: targetPort,
      }));

      const checkReady = setInterval(() => {
        if (pending.ready) {
          clearInterval(checkReady);
          const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
          clientSocket.write(reply);
        }
      }, 50);

      const connectTimeout = setTimeout(() => {
        if (!pending.ready) {
          clearInterval(checkReady);
          const reply = Buffer.from([0x05, 0x04, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
          clientSocket.write(reply);
          clientSocket.end();
          pendingRequests.delete(requestId);
        }
      }, 15000);

      clientSocket.on('data', (d) => {
        // Fix 4: data FROM client = bytesOut
        sessionManager.recordActivity(session.sessionId, 0, d.length);
        if (!pending.ready) {
          pending.bufferedData.push(Buffer.from(d));
          return;
        }
        match.node.ws.send(JSON.stringify({
          type: 'proxy_data',
          requestId,
          sessionId: session.sessionId,
          data: d.toString('base64'),
        }));
      });

      clientSocket.on('close', () => {
        clearTimeout(connectTimeout);
        clearInterval(checkReady);
        pendingRequests.delete(requestId);
      });
      clientSocket.on('error', () => {
        clearTimeout(connectTimeout);
        clearInterval(checkReady);
        pendingRequests.delete(requestId);
      });
    });
  });
}

module.exports = createTcpProxy;
