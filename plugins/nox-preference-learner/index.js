'use strict';
/**
 * nox-preference-learner v1.0 — OpenClaw Plugin
 *
 * "Train by Talking" — Learns behavioral preferences from conversation signals.
 *
 * Detects positive/negative feedback from the user and builds a preference
 * database that modifies agent behavior over time. Not RL in the classical
 * sense (no model fine-tuning), but a behavioral feedback loop:
 *
 *   1. DETECT: User signals approval/disapproval (explicit or implicit)
 *   2. CLASSIFY: Map signal to a behavior category
 *   3. STORE: Update preference scores (JSON file, lightweight)
 *   4. INJECT: Before each response, inject relevant preferences as context
 *
 * The agent doesn't change its weights — it changes its instructions based
 * on accumulated human feedback. RLHF-lite without touching the model.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ── Config ───────────────────────────────────────────────────────

const PREFS_FILE =
  process.env.PREFS_FILE ||
  path.join(
    process.env.OPENCLAW_WORKSPACE || process.env.HOME || '.',
    'memory',
    'preferences.json'
  );
const LOG_FILE = path.join(path.dirname(PREFS_FILE), 'preference-learner.log');
const MAX_INJECT_CHARS = 1500;
const COOLDOWN_MS = 5_000;
const DECAY_HALF_LIFE_DAYS = 30; // preferences fade if not reinforced

let lastProcessTime = 0;

// ── Feedback Signal Detection ────────────────────────────────────

const POSITIVE_SIGNALS = [
  // Explicit praise
  {
    pattern: /\b(perfekt|super|genau|richtig|gut gemacht|great|perfect|exactly|nice|👍|💪|🎯|❤️)/i,
    weight: 1.0
  },
  { pattern: /\b(das war gut|so will ich das|weiter so|genau so|keep it up)/i, weight: 1.5 },
  { pattern: /\b(mach|machen|mach das|go|do it|approved|freigegeben|passt)/i, weight: 0.5 }
  // Implicit: user continues on topic (no correction) — handled separately
];

const NEGATIVE_SIGNALS = [
  // Explicit criticism
  { pattern: /\b(nein|falsch|stimmt nicht|nicht so|wrong|stop|nervt|schlecht)/i, weight: -1.0 },
  { pattern: /\b(ernsthaft|echt jetzt|mensch nox|come on|seriously)/i, weight: -1.5 },
  { pattern: /\b(nie wieder|never again|hör auf|aufhören|lass das)/i, weight: -2.0 },
  { pattern: /\b(frag nicht|frag mich nicht|don't ask|just do it|einfach machen)/i, weight: -1.5 },
  // Frustration markers
  { pattern: /[!?]{3,}/i, weight: -0.5 },
  { pattern: /\b(immer und immer wieder|schon wieder|again and again)/i, weight: -2.0 }
];

// ── Behavior Categories ──────────────────────────────────────────
// Map detected patterns to behavioral dimensions

const BEHAVIOR_CATEGORIES = {
  autonomy: {
    description: 'Eigenständig handeln vs. nachfragen',
    triggers: [
      {
        pattern: /\b(frag nicht|frag mich nicht|einfach machen|just do|mach einfach)/i,
        direction: 'more'
      },
      { pattern: /\b(frag (mich |)erst|warte|check with me|ask first|stop)/i, direction: 'less' }
    ]
  },
  verbosity: {
    description: 'Kurz und knapp vs. ausführlich',
    triggers: [
      {
        pattern: /\b(zu (viel|lang)|kürzer|shorter|tldr|compress|fass dich kurz)/i,
        direction: 'less'
      },
      {
        pattern: /\b(mehr detail|ausführlicher|explain more|elaborate|genauer)/i,
        direction: 'more'
      }
    ]
  },
  proactivity: {
    description: 'Vorschläge machen vs. nur auf Anweisung',
    triggers: [
      { pattern: /\b(gute idee|good idea|das machen wir|interessant|clever)/i, direction: 'more' },
      {
        pattern: /\b(hab nicht gefragt|didn't ask|nicht nötig|brauch ich nicht|zu viel)/i,
        direction: 'less'
      }
    ]
  },
  formality: {
    description: 'Formell vs. locker',
    triggers: [
      { pattern: /\b(lockerer|entspannter|relaxter|less formal|chill)/i, direction: 'less' },
      { pattern: /\b(professioneller|formaler|more formal|seriöser)/i, direction: 'more' }
    ]
  },
  technical_depth: {
    description: 'Technische Details vs. High-Level',
    triggers: [
      {
        pattern: /\b(zeig mir den code|implementation|how does it work|wie genau)/i,
        direction: 'more'
      },
      {
        pattern: /\b(zu technisch|don't care how|egal wie|ergebnis|result only)/i,
        direction: 'less'
      }
    ]
  },
  confirmation_seeking: {
    description: 'Bestätigungen einholen vs. direkt handeln',
    triggers: [
      {
        pattern: /\b(frag nicht|mach einfach|just do|stop asking|hör auf zu fragen)/i,
        direction: 'less'
      },
      { pattern: /\b(zeig erst|show first|lass mich sehen|double check)/i, direction: 'more' }
    ]
  }
};

// ── Preference Store ─────────────────────────────────────────────

function loadPrefs() {
  try {
    if (fs.existsSync(PREFS_FILE)) {
      return JSON.parse(fs.readFileSync(PREFS_FILE, 'utf8'));
    }
  } catch {}
  return {
    version: 1,
    created: new Date().toISOString(),
    categories: {},
    signals: [], // Recent signal log (last 50)
    stats: { total_positive: 0, total_negative: 0, total_signals: 0 }
  };
}

function savePrefs(prefs) {
  prefs.updated = new Date().toISOString();
  // Keep only last 50 signals
  if (prefs.signals.length > 50) {
    prefs.signals = prefs.signals.slice(-50);
  }
  const dir = path.dirname(PREFS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PREFS_FILE, JSON.stringify(prefs, null, 2));
}

function applyDecay(prefs) {
  const now = Date.now();
  for (const [cat, data] of Object.entries(prefs.categories)) {
    if (!data.last_reinforced) continue;
    const daysSince = (now - new Date(data.last_reinforced).getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
    data.score = data.raw_score * decayFactor;
  }
}

// ── Signal Processing ────────────────────────────────────────────

function detectSignals(text) {
  const signals = [];

  // Check positive
  for (const sig of POSITIVE_SIGNALS) {
    if (sig.pattern.test(text)) {
      signals.push({ type: 'positive', weight: sig.weight, match: text.match(sig.pattern)?.[0] });
    }
  }

  // Check negative
  for (const sig of NEGATIVE_SIGNALS) {
    if (sig.pattern.test(text)) {
      signals.push({ type: 'negative', weight: sig.weight, match: text.match(sig.pattern)?.[0] });
    }
  }

  return signals;
}

function detectBehaviorCategory(text) {
  const categories = [];
  for (const [name, cat] of Object.entries(BEHAVIOR_CATEGORIES)) {
    for (const trigger of cat.triggers) {
      if (trigger.pattern.test(text)) {
        categories.push({
          name,
          direction: trigger.direction,
          match: text.match(trigger.pattern)?.[0]
        });
      }
    }
  }
  return categories;
}

function processMessage(text, prefs) {
  const signals = detectSignals(text);
  const behaviorHits = detectBehaviorCategory(text);

  if (signals.length === 0 && behaviorHits.length === 0) return false;

  const ts = new Date().toISOString();
  let updated = false;

  // Process behavior-specific feedback
  for (const hit of behaviorHits) {
    const cat = prefs.categories[hit.name] || {
      raw_score: 0,
      score: 0,
      reinforcements: 0,
      last_reinforced: null,
      direction_history: []
    };

    const delta = hit.direction === 'more' ? 1.0 : -1.0;
    // Amplify if there's also a strong signal
    const signalBoost = signals.reduce((sum, s) => sum + Math.abs(s.weight), 0) || 1.0;
    cat.raw_score += delta * signalBoost;
    cat.score = cat.raw_score;
    cat.reinforcements++;
    cat.last_reinforced = ts;
    cat.direction_history.push({ direction: hit.direction, ts, match: hit.match });
    if (cat.direction_history.length > 20) cat.direction_history = cat.direction_history.slice(-20);

    prefs.categories[hit.name] = cat;
    updated = true;

    log(
      `BEHAVIOR ${hit.name}: ${hit.direction} (score: ${cat.raw_score.toFixed(1)}, match: "${hit.match}")`
    );
  }

  // Process general sentiment signals (even without behavior category)
  for (const sig of signals) {
    prefs.signals.push({ type: sig.type, weight: sig.weight, match: sig.match, ts });
    if (sig.type === 'positive') prefs.stats.total_positive++;
    else prefs.stats.total_negative++;
    prefs.stats.total_signals++;
    updated = true;
  }

  return updated;
}

// ── Context Injection ────────────────────────────────────────────

function buildPreferenceContext(prefs) {
  applyDecay(prefs);

  const active = Object.entries(prefs.categories)
    .filter(([_, d]) => Math.abs(d.score) >= 1.0 && d.reinforcements >= 2)
    .sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score));

  if (active.length === 0) return '';

  let ctx = '## LEARNED PREFERENCES (from conversation feedback)\n';
  ctx += "These behavioral preferences were learned from the user's direct feedback.\n";
  ctx += 'Stronger scores = more consistent feedback. Apply them.\n\n';

  for (const [name, data] of active) {
    const catInfo = BEHAVIOR_CATEGORIES[name];
    const direction = data.score > 0 ? 'MORE' : 'LESS';
    const strength =
      Math.abs(data.score) >= 5 ? 'STRONG' : Math.abs(data.score) >= 2 ? 'CLEAR' : 'MILD';
    const lastMatch = data.direction_history?.slice(-1)?.[0]?.match || '';

    ctx += `- **${catInfo?.description || name}**: ${strength} preference for ${direction}`;
    ctx += ` (score: ${data.score.toFixed(1)}, ${data.reinforcements}x reinforced)`;
    if (lastMatch) ctx += ` — last trigger: "${lastMatch}"`;
    ctx += '\n';
  }

  // Add recent sentiment summary
  const recentSignals = prefs.signals.slice(-10);
  const recentPos = recentSignals.filter(s => s.type === 'positive').length;
  const recentNeg = recentSignals.filter(s => s.type === 'negative').length;
  if (recentSignals.length >= 3) {
    const mood =
      recentPos > recentNeg
        ? 'mostly positive'
        : recentNeg > recentPos
          ? 'mostly corrective'
          : 'mixed';
    ctx += `\nRecent feedback trend: ${mood} (${recentPos}+ / ${recentNeg}− in last ${recentSignals.length} signals)\n`;
  }

  return ctx.length <= MAX_INJECT_CHARS ? ctx : ctx.slice(0, MAX_INJECT_CHARS) + '\n...\n';
}

// ── Logging ──────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] ${msg}\n`);
  } catch {}
}

// ── Main Hook ────────────────────────────────────────────────────

async function beforeAgentStart(event, ctx) {
  const now = Date.now();
  const prefs = loadPrefs();

  // PHASE 1: Process new messages for feedback signals
  if (now - lastProcessTime >= COOLDOWN_MS) {
    const messages = event?.messages;
    if (Array.isArray(messages)) {
      const recentUser = messages.slice(-4).filter(m => m?.role === 'user');
      let anyUpdated = false;

      for (const msg of recentUser) {
        const text = typeof msg?.content === 'string' ? msg.content : '';
        if (text.length < 10) continue;
        // Clean metadata
        const clean = text
          .replace(/## LETZTER CHECKPOINT[\s\S]*?\*Aktualisiert:.*?\*/g, '')
          .replace(/Conversation info \(untrusted metadata\)[\s\S]*?```\s*/g, '')
          .replace(/Sender \(untrusted metadata\)[\s\S]*?```\s*/g, '')
          .trim();
        if (clean.length < 10) continue;

        if (processMessage(clean, prefs)) anyUpdated = true;
      }

      if (anyUpdated) {
        savePrefs(prefs);
        lastProcessTime = now;
      }
    }
  }

  // PHASE 2: Inject learned preferences as context
  const ctx_text = buildPreferenceContext(prefs);
  if (ctx_text) {
    return { prependContext: ctx_text };
  }

  return undefined;
}

// ── Plugin Registration ──────────────────────────────────────────

function register(api) {
  const logger = api.log || console;
  logger.info('[nox-preference-learner] v1.0 registering...');

  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
  }

  // Load existing prefs to log status
  const prefs = loadPrefs();
  const catCount = Object.keys(prefs.categories).length;
  const sigCount = prefs.stats?.total_signals || 0;
  logger.info(
    `[nox-preference-learner] v1.0 ready (${catCount} categories, ${sigCount} total signals)`
  );
}

const plugin = {
  id: 'nox-preference-learner',
  name: 'Nox Preference Learner',
  description:
    'Learns behavioral preferences from conversation feedback — RLHF-lite without model fine-tuning',
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
