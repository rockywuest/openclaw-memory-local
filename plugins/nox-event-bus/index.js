'use strict';
/**
 * nox-event-bus — OpenClaw Plugin
 *
 * Central event bus for Ambient Intelligence Engine.
 * Stores events as JSONL, auto-prunes old entries, and injects
 * recent relevant events as context before agent starts.
 *
 * Topics:
 * - sensor.email, sensor.calendar, sensor.file, sensor.system
 * - agent.insight, agent.alert
 *
 * Event format:
 * {
 *   timestamp: ISO string,
 *   topic: string,
 *   source: string (plugin/sensor name),
 *   importance: 0-1,
 *   data: object,
 *   ttl_hours?: number (optional expiry)
 * }
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VALID_TOPICS = [
  'sensor.email',
  'sensor.calendar',
  'sensor.file',
  'sensor.system',
  'agent.insight',
  'agent.alert'
];

class EventBus {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.retentionDays = config.retentionDays || 7;
    this.maxEventsInjected = config.maxEventsInjected || 10;
    this.eventFile = path.join(workspaceRoot, 'memory', 'events', 'bus.jsonl');
    this.listeners = new Map(); // topic -> Set<callback>
    this.ensureEventDir();
  }

  ensureEventDir() {
    const dir = path.dirname(this.eventFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Emit an event to the bus.
   * Auto-validates topic, adds timestamp, persists to JSONL.
   */
  emit(topic, data) {
    if (!VALID_TOPICS.includes(topic)) {
      throw new Error(`Invalid topic: ${topic}. Valid: ${VALID_TOPICS.join(', ')}`);
    }

    const event = {
      timestamp: new Date().toISOString(),
      topic,
      source: data.source || 'unknown',
      importance: typeof data.importance === 'number' ? data.importance : 0.5,
      data: data.data || data,
      ttl_hours: data.ttl_hours || null
    };

    // Persist to JSONL
    try {
      fs.appendFileSync(this.eventFile, JSON.stringify(event) + '\n');
    } catch (err) {
      console.error(`[event-bus] Failed to persist event: ${err.message}`);
    }

    // Notify listeners
    const callbacks = this.listeners.get(topic);
    if (callbacks) {
      callbacks.forEach(cb => {
        try {
          cb(event);
        } catch (err) {
          console.error(`[event-bus] Listener error: ${err.message}`);
        }
      });
    }
  }

  /**
   * Subscribe to a topic.
   */
  on(topic, callback) {
    if (!this.listeners.has(topic)) {
      this.listeners.set(topic, new Set());
    }
    this.listeners.get(topic).add(callback);
  }

  /**
   * Unsubscribe from a topic.
   */
  off(topic, callback) {
    const callbacks = this.listeners.get(topic);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * Read all events from JSONL.
   */
  readEvents() {
    if (!fs.existsSync(this.eventFile)) return [];
    try {
      const lines = fs.readFileSync(this.eventFile, 'utf8').trim().split('\n');
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[event-bus] Failed to read events: ${err.message}`);
      return [];
    }
  }

  /**
   * Prune events older than retentionDays.
   * Also removes events with expired TTL.
   */
  pruneOldEvents() {
    const events = this.readEvents();
    const now = Date.now();
    const cutoff = now - this.retentionDays * 24 * 60 * 60 * 1000;

    const kept = events.filter(e => {
      const ts = new Date(e.timestamp).getTime();
      if (ts < cutoff) return false; // Too old

      // Check TTL expiry
      if (e.ttl_hours) {
        const expiry = ts + e.ttl_hours * 60 * 60 * 1000;
        if (now > expiry) return false;
      }

      return true;
    });

    if (kept.length < events.length) {
      // Rewrite file with kept events
      const content = kept.map(e => JSON.stringify(e)).join('\n') + '\n';
      try {
        fs.writeFileSync(this.eventFile, content);
        console.log(`[event-bus] Pruned ${events.length - kept.length} events`);
      } catch (err) {
        console.error(`[event-bus] Failed to prune: ${err.message}`);
      }
    }
  }

  /**
   * Get recent relevant events for injection.
   * Returns top N events by importance, recency-weighted.
   */
  getRecentRelevantEvents(limit = 10) {
    const events = this.readEvents();
    if (events.length === 0) return [];

    const now = Date.now();

    // Score: importance × recency_decay (half-life 24h)
    const scored = events.map(e => {
      const age_ms = now - new Date(e.timestamp).getTime();
      const age_hours = age_ms / (60 * 60 * 1000);
      const decay = Math.pow(0.5, age_hours / 24); // Half-life 24h
      const score = e.importance * decay;
      return { event: e, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, limit).map(s => s.event);
  }

  /**
   * Generate context injection for agent.
   */
  generateContextInjection() {
    const events = this.getRecentRelevantEvents(this.maxEventsInjected);
    if (events.length === 0) return '';

    const lines = ['## Recent Events (Event Bus)', ''];
    events.forEach(e => {
      const ts = new Date(e.timestamp).toISOString().slice(0, 19).replace('T', ' ');
      const summary =
        typeof e.data === 'object'
          ? JSON.stringify(e.data).slice(0, 100)
          : String(e.data).slice(0, 100);
      lines.push(`- **[${ts}]** [${e.topic}] (imp: ${e.importance.toFixed(2)}) ${summary}`);
    });
    lines.push('', '---', '');

    return lines.join('\n');
  }
}

// ── Plugin Registration ──────────────────────────────────────────

const ConnectorRegistry = require('./connectors/index.js');

let busInstance = null;
let connectorRegistry = null;

async function beforeAgentStart(event, ctx) {
  if (!busInstance) return undefined;

  // Prune old events
  busInstance.pruneOldEvents();

  // Inject recent events as context
  const injection = busInstance.generateContextInjection();
  if (!injection) return undefined;

  return {
    systemMessage: injection
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info('[nox-event-bus] Initializing...');

  busInstance = new EventBus(workspace, config);

  // Initialize sensor connectors
  try {
    connectorRegistry = new ConnectorRegistry(workspace, busInstance);
    connectorRegistry.registerBuiltins();
    connectorRegistry.runAll();
    logger.info('[nox-event-bus] Sensor connectors started');
  } catch (err) {
    logger.error(`[nox-event-bus] Connector initialization failed: ${err.message}`);
    // Graceful degradation: continue without connectors
  }

  // Register hook
  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
    logger.info('[nox-event-bus] Registered before_agent_start via api.on()');
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
    logger.info('[nox-event-bus] Registered before_agent_start via registerHook()');
  }

  // Expose bus instance for other plugins
  if (api.shared) {
    api.shared.eventBus = busInstance;
    api.shared.connectorRegistry = connectorRegistry;
    logger.info('[nox-event-bus] Exposed as api.shared.eventBus + connectorRegistry');
  }

  logger.info('[nox-event-bus] Ready');
}

const plugin = {
  id: 'nox-event-bus',
  name: 'Nox Event Bus',
  description: 'Central event bus for Ambient Intelligence Engine (AIE)',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      retentionDays: { type: 'number', default: 7, minimum: 1 },
      maxEventsInjected: { type: 'number', default: 10, minimum: 1, maximum: 50 }
    }
  },
  register
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.EventBus = EventBus; // For testing
