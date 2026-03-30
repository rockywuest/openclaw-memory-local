'use strict';
/**
 * auto-checkpoint — OpenClaw Plugin
 *
 * Ensures operational context survives context compaction.
 * - Injects last checkpoint into every session start
 * - Warns when checkpoint is stale (configurable threshold)
 * - Backs up state before compaction (best-effort)
 *
 * Part of: openclaw-memory-local
 * License: MIT
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_INJECT_CHARS = 3000;
const DEFAULT_STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Resolve workspace directory from config or environment.
 */
function resolveWorkspace(config) {
  return config?.workspace || process.env.OPENCLAW_WORKSPACE || process.env.HOME + '/clawd';
}

/**
 * Parse timestamp from first line: "# Current State — YYYY-MM-DD HH:MM"
 */
function parseCheckpointTime(content, tzOffset) {
  const match = content.match(/Current State.*?(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/);
  if (!match) return null;
  try {
    return new Date(`${match[1]}T${match[2]}:00${tzOffset || '+00:00'}`);
  } catch {
    return null;
  }
}

/**
 * Read checkpoint file safely
 */
function readCheckpoint(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * before_agent_start: Inject checkpoint + stale warning
 */
async function beforeAgentStart(event, ctx, config) {
  const workspace = resolveWorkspace(config);
  const stateDir = path.join(workspace, 'state');
  const checkpointFile = config?.checkpointFile || path.join(stateDir, 'current.md');
  const maxChars = config?.maxInjectChars || DEFAULT_MAX_INJECT_CHARS;
  const staleMs = config?.staleThresholdMs || DEFAULT_STALE_THRESHOLD_MS;
  const tzOffset = config?.tzOffset || '+00:00';

  const content = readCheckpoint(checkpointFile);
  if (!content) {
    return {
      prependContext:
        '## AUTO-CHECKPOINT\n\n' +
        '⚠️ No checkpoint file found. Create one at ' +
        checkpointFile +
        ' with current system status, open tasks, and context.\n\n---'
    };
  }

  const checkpointTime = parseCheckpointTime(content, tzOffset);
  const now = new Date();
  const ageMs = checkpointTime ? now - checkpointTime : null;
  const ageHours = ageMs ? (ageMs / (60 * 60 * 1000)).toFixed(1) : '?';
  const isStale = ageMs ? ageMs > staleMs : true;

  const truncated = content.length > maxChars ? '...\n' + content.slice(-maxChars) : content;

  let warning = '';
  if (isStale) {
    warning =
      '\n\n⚠️ CHECKPOINT STALE (' +
      ageHours +
      'h old). ' +
      'Update ' +
      checkpointFile +
      ' now to preserve context across compaction.';
  }

  return {
    prependContext: '## LAST CHECKPOINT' + warning + '\n\n' + truncated + '\n\n---'
  };
}

/**
 * before_compaction: Backup state file (best-effort)
 */
async function beforeCompaction(event, ctx, config) {
  const workspace = resolveWorkspace(config);
  const stateDir = path.join(workspace, 'state');
  const checkpointFile = config?.checkpointFile || path.join(stateDir, 'current.md');
  const compactionLog = path.join(stateDir, 'compaction-log.txt');

  try {
    const content = readCheckpoint(checkpointFile);
    if (content) {
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = path.join(stateDir, `pre-compaction-${ts}.md`);
      fs.writeFileSync(backupPath, content);
    }
    fs.appendFileSync(compactionLog, new Date().toISOString() + ' compaction triggered\n');
  } catch (err) {
    console.error('[auto-checkpoint] Backup error:', err.message);
  }
}

function register(api) {
  const log = api.log || console;
  log.info('[auto-checkpoint] Registering...');

  const config = api.config || {};

  if (api.on) {
    api.on('before_agent_start', (e, c) => beforeAgentStart(e, c, config));
    api.on('before_compaction', (e, c) => beforeCompaction(e, c, config));
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', (e, c) => beforeAgentStart(e, c, config));
  }

  log.info('[auto-checkpoint] Registered successfully');
}

const plugin = {
  id: 'auto-checkpoint',
  name: 'Auto-Checkpoint',
  description: 'Injects operational state checkpoint and warns on stale state',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      workspace: { type: 'string', description: 'Path to workspace directory' },
      checkpointFile: {
        type: 'string',
        description: 'Path to checkpoint file (default: <workspace>/state/current.md)'
      },
      maxInjectChars: {
        type: 'number',
        default: 3000,
        description: 'Max chars to inject from checkpoint'
      },
      staleThresholdMs: {
        type: 'number',
        default: 7200000,
        description: 'Stale threshold in ms (default: 2h)'
      },
      tzOffset: {
        type: 'string',
        default: '+00:00',
        description: 'Timezone offset for checkpoint parsing (e.g. +01:00)'
      }
    }
  },
  register
};

module.exports = plugin;
module.exports.default = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
