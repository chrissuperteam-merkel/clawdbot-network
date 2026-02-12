/**
 * TCP Proxy — HTTP/HTTPS CONNECT proxy for agents
 * Agents connect here and traffic routes through phone nodes
 */
const net = require('net');
const { v4: uuidv4 } = require('uuid');
const { WebSocket } = require('ws');
const config = require('./config');

function createTcpProxy(nodeManager, sessionManager, pendingRequests) {
  const proxyServer = net.createServer((clientSocket) => {
    let headerData = Buffer.alloc(0);

    clientSocket.once('data', (chunk) => {
      headerData = Buffer.concat([headerData, chunk]);

      // SOCKS5 detection: first byte is 0x05
      if (headerData[0] === 0x05) {
        handleSocks5(clientSocket, headerData, nodeManager, sessionManager, pendingRequests);
        return;
      }

      const headerStr = headerData.toString();

      // Extract session ID from header
      const sessionMatch = headerStr.match(/X-Session-Id:\s*([^\r\n]+)/i);
      const sessionId = sessionMatch ? sessionMatch[1].trim() : null;
      let session = sessionId ? sessionManager.get(sessionId) : null;

      // Auto-create session if none provided
      if (!session) {
        const match = nodeManager.findNode();
        if (!match) {
          clientSocket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{"error":"No proxy nodes online"}\r\n');
          clientSocket.end();
          return;
        }
        session = sessionManager.create({ nodeId: match.nodeId, apiKey: 'auto' });
      }

      const node = nodeManager.get(session.nodeId);
      if (!node || node.ws.readyState !== WebSocket.OPEN) {
        clientSocket.write('HTTP/1.1 502 Bad Gateway\r\nContent-Type: application/json\r\n\r\n{"error":"Proxy node disconnected"}\r\n');
        clientSocket.end();
        return;
      }

      const requestId = uuidv4();
      pendingRequests.set(requestId, { socket: clientSocket, nodeId: session.nodeId });
      sessionManager.recordActivity(session.sessionId, chunk.length);

      // HTTPS CONNECT tunnel
      const connectMatch = headerStr.match(/^CONNECT (.+):(\d+) HTTP/);
      if (connectMatch) {
        const targetHost = connectMatch[1];
        const targetPort = parseInt(connectMatch[2]);

        // Store buffered data in pending so websocket handler can flush it on connect_ready
        const pending = { socket: clientSocket, nodeId: session.nodeId, bufferedData: [], ready: false };
        pendingRequests.set(requestId, pending);

        node.ws.send(JSON.stringify({
          type: 'proxy_connect',
          requestId,
          sessionId: session.sessionId,
          host: targetHost,
          port: targetPort,
        }));

        console.log(`[PROXY] CONNECT tunnel ${requestId.slice(0,8)} → ${targetHost}:${targetPort}`);

        // Timeout if phone doesn't confirm in 15s
        const connectTimeout = setTimeout(() => {
          if (!pending.ready) {
            console.log(`[PROXY] CONNECT timeout ${requestId.slice(0,8)}`);
            clientSocket.write('HTTP/1.1 504 Gateway Timeout\r\n\r\n');
            clientSocket.end();
            pendingRequests.delete(requestId);
          }
        }, 15000);

        // When phone sends connect_ready, websocket-handler sends 200 and flushes buffer
        clientSocket.on('data', (d) => {
          sessionManager.recordActivity(session.sessionId, d.length);
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
        node.ws.send(JSON.stringify({
          type: 'proxy_http',
          requestId,
          sessionId: session.sessionId,
          rawRequest: chunk.toString('base64'),
        }));

        clientSocket.on('data', (d) => {
          sessionManager.recordActivity(session.sessionId, d.length);
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

function handleSocks5(clientSocket, initialData, nodeManager, sessionManager, pendingRequests) {
  // SOCKS5 greeting: VER(1) NMETHODS(1) METHODS(n)
  // Respond with no-auth: VER(1) METHOD(1) = 0x05 0x00
  clientSocket.write(Buffer.from([0x05, 0x00]));

  clientSocket.once('data', (connectReq) => {
    // SOCKS5 connect: VER(1) CMD(1) RSV(1) ATYP(1) ADDR(var) PORT(2)
    if (connectReq[0] !== 0x05 || connectReq[1] !== 0x01) {
      // Only CONNECT (0x01) supported
      const reply = Buffer.from([0x05, 0x07, 0x00, 0x01, 0,0,0,0, 0,0]);
      clientSocket.write(reply);
      clientSocket.end();
      return;
    }

    let targetHost, targetPort;
    const atyp = connectReq[3];

    if (atyp === 0x01) {
      // IPv4
      targetHost = `${connectReq[4]}.${connectReq[5]}.${connectReq[6]}.${connectReq[7]}`;
      targetPort = connectReq.readUInt16BE(8);
    } else if (atyp === 0x03) {
      // Domain
      const domainLen = connectReq[4];
      targetHost = connectReq.slice(5, 5 + domainLen).toString();
      targetPort = connectReq.readUInt16BE(5 + domainLen);
    } else if (atyp === 0x04) {
      // IPv6 — not commonly used, reject
      const reply = Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0]);
      clientSocket.write(reply);
      clientSocket.end();
      return;
    } else {
      const reply = Buffer.from([0x05, 0x08, 0x00, 0x01, 0,0,0,0, 0,0]);
      clientSocket.write(reply);
      clientSocket.end();
      return;
    }

    // Find a node
    const match = nodeManager.findNode();
    if (!match) {
      const reply = Buffer.from([0x05, 0x03, 0x00, 0x01, 0,0,0,0, 0,0]); // network unreachable
      clientSocket.write(reply);
      clientSocket.end();
      return;
    }

    const session = sessionManager.create({ nodeId: match.nodeId, apiKey: 'socks5', pricePerGB: match.node.pricePerGB });
    const requestId = uuidv4();
    const pending = { socket: clientSocket, nodeId: match.nodeId, bufferedData: [], ready: false, socks5: true };
    pendingRequests.set(requestId, pending);

    match.node.ws.send(JSON.stringify({
      type: 'proxy_connect',
      requestId,
      sessionId: session.sessionId,
      host: targetHost,
      port: targetPort,
    }));

    // When connect_ready comes, send SOCKS5 success reply
    const origReady = pending.ready;
    const checkReady = setInterval(() => {
      if (pending.ready) {
        clearInterval(checkReady);
        // SOCKS5 success: VER(1) REP(1)=0x00 RSV(1) ATYP(1)=0x01 ADDR(4) PORT(2)
        const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0,0,0,0, 0,0]);
        clientSocket.write(reply);
      }
    }, 50);

    const connectTimeout = setTimeout(() => {
      if (!pending.ready) {
        clearInterval(checkReady);
        const reply = Buffer.from([0x05, 0x04, 0x00, 0x01, 0,0,0,0, 0,0]); // host unreachable
        clientSocket.write(reply);
        clientSocket.end();
        pendingRequests.delete(requestId);
      }
    }, 15000);

    clientSocket.on('data', (d) => {
      sessionManager.recordActivity(session.sessionId, d.length, 0);
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
}

module.exports = createTcpProxy;
