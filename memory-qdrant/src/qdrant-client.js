"use strict";
/**
 * Qdrant client via mcporter CLI.
 *
 * Uses execFile (no shell interpretation) for safe command execution.
 * Requires mcporter configured with a qdrant-memory server.
 */

const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

// Health check cache
let lastHealthCheck = 0;
let isHealthyCache = false;
const HEALTH_CHECK_INTERVAL = 30000;

let _serverName = "qdrant-memory";

function configure(opts) {
  if (opts?.serverName) _serverName = opts.serverName;
}

async function isHealthy() {
  const now = Date.now();
  if (now - lastHealthCheck < HEALTH_CHECK_INTERVAL) {
    return isHealthyCache;
  }
  try {
    const { stdout } = await execFileAsync("mcporter", ["list"], { timeout: 10000 });
    isHealthyCache = stdout.includes(_serverName) && stdout.includes("healthy");
    lastHealthCheck = now;
    return isHealthyCache;
  } catch {
    isHealthyCache = false;
    lastHealthCheck = now;
    return false;
  }
}

/**
 * Search Qdrant via mcporter (no shell interpretation)
 */
async function searchMemories(query, limit = 5) {
  try {
    const safeQuery = query.substring(0, 200);
    const { stdout } = await execFileAsync(
      "mcporter",
      ["call", `${_serverName}.qdrant-find`, `query=${safeQuery}`],
      { timeout: 30000 }
    );

    try {
      const results = JSON.parse(stdout);
      if (Array.isArray(results)) {
        return results.slice(0, limit).map((r, i) => ({
          id: r.id || `result-${i}`,
          score: r.score || 1.0,
          content: r.content || r.text || r.document || (typeof r === "string" ? r : ""),
          metadata: r.metadata || {},
        }));
      }
      return [];
    } catch {
      const lines = stdout.split("\n").filter(l => l.trim());
      return lines.slice(0, limit).map((line, i) => ({
        id: `result-${i}`,
        score: 0.8,
        content: line.replace(/<[^>]+>/g, "").trim(),
        metadata: {},
      }));
    }
  } catch (error) {
    console.error("[memory-qdrant] Search error:", error.message);
    return [];
  }
}

async function storeMemory(text, metadata = {}) {
  try {
    const args = ["call", `${_serverName}.qdrant-store`, `information=${text}`];
    if (Object.keys(metadata).length > 0) {
      args.push(`metadata=${JSON.stringify(metadata)}`);
    }
    await execFileAsync("mcporter", args, { timeout: 30000 });
    return true;
  } catch (error) {
    console.error("[memory-qdrant] Store error:", error.message);
    return false;
  }
}

async function getStats() {
  const healthy = await isHealthy();
  return { healthy, backend: "mcporter/qdrant", serverName: _serverName };
}

module.exports = { isHealthy, searchMemories, storeMemory, getStats, configure };
