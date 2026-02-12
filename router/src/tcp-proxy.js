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

module.exports = createTcpProxy;
