/**
 * Structured logging with pino
 */
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino/file',
    options: { destination: 1 }
  } : undefined,
});

function child(module) {
  return logger.child({ module });
}

module.exports = { logger, child };
