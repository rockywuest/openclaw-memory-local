"use strict";
/**
 * nox-memory-suite — Meta-Plugin for openclaw-memory-local
 *
 * Activates all memory plugins with a single config entry.
 * Presets:
 *   - full:    all 8 plugins (default)
 *   - core:    capture + events + preconscious + emergency + preferences
 *   - minimal: capture + preferences only
 *
 * Individual plugins can be toggled via config.plugins overrides.
 *
 * Usage in openclaw.json:
 *   plugins.load.paths: ["/path/to/openclaw-memory-local/plugins/nox-memory-suite"]
 *   plugins.entries.nox-memory-suite: { enabled: true, preset: "full" }
 *
 * That's it. One path, one entry.
 */

const path = require("path");

// Plugin registry — id to directory name mapping
const PLUGIN_REGISTRY = {
  "auto-capture":      "nox-auto-capture",
  "event-bus":         "nox-event-bus",
  "preconscious":      "nox-preconscious",
  "emergency":         "nox-emergency",
  "preference-learner":"nox-preference-learner",
  "fademem":           "nox-fademem",
  "cooccurrence":      "nox-cooccurrence",
  "fingerprint":       "nox-fingerprint",
};

// Preset definitions
const PRESETS = {
  full: Object.keys(PLUGIN_REGISTRY),
  core: ["auto-capture", "event-bus", "preconscious", "emergency", "preference-learner"],
  minimal: ["auto-capture", "preference-learner"],
};

// Ordered loading (dependencies first)
const LOAD_ORDER = [
  "event-bus",          // Bus must be first — others may emit events
  "auto-capture",       // Core capture
  "preference-learner", // Learns from interactions
  "preconscious",       // Scores events from bus
  "emergency",          // Escalates from preconscious
  "fademem",            // Decay (independent)
  "cooccurrence",       // Co-occurrence tracking (independent)
  "fingerprint",        // Topology analysis (independent, runs last)
];

function resolvePluginPath(shortId) {
  const dirName = PLUGIN_REGISTRY[shortId];
  if (!dirName) return null;
  return path.resolve(__dirname, "..", dirName);
}

function register(api) {
  const logger = api.log || console;
  const config = api.config || {};
  const preset = config.preset || "full";
  const overrides = config.plugins || {};

  logger.info(`[nox-memory-suite] Initializing with preset: ${preset}`);

  // Determine which plugins to activate
  const presetPlugins = PRESETS[preset];
  if (!presetPlugins) {
    logger.error(`[nox-memory-suite] Unknown preset: ${preset}. Using 'full'.`);
  }
  const activeSet = new Set(presetPlugins || PRESETS.full);

  // Apply overrides
  for (const [id, enabled] of Object.entries(overrides)) {
    if (enabled === true) activeSet.add(id);
    if (enabled === false) activeSet.delete(id);
  }

  // Load in dependency order
  const loaded = [];
  const failed = [];

  for (const shortId of LOAD_ORDER) {
    if (!activeSet.has(shortId)) continue;

    const pluginPath = resolvePluginPath(shortId);
    if (!pluginPath) {
      logger.warn(`[nox-memory-suite] Unknown plugin: ${shortId}, skipping`);
      continue;
    }

    try {
      const subPlugin = require(pluginPath);
      if (typeof subPlugin.register === "function") {
        subPlugin.register(api);
        loaded.push(shortId);
      } else {
        logger.warn(`[nox-memory-suite] ${shortId} has no register(), skipping`);
        failed.push(shortId);
      }
    } catch (err) {
      logger.error(`[nox-memory-suite] Failed to load ${shortId}: ${err.message}`);
      failed.push(shortId);
      // Continue loading others — failure isolation
    }
  }

  logger.info(`[nox-memory-suite] Loaded ${loaded.length}/${activeSet.size}: [${loaded.join(", ")}]`);
  if (failed.length > 0) {
    logger.warn(`[nox-memory-suite] Failed: [${failed.join(", ")}]`);
  }
}

const plugin = {
  id: "nox-memory-suite",
  name: "Nox Memory Suite",
  description: "Meta-plugin: one entry activates the full cognitive memory stack",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      preset: { type: "string", enum: ["full", "core", "minimal"], default: "full" },
      plugins: {
        type: "object",
        additionalProperties: false,
        properties: {
          "auto-capture":       { type: "boolean" },
          "event-bus":          { type: "boolean" },
          "preconscious":       { type: "boolean" },
          "emergency":          { type: "boolean" },
          "preference-learner": { type: "boolean" },
          "fademem":            { type: "boolean" },
          "cooccurrence":       { type: "boolean" },
          "fingerprint":        { type: "boolean" },
        },
      },
    },
  },
  register,
};

module.exports = plugin;
