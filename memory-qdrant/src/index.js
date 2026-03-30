'use strict';
/**
 * memory-qdrant — OpenClaw Plugin
 *
 * Automatic semantic memory recall using Qdrant via mcporter.
 * Injects relevant memories, verified facts, and knowledge-file hints
 * into every session start.
 *
 * Part of: openclaw-memory-local
 * License: MIT
 */

const { createBeforeAgentStart, getMemoryStatus } = require('./auto-recall.js');
const {
  searchMemories,
  storeMemory,
  isHealthy,
  getStats,
  configure
} = require('./qdrant-client.js');

function register(api) {
  const log = api.log || console;
  log.info('[memory-qdrant] Registering...');

  const config = api.config || {};

  // Configure Qdrant client
  configure({ serverName: config.serverName || 'qdrant-memory' });

  // Health check in background (non-blocking)
  isHealthy()
    .then(healthy => {
      if (!healthy) {
        log.warn('[memory-qdrant] Warning: mcporter/Qdrant not reachable');
      } else {
        log.info('[memory-qdrant] mcporter/Qdrant connection verified');
      }
    })
    .catch(() => {});

  // Create and register the hook
  createBeforeAgentStart(config).then(hook => {
    if (api.on) {
      api.on('before_agent_start', hook);
      log.info('[memory-qdrant] Registered before_agent_start hook');
    } else if (api.registerHook) {
      api.registerHook('before_agent_start', hook, {
        name: 'memory-qdrant-recall',
        description: 'Auto-inject Qdrant memories'
      });
    }
  });

  log.info('[memory-qdrant] Registered successfully');
}

const plugin = {
  id: 'memory-qdrant',
  name: 'Memory Qdrant',
  description: 'Automatic Qdrant memory recall via mcporter',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      serverName: {
        type: 'string',
        default: 'qdrant-memory',
        description: 'mcporter server name for Qdrant'
      },
      factsFile: { type: 'string', description: 'Path to facts.jsonl (optional)' },
      qdrantLimit: { type: 'number', default: 5, description: 'Max Qdrant results to inject' },
      knowledgeMap: {
        type: 'object',
        description: 'Keyword → knowledge-file path mapping for routing hints',
        additionalProperties: { type: 'string' }
      }
    }
  },
  register
};

module.exports = plugin;
module.exports.default = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.utils = { searchMemories, storeMemory, getMemoryStatus, isHealthy, getStats };
