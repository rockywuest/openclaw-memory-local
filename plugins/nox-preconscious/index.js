'use strict';
/**
 * nox-preconscious — OpenClaw Plugin
 *
 * Preconscious buffer: scores events by importance × recency × reinforcement,
 * writes top-N insights to memory/preconscious-buffer.md, and injects as context.
 *
 * Scoring formula:
 *   score = importance × recency_decay × reinforcement_count
 *   recency_decay = 0.5^(age_hours / halfLifeHours)
 *
 * Token limit: ~500 tokens (~2000 chars in Markdown).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PreconsciousBuffer {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.topN = config.topN || 5;
    this.maxTokens = config.maxTokens || 500;
    this.halfLifeHours = config.halfLifeHours || 24;
    this.bufferFile = path.join(workspaceRoot, 'memory', 'preconscious-buffer.md');
    this.eventFile = path.join(workspaceRoot, 'memory', 'events', 'bus.jsonl');
    this.reinforcementFile = path.join(workspaceRoot, 'memory', 'events', 'reinforcement.jsonl');
  }

  /**
   * Read events from event bus.
   */
  readEvents() {
    if (!fs.existsSync(this.eventFile)) return [];
    try {
      const lines = fs.readFileSync(this.eventFile, 'utf8').trim().split('\n');
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[preconscious] Failed to read events: ${err.message}`);
      return [];
    }
  }

  /**
   * Read reinforcement counts (how often an insight was referenced).
   * Format: { hash: count }
   */
  readReinforcements() {
    if (!fs.existsSync(this.reinforcementFile)) return {};
    try {
      const lines = fs.readFileSync(this.reinforcementFile, 'utf8').trim().split('\n');
      const counts = {};
      lines
        .filter(l => l.trim())
        .forEach(l => {
          const entry = JSON.parse(l);
          counts[entry.hash] = (counts[entry.hash] || 0) + 1;
        });
      return counts;
    } catch (err) {
      console.error(`[preconscious] Failed to read reinforcements: ${err.message}`);
      return {};
    }
  }

  /**
   * Hash event content for dedup/reinforcement tracking.
   */
  hashEvent(event) {
    const content = JSON.stringify({ topic: event.topic, data: event.data });
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  /**
   * Score events by importance × recency_decay × reinforcement.
   */
  scoreEvents(events) {
    const now = Date.now();
    const reinforcements = this.readReinforcements();

    return events.map(e => {
      const age_ms = now - new Date(e.timestamp).getTime();
      const age_hours = age_ms / (60 * 60 * 1000);
      const decay = Math.pow(0.5, age_hours / this.halfLifeHours);
      const hash = this.hashEvent(e);
      const reinforcementCount = reinforcements[hash] || 1;
      const score = e.importance * decay * reinforcementCount;

      return { event: e, score, hash, reinforcementCount };
    });
  }

  /**
   * Generate buffer markdown from top-N insights.
   */
  generateBuffer() {
    const events = this.readEvents();
    if (events.length === 0) return '';

    const scored = this.scoreEvents(events);
    scored.sort((a, b) => b.score - a.score);

    const topEvents = scored.slice(0, this.topN);

    const lines = [
      '# Preconscious Buffer',
      '',
      `Generated: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`,
      '',
      'Top insights (importance × recency × reinforcement):',
      ''
    ];

    topEvents.forEach((item, idx) => {
      const e = item.event;
      const ts = new Date(e.timestamp).toISOString().slice(0, 19).replace('T', ' ');
      const summary =
        typeof e.data === 'object'
          ? JSON.stringify(e.data).slice(0, 150)
          : String(e.data).slice(0, 150);

      lines.push(`## ${idx + 1}. [${e.topic}] (score: ${item.score.toFixed(3)})`);
      lines.push(`- **Time:** ${ts}`);
      lines.push(`- **Importance:** ${e.importance.toFixed(2)}`);
      lines.push(`- **Reinforcement:** ${item.reinforcementCount}×`);
      lines.push(`- **Summary:** ${summary}`);
      lines.push('');
    });

    lines.push('---');

    const content = lines.join('\n');

    // Token limit check (rough: 1 token ≈ 4 chars)
    const estimatedTokens = content.length / 4;
    if (estimatedTokens > this.maxTokens) {
      // Truncate by reducing topN
      const ratio = this.maxTokens / estimatedTokens;
      const newTopN = Math.max(1, Math.floor(this.topN * ratio));
      console.warn(
        `[preconscious] Buffer exceeds ${this.maxTokens} tokens (est. ${Math.round(estimatedTokens)}). Reducing to top ${newTopN}.`
      );

      // Regenerate with reduced topN
      const reducedEvents = scored.slice(0, newTopN);
      const reducedLines = lines.slice(0, 6); // Keep header

      reducedEvents.forEach((item, idx) => {
        const e = item.event;
        const ts = new Date(e.timestamp).toISOString().slice(0, 19).replace('T', ' ');
        const summary =
          typeof e.data === 'object'
            ? JSON.stringify(e.data).slice(0, 150)
            : String(e.data).slice(0, 150);

        reducedLines.push(`## ${idx + 1}. [${e.topic}] (score: ${item.score.toFixed(3)})`);
        reducedLines.push(`- **Time:** ${ts}`);
        reducedLines.push(`- **Importance:** ${e.importance.toFixed(2)}`);
        reducedLines.push(`- **Reinforcement:** ${item.reinforcementCount}×`);
        reducedLines.push(`- **Summary:** ${summary}`);
        reducedLines.push('');
      });

      reducedLines.push('---');
      return reducedLines.join('\n');
    }

    return content;
  }

  /**
   * Write buffer to file.
   */
  writeBuffer() {
    const content = this.generateBuffer();
    if (!content) {
      console.log('[preconscious] No events to buffer');
      return;
    }

    try {
      const dir = path.dirname(this.bufferFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.bufferFile, content);
      console.log(`[preconscious] Buffer written: ${this.bufferFile}`);
    } catch (err) {
      console.error(`[preconscious] Failed to write buffer: ${err.message}`);
    }
  }

  /**
   * Read buffer for injection.
   */
  readBuffer() {
    if (!fs.existsSync(this.bufferFile)) return '';
    try {
      return fs.readFileSync(this.bufferFile, 'utf8');
    } catch (err) {
      console.error(`[preconscious] Failed to read buffer: ${err.message}`);
      return '';
    }
  }
}

