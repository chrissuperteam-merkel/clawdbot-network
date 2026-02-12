/**
 * WebSocket handler — manages phone node connections
 */
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');

function setupWebSocket(server, nodeManager, pendingRequests) {
  const wss = new WebSocketServer({ server, path: '/node' });

  wss.on('connection', (ws, req) => {
    const nodeId = uuidv4();
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    console.log(`[NODE] Phone connected: ${nodeId} (${clientIp})`);

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      nodeManager.heartbeat(nodeId);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(nodeId, ws, msg, nodeManager, pendingRequests);
      } catch {
        // Binary data — proxy response (requestId[36] + payload)
        handleBinaryData(nodeId, data, pendingRequests);
      }
    });

    ws.on('close', () => {
      nodeManager.unregister(nodeId);
    });

    ws.on('error', (err) => {
      console.error(`[NODE] Error for ${nodeId}: ${err.message}`);
    });

    // Welcome message
    ws.send(JSON.stringify({ type: 'welcome', nodeId }));
  });

  // Ping/pong heartbeat
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  return wss;
}

function handleMessage(nodeId, ws, msg, nodeManager, pendingRequests) {
  switch (msg.type) {
    case 'register': {
      nodeManager.register(nodeId, ws, {
        device: msg.device,
        carrier: msg.carrier,
        country: msg.country,
        ip: msg.ip,
        wallet: msg.wallet,
      });
      ws.send(JSON.stringify({ type: 'registered', nodeId }));
      break;
    }

    case 'heartbeat': {
      nodeManager.heartbeat(nodeId);
      ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
      break;
    }

    case 'proxy_response': {
      const pending = pendingRequests.get(msg.requestId);
      const body = msg.data ? Buffer.from(msg.data, 'base64') : Buffer.alloc(0);
      console.log(`[PROXY] Response for ${msg.requestId?.slice(0,8)}: ${body.length} bytes, done=${msg.done}`);
      if (pending?.socket && !pending.socket.destroyed) {
        if (body.length > 0) pending.socket.write(body);
        if (msg.done) {
          pending.socket.end();
          pendingRequests.delete(msg.requestId);
        }
      }
      break;
    }

    case 'proxy_error': {
      const pending = pendingRequests.get(msg.requestId);
      if (pending?.socket && !pending.socket.destroyed) {
        pending.socket.end();
        pendingRequests.delete(msg.requestId);
      }
      console.log(`[PROXY] Error from ${nodeId}: ${msg.error}`);
      break;
    }

    default:
      console.log(`[NODE] Unknown message type from ${nodeId}: ${msg.type}`);
  }
}

function handleBinaryData(nodeId, data, pendingRequests) {
  if (data.length > 36) {
    const requestId = data.slice(0, 36).toString();
    const payload = data.slice(36);
    const pending = pendingRequests.get(requestId);
    if (pending?.socket && !pending.socket.destroyed) {
      pending.socket.write(payload);
    }
  }
}

module.exports = setupWebSocket;
