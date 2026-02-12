/**
 * Node routes — list and inspect proxy nodes
 */
const { Router } = require('express');

function createNodeRoutes(nodeManager) {
  const router = Router();

  // List all online nodes
  router.get('/', (req, res) => {
    const nodes = nodeManager.listNodes();
    res.json({ nodes, count: nodes.length });
  });

  // Get specific node info
  router.get('/:nodeId', (req, res) => {
    const node = nodeManager.get(req.params.nodeId);
    if (!node) return res.status(404).json({ error: 'Node not found' });
    res.json({
      nodeId: req.params.nodeId,
      ...node.info,
      activeSessions: node.sessions,
      uptime: Date.now() - node.info.registeredAt,
    });
  });

  return router;
}

module.exports = createNodeRoutes;