// ── Plugin Registration ──────────────────────────────────────────

let bufferInstance = null;

async function beforeAgentStart(event, ctx) {
  if (!bufferInstance) return undefined;

  // Regenerate buffer from latest events
  bufferInstance.writeBuffer();

  // Inject buffer as context
  const content = bufferInstance.readBuffer();
  if (!content) return undefined;

  return {
    systemMessage: content
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info('[nox-preconscious] Initializing...');

  bufferInstance = new PreconsciousBuffer(workspace, config);

  // Register hook
  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
    logger.info('[nox-preconscious] Registered before_agent_start via api.on()');
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
    logger.info('[nox-preconscious] Registered before_agent_start via registerHook()');
  }

  // Expose instance for other plugins
  if (api.shared) {
    api.shared.preconsciousBuffer = bufferInstance;
    logger.info('[nox-preconscious] Exposed as api.shared.preconsciousBuffer');
  }

  logger.info('[nox-preconscious] Ready');
}

const plugin = {
  id: 'nox-preconscious',
  name: 'Nox Preconscious Buffer',
  description: 'Scores and surfaces top insights from event bus',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      topN: { type: 'number', default: 5, minimum: 1, maximum: 20 },
      maxTokens: { type: 'number', default: 500, minimum: 100, maximum: 2000 },
      halfLifeHours: { type: 'number', default: 24, minimum: 1 }
    }
  },
  register
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.PreconsciousBuffer = PreconsciousBuffer; // For testing
