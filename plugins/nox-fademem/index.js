"use strict";
/**
 * nox-fademem — OpenClaw Plugin
 *
 * Access-weighted Memory Decay.
 * Memories that are never retrieved gradually fade.
 * Frequently accessed memories gain strength.
 *
 * Core Algorithm:
 * - Tracks every memory access (Qdrant queries)
 * - Base score: importance × access_frequency × recency_factor
 * - Half-life: 30 days (configurable)
 * - Memories with score < 0.3 are "fading"
 *
 * Outputs:
 * - Injection: Top fading memories as warnings
 * - Export: getFadeScores() for analysis
 */

const fs = require("fs");
const path = require("path");

class FadeMemEngine {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.halfLifeDays = config.halfLifeDays || 30;
    this.maxFadingWarnings = config.maxFadingWarnings || 5;
    this.accessLog = path.join(workspaceRoot, "memory", "fademem-access.jsonl");
    this.ensureAccessLog();
  }

  ensureAccessLog() {
    const dir = path.dirname(this.accessLog);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.accessLog)) {
      fs.writeFileSync(this.accessLog, "");
    }
  }

  /**
   * Track a memory access.
   * @param {string} memoryId - Memory identifier (e.g., Qdrant point ID)
   * @param {string} query - Search query that retrieved this memory
   * @param {number} importance - Base importance score (0-1)
   */
  trackAccess(memoryId, query, importance = 0.5) {
    const entry = {
      timestamp: new Date().toISOString(),
      memory_id: memoryId,
      query,
      importance,
    };

    try {
      fs.appendFileSync(this.accessLog, JSON.stringify(entry) + "\n");
    } catch (err) {
      console.error(`[fademem] Failed to track access: ${err.message}`);
    }
  }

  /**
   * Read all access records.
   */
  readAccessLog() {
    if (!fs.existsSync(this.accessLog)) return [];
    try {
      const lines = fs.readFileSync(this.accessLog, "utf8").trim().split("\n");
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[fademem] Failed to read access log: ${err.message}`);
      return [];
    }
  }

  /**
   * Calculate fade score for a memory.
   * Score = base_importance × access_frequency × recency_factor
   * 
   * Recency factor uses exponential decay with configurable half-life.
   * Access frequency = number of times accessed / total accesses (normalized).
   */
  calculateFadeScore(memoryId, baseImportance = 0.5) {
    const accesses = this.readAccessLog().filter(a => a.memory_id === memoryId);
    
    if (accesses.length === 0) {
      // Never accessed → pure decay from creation
      return baseImportance * this.getRecencyFactor(null);
    }

    // Get most recent access
    const mostRecent = accesses.reduce((latest, current) => {
      const latestTime = new Date(latest.timestamp).getTime();
      const currentTime = new Date(current.timestamp).getTime();
      return currentTime > latestTime ? current : latest;
    });

    const lastAccessTime = new Date(mostRecent.timestamp).getTime();
    const recencyFactor = this.getRecencyFactor(lastAccessTime);

    // Access frequency: normalized by total accesses
    const totalAccesses = this.readAccessLog().length;
    const accessFrequency = totalAccesses > 0 ? accesses.length / totalAccesses : 0;

    // Boost for frequent access (logarithmic to prevent runaway)
    // Only apply boost for multiple accesses (>1)
    const frequencyBoost = accesses.length > 1 
      ? 1 + Math.log10(1 + (accesses.length - 1) * 9)
      : 1.0;

    const score = baseImportance * frequencyBoost * recencyFactor * (1 + accessFrequency);

    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Calculate recency factor using exponential decay.
   * Half-life = configurable days.
   */
  getRecencyFactor(lastAccessTime) {
    const now = Date.now();
    const age_ms = lastAccessTime ? now - lastAccessTime : now;
    const age_days = age_ms / (24 * 60 * 60 * 1000);
    
    // Exponential decay: 0.5^(age_days / half_life)
    return Math.pow(0.5, age_days / this.halfLifeDays);
  }

  /**
   * Get all memories with their fade scores.
   * Returns Map<memoryId, {score, lastAccess, accessCount}>
   */
  getFadeScores() {
    const accesses = this.readAccessLog();
    const memoryMap = new Map();

    // Group by memory_id
    for (const access of accesses) {
      if (!memoryMap.has(access.memory_id)) {
        memoryMap.set(access.memory_id, {
          importance: access.importance,
          accesses: [],
        });
      }
      memoryMap.get(access.memory_id).accesses.push(access);
    }

    // Calculate scores
    const scores = new Map();
    for (const [memoryId, data] of memoryMap) {
      const score = this.calculateFadeScore(memoryId, data.importance);
      const lastAccess = data.accesses.reduce((latest, current) => {
        const latestTime = new Date(latest.timestamp).getTime();
        const currentTime = new Date(current.timestamp).getTime();
        return currentTime > latestTime ? current : latest;
      });

      scores.set(memoryId, {
        score,
        lastAccess: lastAccess.timestamp,
        accessCount: data.accesses.length,
      });
    }

    return scores;
  }

  /**
   * Get top fading memories (lowest scores).
   */
  getFadingMemories(limit = 5) {
    const scores = this.getFadeScores();
    const sorted = Array.from(scores.entries())
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => a.score - b.score); // Lowest first

    return sorted.slice(0, limit).filter(m => m.score < 0.3); // Only truly fading
  }

  /**
   * Generate context injection for agent.
   */
  generateContextInjection() {
    const fading = this.getFadingMemories(this.maxFadingWarnings);
    if (fading.length === 0) return "";

    const lines = ["## ⚠️ Fading Memories (Access-Weighted Decay)", ""];
    lines.push("These memories are losing strength due to lack of access:", "");

    for (const mem of fading) {
      const lastAccess = new Date(mem.lastAccess).toISOString().slice(0, 10);
      const scorePercent = (mem.score * 100).toFixed(1);
      lines.push(`- **Memory ${mem.id.slice(0, 8)}** — Score: ${scorePercent}% | Last: ${lastAccess} | Accesses: ${mem.accessCount}`);
    }

    lines.push("", "*Consider reviewing these memories to prevent loss of important context.*", "", "---", "");

    return lines.join("\n");
  }

  /**
   * Simulate Qdrant query tracking.
   * In production, this would hook into actual Qdrant search results.
   */
  trackQdrantQuery(queryResults = [], query = "") {
    for (const result of queryResults) {
      if (result.id && result.score) {
        this.trackAccess(result.id, query, result.score);
      }
    }
  }
}

// ── Plugin Registration ──────────────────────────────────────────

let fadeMemInstance = null;

async function beforeAgentStart(event, ctx) {
  if (!fadeMemInstance) return undefined;

  // Generate fading memory warnings
  const injection = fadeMemInstance.generateContextInjection();
  if (!injection) return undefined;

  return {
    systemMessage: injection,
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info("[nox-fademem] Initializing...");

  fadeMemInstance = new FadeMemEngine(workspace, config);

  // Register hook
  if (api.on) {
    api.on("before_agent_start", beforeAgentStart);
    logger.info("[nox-fademem] Registered before_agent_start via api.on()");
  } else if (api.registerHook) {
    api.registerHook("before_agent_start", beforeAgentStart);
    logger.info("[nox-fademem] Registered before_agent_start via registerHook()");
  }

  // Expose for other plugins
  if (api.shared) {
    api.shared.fadeMemEngine = fadeMemInstance;
    logger.info("[nox-fademem] Exposed as api.shared.fadeMemEngine");
  }

  // Export getFadeScores function
  if (api.export) {
    api.export("getFadeScores", () => fadeMemInstance.getFadeScores());
    logger.info("[nox-fademem] Exported getFadeScores()");
  }

  logger.info("[nox-fademem] Ready");
}

const plugin = {
  id: "nox-fademem",
  name: "Nox FadeMem",
  description: "Access-weighted Memory Decay — memories that are never retrieved fade",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean", default: true },
      halfLifeDays: { type: "number", default: 30, minimum: 1 },
      maxFadingWarnings: { type: "number", default: 5, minimum: 1, maximum: 20 },
    },
  },
  register,
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.FadeMemEngine = FadeMemEngine; // For testing
