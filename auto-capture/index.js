"use strict";
/**
 * auto-capture — OpenClaw Plugin
 *
 * Automatically extracts and stores important facts from conversations
 * into Qdrant via mcporter.
 *
 * What gets captured:
 * - Corrections ("wrong", "that's not right", etc. — supports EN+DE)
 * - Decisions ("wir machen X", "let's do X")
 * - Facts (dates, prices, contacts, versions)
 * - Lessons ("Fehler", "nie wieder", "rule")
 *
 * What gets skipped:
 * - Greetings, heartbeats, trivial messages
 * - Messages shorter than configurable threshold
 *
 * Part of: openclaw-memory-local
 * License: MIT
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const execFileAsync = promisify(execFile);

const DEFAULT_MIN_LENGTH = 20;
const DEFAULT_MAX_STORE = 500;
const DEFAULT_COOLDOWN_MS = 10_000;

// ── Pattern Detection ────────────────────────────────────────────

const CORRECTION_PATTERNS = [
  // Multilingual correction detection (EN + DE)
  /\b(nein|falsch|stimmt nicht|nicht richtig|das ist falsch|korrektur|korrigier)/i,
  /\b(actually|wrong|incorrect|correction|that's not|no,\s)/i,
];

const DECISION_PATTERNS = [
  /\b(wir machen|lass uns|ich entscheide|wir nehmen|machen wir|decision|let's do)/i,
  /\b(ab jetzt|von jetzt an|neue regel|ab sofort)/i,
];

const FACT_PATTERNS = [
  /\b(kostet|preis|€|EUR|\$|USD)\b/i,
  /\b(termin|datum|deadline|bis zum|am \d{1,2}\.\d{1,2})/i,
  /\b(email|telefon|adresse|kontakt)\s*[:=]/i,
  /\b(version|update|release|v\d+)/i,
];

const LESSON_PATTERNS = [
  /\b(fehler|mistake|bug|lesson|nie wieder|never again|regel|rule)/i,
  /\b(wichtig|merken|remember|aufpassen|vorsicht|achtung)/i,
];

const DEFAULT_SKIP_PATTERNS = [
  // Skip short greetings (EN + DE)
  /^(hi|hey|hallo|moin|ok|ja|nein|danke|thanks|👍|❤️|😂)$/i,
  /^HEARTBEAT/i,
  /^NO_REPLY$/,
  /^\[System/,
  /^BOOT/i,
];

// ── Helpers ──────────────────────────────────────────────────────

function classifyMessage(text) {
  const categories = [];
  for (const p of CORRECTION_PATTERNS) if (p.test(text)) { categories.push("correction"); break; }
  for (const p of DECISION_PATTERNS) if (p.test(text)) { categories.push("decision"); break; }
  for (const p of FACT_PATTERNS) if (p.test(text)) { categories.push("fact"); break; }
  for (const p of LESSON_PATTERNS) if (p.test(text)) { categories.push("lesson"); break; }
  return categories;
}

function shouldSkip(text, minLength, skipPatterns) {
  if (!text || text.length < minLength) return true;
  return skipPatterns.some((p) => p.test(text.trim()));
}

async function storeInQdrant(text, serverName, maxStore) {
  const truncated = text.length > maxStore ? text.slice(0, maxStore) + "..." : text;
  try {
    await execFileAsync(
      "mcporter",
      ["call", `${serverName}.qdrant-store`, `information=${truncated}`],
      { timeout: 15_000 }
    );
    return true;
  } catch (err) {
    console.error("[auto-capture] Store failed:", err.message?.slice(0, 100));
    return false;
  }
}

// ── Main Hook ────────────────────────────────────────────────────

function createBeforeAgentStart(config) {
  const minLength = config?.minMessageLength || DEFAULT_MIN_LENGTH;
  const maxStore = config?.maxStoreLength || DEFAULT_MAX_STORE;
  const cooldownMs = config?.cooldownMs || DEFAULT_COOLDOWN_MS;
  const serverName = config?.serverName || "qdrant-memory";
  const logFile = config?.logFile || null;
  const skipPatterns = [...DEFAULT_SKIP_PATTERNS];

  // Add custom skip patterns
  if (Array.isArray(config?.skipPatterns)) {
    for (const p of config.skipPatterns) {
      try { skipPatterns.push(new RegExp(p, "i")); } catch { /* invalid regex */ }
    }
  }

  let lastCaptureTime = 0;

  function log(msg) {
    const ts = new Date().toISOString().slice(0, 19).replace("T", " ");
    const line = `[${ts}] ${msg}\n`;
    if (logFile) {
      try { fs.appendFileSync(logFile, line); } catch { /* silent */ }
    }
    console.log(`[auto-capture] ${msg}`);
  }

  return async function beforeAgentStart(event, ctx) {
    const now = Date.now();
    if (now - lastCaptureTime < cooldownMs) return undefined;

    let captured = 0;
    const messages = event?.messages;

    if (Array.isArray(messages) && messages.length > 0) {
      const recentMessages = messages.slice(-4);
      for (const msg of recentMessages) {
        const role = msg?.role;
        const content = typeof msg?.content === "string" ? msg.content : "";
        if (shouldSkip(content, minLength, skipPatterns)) continue;

        const categories = classifyMessage(content);
        if (categories.length === 0) continue;

        const dateStr = new Date().toISOString().slice(0, 10);
        const roleLabel = role === "user" ? "user" : "assistant";
        const catLabel = categories.join("+");
        const storageText = `[${dateStr}|${catLabel}|${roleLabel}] ${content}`;

        if (await storeInQdrant(storageText, serverName, maxStore)) {
          captured++;
          log(`Captured [${catLabel}] from ${roleLabel}: ${content.slice(0, 80)}...`);
        }
      }
    }

    // Fallback: event.prompt
    if (captured === 0 && event?.prompt) {
      const prompt = typeof event.prompt === "string" ? event.prompt : "";
      if (!shouldSkip(prompt, minLength, skipPatterns)) {
        const categories = classifyMessage(prompt);
        if (categories.length > 0) {
          const dateStr = new Date().toISOString().slice(0, 10);
          const catLabel = categories.join("+");
          const storageText = `[${dateStr}|${catLabel}|user] ${prompt}`;
          if (await storeInQdrant(storageText, serverName, maxStore)) {
            captured++;
            log(`Captured [${catLabel}] from prompt: ${prompt.slice(0, 80)}...`);
          }
        }
      }
    }

    if (captured > 0) {
      lastCaptureTime = now;
      log(`Turn: ${captured} item(s) captured`);
    }

    return undefined; // Never injects context
  };
}

// ── Plugin Registration ──────────────────────────────────────────

function register(api) {
  const log = api.log || console;
  log.info("[auto-capture] Registering...");

  const config = api.config || {};
  const hook = createBeforeAgentStart(config);

  if (api.on) {
    api.on("before_agent_start", hook);
  } else if (api.registerHook) {
    api.registerHook("before_agent_start", hook);
  }

  log.info("[auto-capture] Registered successfully");
}

const plugin = {
  id: "auto-capture",
  name: "Auto-Capture",
  description: "Automatically captures corrections, decisions, facts, and lessons into Qdrant",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      serverName: { type: "string", default: "qdrant-memory", description: "mcporter server name" },
      minMessageLength: { type: "number", default: 20, description: "Minimum message length to consider" },
      maxStoreLength: { type: "number", default: 500, description: "Max chars stored per memory" },
      cooldownMs: { type: "number", default: 10000, description: "Cooldown between captures" },
      logFile: { type: "string", description: "Optional log file path" },
      skipPatterns: {
        type: "array",
        items: { type: "string" },
        description: "Additional regex patterns to skip (case-insensitive)",
      },
    },
  },
  register,
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
