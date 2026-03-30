'use strict';
/**
 * nox-auto-capture v2.1 — OpenClaw Plugin
 *
 * Captures corrections, decisions, facts, and lessons from conversations
 * into Qdrant via mcporter.
 *
 * v2.1 Changes (inspired by claude-mem analysis):
 * - Privacy tags: <private>...</private> content is stripped before capture
 * - Observation types: stored with type classification for better retrieval
 * - Token cost estimation: logged per capture for economics visibility
 * - Preference detection: captures user preferences and style corrections
 *
 * v2.0 Changes:
 * - Aggressive content cleaning (metadata envelopes, system events)
 * - Semantic deduplication before storing (search → skip if exists)
 * - Only captures from user role (the human user), not assistant/system
 * - Comprehensive skip patterns (watchdog, crons, retries, heartbeats)
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LOG_FILE =
  process.env.CAPTURE_LOG_FILE ||
  path.join(
    process.env.OPENCLAW_WORKSPACE || process.env.HOME || '.',
    'memory',
    'auto-capture.log'
  );
const MIN_MESSAGE_LENGTH = 30;
const MAX_STORE_LENGTH = 500;
const COOLDOWN_MS = 15_000;
const DEDUP_THRESHOLD = 40; // chars prefix to check for duplicates

let lastCaptureTime = 0;

// ── Skip Patterns (messages that should NEVER be captured) ───────

const SKIP_PATTERNS = [
  // Greetings & trivial
  // Skip short greetings (EN + DE)
  /^(hi|hey|hallo|moin|ok|ja|nein|danke|thanks|super|👍|❤️|😂|cool|gut|passt|alles klar)[\s.!]*$/i,
  // System
  /^HEARTBEAT/i,
  /^NO_REPLY$/,
  /^\[System/,
  /^System: \[/,
  /^BOOT/i,
  /^You are running a boot check/i,
  /^Read HEARTBEAT\.md/i,
  /^Pre-compaction memory flush/i,
  // Cron triggers
  /^COMMUNITY SCOUT/i,
  /^MORNING BRIEFING/i,
  /^TECH BRIEFING/i,
  /^NIGHTLY BUILD/i,
  /^ABEND-REFLEXION/i,
  /^LEARNING SCOUT/i,
  /^\[WATCHDOG\]/i,
  /WATCHDOG.*Pruefe ob/i,
  /^\[cron:/i,
  /^A scheduled reminder has been triggered/i,
  /^Handle this reminder internally/i,
  // OpenClaw internal
  /^Your previous response was only an acknowledgement/i,
  /Exec completed \(/i,
  /WhatsApp gateway connected/i,
  /^Conversation info \(untrusted metadata\)/i,
  /^Sender \(untrusted metadata\)/i,
  /^## LETZTER CHECKPOINT/i,
  /^## VERIFIED FACTS/i,
  /^## QDRANT MEMORY/i,
  // Media/attachment notices
  /^\[media attached:/i,
  // Boot check
  /^BOOT\.md:/i,
  /security-critical.*Changes require human/i
];

// ── Pattern Detection (what IS worth capturing) ──────────────────

const CORRECTION_PATTERNS = [
  // Multilingual correction detection (EN + DE)
  /\b(nein|falsch|stimmt nicht|nicht richtig|das ist falsch|korrektur|korrigier)/i,
  /\b(actually|wrong|incorrect|correction|that's not)\b/i,
  /\b(ALTER|WIE OFT DENN NOCH|echt enttäuscht)/i
];

const DECISION_PATTERNS = [
  /\b(wir machen|lass uns|ich entscheide|wir nehmen|machen wir|let's do)/i,
  /\b(ab jetzt|von jetzt an|neue regel|ab sofort)/i,
  /\b(go for it|mach das|approved|freigegeben)/i
];

const FACT_PATTERNS = [
  /\b(kostet|preis|€|EUR|\$|USD)\b.*\d/i,
  /\b(termin|datum|deadline|bis zum)\b.*\d{1,2}[\./]\d{1,2}/i,
  /\b(email|telefon|adresse|kontakt)\s*[:=]/i,
  /\b(version|release)\s+v?\d/i
];

const LESSON_PATTERNS = [
  /\b(fehler|mistake|bug|nie wieder|never again)\b/i,
  /\b(wichtig|merken|remember|aufpassen|vorsicht)\b.*[:!]/i
];

const PREFERENCE_PATTERNS = [
  // User preferences & style corrections (inspired by claude-mem observation types)
  /\b(ich will|ich möchte|bitte immer|bitte nie|ab jetzt immer|ab jetzt nie)\b/i,
  /\b(i want|i prefer|always do|never do|don't ever)\b/i,
  /\b(format|formatier|schreib.*so|nicht so sondern)\b/i,
  /\b(wir hatten vereinbart|wir hatten besprochen|wie besprochen)\b/i,
  /\b(mach.*nicht mehr|hör auf mit|stop doing)\b/i
];

// ── Content Cleaning ─────────────────────────────────────────────

// ── Token Cost Estimation (inspired by claude-mem TokenCalculator) ────
const CHARS_PER_TOKEN = 4;
function estimateTokens(text) {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

function cleanContent(text) {
  if (!text || typeof text !== 'string') return '';
  let c = text;

  // Strip <private> tags — user-marked content that should never be captured
  // Inspired by claude-mem's privacy tag system
  c = c.replace(/<private>[\s\S]*?<\/private>/g, '[PRIVATE]');

  // Remove JSON metadata blocks
  c = c.replace(/Conversation info \(untrusted metadata\):\s*```json[\s\S]*?```\s*/g, '');
  c = c.replace(/Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*/g, '');
  c = c.replace(/Replied message \(untrusted, for context\):\s*```json[\s\S]*?```\s*/g, '');

  // Remove inline metadata labels (without code blocks)
  c = c.replace(/Conversation info \(untrusted metadata\):\s*\n*/g, '');
  c = c.replace(/Sender \(untrusted metadata\):\s*\n*/g, '');
  c = c.replace(/Replied message \(untrusted, for context\):\s*\n*/g, '');

  // Remove external content wrappers
  c = c.replace(
    /<<<EXTERNAL_UNTRUSTED_CONTENT[\s\S]*?<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g,
    ''
  );
  c = c.replace(/SECURITY NOTICE:[\s\S]*?Send messages to third parties\n*/g, '');

  // Remove checkpoint injections
  c = c.replace(/## LETZTER CHECKPOINT[\s\S]*?\*Aktualisiert:.*?\*\n*/g, '');
  c = c.replace(/## VERIFIED FACTS\n[\s\S]*?---/g, '');
  c = c.replace(/## QDRANT MEMORY\n[\s\S]*?---/g, '');

  // Remove system lines
  c = c.replace(/^System: \[.*?\].*$/gm, '');
  c = c.replace(/\[media attached:[^\]]*\]\s*/g, '');
  c = c.replace(/\[Queued messages.*?\]\s*\n*---\s*\n*Queued #\d+\s*\n*/g, '');

  // Clean up whitespace
  c = c.replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');

  return c.length >= MIN_MESSAGE_LENGTH ? c : '';
}

// ── Deduplication ────────────────────────────────────────────────

function isDuplicate(text) {
  // Take first ~60 chars of actual content for dedup check
  const prefix = text.replace(/^\[\d{4}-\d{2}-\d{2}\|[^]]*\]\s*/, '').slice(0, 60);
  if (prefix.length < 20) return false;

  try {
    const result = execFileSync(
      'mcporter',
      ['call', 'qdrant-memory.qdrant-find', `query=${prefix}`],
      { timeout: 10_000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const output = result.toString();
    // If any result contains our prefix (first 30 chars), it's a duplicate
    const checkStr = prefix.slice(0, 30).toLowerCase();
    return output.toLowerCase().includes(checkStr);
  } catch {
    return false; // On error, allow storage
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function ensureLogDir() {
  try {
    const dir = path.dirname(LOG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {}
}
ensureLogDir();

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  } catch {}
  console.log(`[nox-auto-capture] ${msg}`);
}

function classifyMessage(text) {
  const categories = [];
  for (const p of CORRECTION_PATTERNS)
    if (p.test(text)) {
      categories.push('correction');
      break;
    }
  for (const p of DECISION_PATTERNS)
    if (p.test(text)) {
      categories.push('decision');
      break;
    }
  for (const p of FACT_PATTERNS)
    if (p.test(text)) {
      categories.push('fact');
      break;
    }
  for (const p of LESSON_PATTERNS)
    if (p.test(text)) {
      categories.push('lesson');
      break;
    }
  for (const p of PREFERENCE_PATTERNS)
    if (p.test(text)) {
      categories.push('preference');
      break;
    }
  return categories;
}

function shouldSkip(text) {
  if (!text || text.length < MIN_MESSAGE_LENGTH) return true;
  return SKIP_PATTERNS.some(p => p.test(text.trim()));
}

function storeInQdrant(text) {
  const truncated = text.length > MAX_STORE_LENGTH ? text.slice(0, MAX_STORE_LENGTH) + '...' : text;
  try {
    execFileSync('mcporter', ['call', 'qdrant-memory.qdrant-store', `information=${truncated}`], {
      timeout: 15_000,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    return true;
  } catch (err) {
    log(`Store failed: ${(err.message || '').slice(0, 100)}`);
    return false;
  }
}

// ── Main Hook ────────────────────────────────────────────────────

async function beforeAgentStart(event, ctx) {
  const now = Date.now();
  if (now - lastCaptureTime < COOLDOWN_MS) return undefined;

  const messages = event?.messages;
  if (!Array.isArray(messages) || messages.length === 0) return undefined;

  let captured = 0;

  // Only look at recent USER messages (not assistant/system)
  const recentUserMsgs = messages.slice(-6).filter(m => m?.role === 'user');

  for (const msg of recentUserMsgs) {
    const rawContent = typeof msg?.content === 'string' ? msg.content : '';
    const content = cleanContent(rawContent);

    if (shouldSkip(content)) continue;

    const categories = classifyMessage(content);
    if (categories.length === 0) continue;

    const dateStr = new Date().toISOString().slice(0, 10);
    const catLabel = categories.join('+');
    const storageText = `[${dateStr}|${catLabel}|user] ${content}`;

    // Dedup check
    if (isDuplicate(storageText)) {
      log(`DEDUP skip [${catLabel}]: ${content.slice(0, 60)}...`);
      continue;
    }

    if (storeInQdrant(storageText)) {
      captured++;
      const tokens = estimateTokens(storageText);
      log(`Captured [${catLabel}] (~${tokens}tok): ${content.slice(0, 80)}...`);
    }
  }

  if (captured > 0) {
    lastCaptureTime = now;
    log(`Turn: ${captured} item(s) captured`);
  }

  return undefined;
}

// ── Plugin Registration ──────────────────────────────────────────

function register(api) {
  const logger = api.log || console;
  logger.info('[nox-auto-capture] v2.1 registering (dedup + clean + privacy-tags + typed-obs)...');

  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
    logger.info('[nox-auto-capture] Registered before_agent_start via api.on()');
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
    logger.info('[nox-auto-capture] Registered before_agent_start via registerHook()');
  }
  logger.info('[nox-auto-capture] v2.1 ready');
}

const plugin = {
  id: 'nox-auto-capture',
  name: 'Nox Auto-Capture',
  description:
    'Captures corrections, decisions, facts, lessons, and preferences from conversations into Qdrant (v2.1: privacy tags + typed observations + token economics)',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { enabled: { type: 'boolean', default: true } }
  },
  register
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
