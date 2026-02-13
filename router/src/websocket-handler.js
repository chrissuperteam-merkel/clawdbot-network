/**
 * WebSocket handler — manages phone node connections
 */
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const { child } = require('./services/logger');

const log = child('websocket');

function setupWebSocket(server, nodeManager, pendingRequests, sessionManager, monitoringService, trafficLog) {
  const wss = new WebSocketServer({ server, path: '/node' });

  wss.on('connection', (ws, req) => {
    const nodeId = uuidv4();
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    log.info({ nodeId, ip: clientIp }, 'Phone connected');

    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
      nodeManager.heartbeat(nodeId);
      if (monitoringService) monitoringService.recordHeartbeat(nodeId);
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(nodeId, ws, msg, nodeManager, pendingRequests, sessionManager, monitoringService, trafficLog);
      } catch {
        handleBinaryData(nodeId, data, pendingRequests, sessionManager);
      }
    });

    ws.on('close', () => {
      nodeManager.unregister(nodeId);
    });

    ws.on('error', (err) => {
      log.error({ nodeId, err: err.message }, 'Node error');
    });

    ws.send(JSON.stringify({ type: 'welcome', nodeId }));
  });

  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  return wss;
}

function handleMessage(nodeId, ws, msg, nodeManager, pendingRequests, sessionManager, monitoringService, trafficLog) {
  switch (msg.type) {
    case 'register': {
      nodeManager.register(nodeId, ws, {
        device: msg.device,
        carrier: msg.carrier,
        country: msg.country,
        connectionType: msg.connectionType || 'unknown',
        ip: msg.ip,
        wallet: msg.wallet,
      });
      ws.send(JSON.stringify({ type: 'registered', nodeId }));
      if (monitoringService) monitoringService.recordHeartbeat(nodeId);
      break;
    }

    case 'heartbeat': {
      nodeManager.heartbeat(nodeId);
      if (monitoringService) monitoringService.recordHeartbeat(nodeId);
      ws.send(JSON.stringify({ type: 'heartbeat_ack', timestamp: Date.now() }));
      break;
    }

    case 'proxy_response': {
      const pending = pendingRequests.get(msg.requestId);
      const body = msg.data ? Buffer.from(msg.data, 'base64') : Buffer.alloc(0);
      log.debug({ requestId: msg.requestId?.slice(0, 8), bytes: body.length, done: msg.done }, 'Proxy response');

      if (monitoringService) monitoringService.recordHeartbeat(nodeId);

      // Log traffic on completion
      if (msg.done && trafficLog) {
        trafficLog.unshift({
          timestamp: new Date().toISOString(),
          method: 'PROXY',
          host: pending?.host || 'unknown',
          bytes: body.length,
          nodeId,
          sessionId: msg.sessionId || null,
          status: 'completed',
        });
        if (trafficLog.length > 100) trafficLog.length = 100;
        if (monitoringService) monitoringService.recordRequest(nodeId, true, body.length);
      }

      // Fix 4: Data FROM phone = bytesIn for the agent (response data)
      if (msg.sessionId && sessionManager && body.length > 0) {
        sessionManager.recordActivity(msg.sessionId, body.length, 0);
      }

      if (pending?.socket && !pending.socket.destroyed) {
        if (body.length > 0) pending.socket.write(body);
        if (msg.done) {
          pending.socket.end();
          pendingRequests.delete(msg.requestId);
        }
      }
      break;
    }

    case 'connect_ready': {
      const pending = pendingRequests.get(msg.requestId);
      if (pending?.socket && !pending.socket.destroyed) {
        if (!pending.socks5) {
          pending.socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        }
        if (pending.bufferedData?.length) {
          const node = nodeManager.get(pending.nodeId);
          if (node?.ws?.readyState === 1) {
            for (const buf of pending.bufferedData) {
              node.ws.send(JSON.stringify({
                type: 'proxy_data',
                requestId: msg.requestId,
                sessionId: msg.sessionId,
                data: buf.toString('base64'),
              }));
            }
          }
          pending.bufferedData = [];
        }
        pending.ready = true;
        log.info({ requestId: msg.requestId?.slice(0, 8) }, 'CONNECT tunnel ready');
      }
      break;
    }

    case 'ip_rotate_result': {
      const rotateKey = 'rotate_' + msg.rotateId;
      const pending = pendingRequests.get(rotateKey);
      if (pending?.resolve) {
        pending.resolve(msg.newIp || msg.ip || 'unknown');
      }
      log.info({ nodeId, newIp: msg.newIp || msg.ip }, 'IP rotated');
      break;
    }

    case 'proxy_error': {
      const pending = pendingRequests.get(msg.requestId);
      if (pending?.socket && !pending.socket.destroyed) {
        pending.socket.end();
        pendingRequests.delete(msg.requestId);
      }
      if (monitoringService) monitoringService.recordRequest(nodeId, false);
      if (trafficLog) {
        trafficLog.unshift({
          timestamp: new Date().toISOString(),
          method: 'PROXY',
          host: pending?.host || 'unknown',
          bytes: 0,
          nodeId,
          sessionId: msg.sessionId || null,
          status: 'error: ' + (msg.error || 'unknown'),
        });
        if (trafficLog.length > 100) trafficLog.length = 100;
      }
      log.warn({ nodeId, error: msg.error }, 'Proxy error from node');
      break;
    }

    default:
      log.warn({ nodeId, type: msg.type }, 'Unknown message type');
  }
}

function handleBinaryData(nodeId, data, pendingRequests, sessionManager) {
  if (data.length > 36) {
    const requestId = data.slice(0, 36).toString();
    const payload = data.slice(36);
    const pending = pendingRequests.get(requestId);
    if (pending?.socket && !pending.socket.destroyed) {
      pending.socket.write(payload);
      // Fix 4: binary data from phone = bytesIn for agent
      if (pending.sessionId && sessionManager) {
        sessionManager.recordActivity(pending.sessionId, payload.length, 0);
      }
    }
  }
}

module.exports = setupWebSocket;
