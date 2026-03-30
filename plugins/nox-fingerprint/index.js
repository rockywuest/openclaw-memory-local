'use strict';
/**
 * nox-fingerprint — OpenClaw Plugin
 *
 * Cognitive Fingerprint: Personality profile based on memory topology.
 * Analyzes distribution of events/memories across domains.
 *
 * Metrics:
 * - Domain Distribution (work, family, tech, finance, health, social, creative, system)
 * - Gini Coefficient (inequality of distribution)
 * - Top-3 Domains
 * - Topology Hash (SHA256 of distribution — changes when personality shifts)
 * - Drift Detection (>20% change from last fingerprint)
 *
 * Cooldown: 1x daily recalculation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOMAINS = ['work', 'family', 'tech', 'finance', 'health', 'social', 'creative', 'system'];

class CognitiveFingerprintEngine {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.driftThreshold = config.driftThreshold || 0.2;
    this.cooldownHours = config.cooldownHours || 24;
    this.fingerprintFile = path.join(workspaceRoot, 'memory', 'cognitive-fingerprint.json');
    this.eventFile = path.join(workspaceRoot, 'memory', 'events', 'bus.jsonl');
    this.ensureFingerprintFile();
  }

  ensureFingerprintFile() {
    const dir = path.dirname(this.fingerprintFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
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
      console.error(`[fingerprint] Failed to read events: ${err.message}`);
      return [];
    }
  }

  /**
   * Classify event into domain.
   * Simple keyword-based classification.
   */
  classifyDomain(event) {
    const content = JSON.stringify(event).toLowerCase();

    // Domain keywords
    const keywords = {
      work: ['brüggen', 'sap', 'horizon', 'meeting', 'project', 'office', 'work'],
      family: ['bea', 'noah', 'klara', 'eliah', 'family', 'home', 'wife', 'child'],
      tech: ['github', 'api', 'code', 'plugin', 'python', 'node', 'git', 'ai'],
      finance: ['invoice', 'payment', 'tax', 'steuerberater', 'beleg', 'rechnung'],
      health: ['doctor', 'health', 'sick', 'medicine', 'fitness'],
      social: ['friend', 'party', 'event', 'social', 'meet'],
      creative: ['podcast', 'creative', 'design', 'art', 'music'],
      system: ['cpu', 'disk', 'memory', 'backup', 'system', 'error']
    };

    // Score each domain
    const scores = {};
    for (const [domain, words] of Object.entries(keywords)) {
      scores[domain] = words.filter(w => content.includes(w)).length;
    }

    // Return domain with highest score, or "system" as default
    const topDomain = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

    return topDomain && topDomain[1] > 0 ? topDomain[0] : 'system';
  }

  /**
   * Calculate domain distribution.
   */
  calculateDistribution() {
    const events = this.readEvents();
    if (events.length === 0) {
      return DOMAINS.reduce((acc, d) => ({ ...acc, [d]: 0 }), {});
    }

    const counts = DOMAINS.reduce((acc, d) => ({ ...acc, [d]: 0 }), {});

    for (const event of events) {
      const domain = this.classifyDomain(event);
      counts[domain]++;
    }

    // Convert to percentages
    const total = events.length;
    const distribution = {};
    for (const domain of DOMAINS) {
      distribution[domain] = total > 0 ? counts[domain] / total : 0;
    }

    return distribution;
  }

  /**
   * Calculate Gini coefficient (inequality measure).
   * 0 = perfect equality, 1 = maximum inequality.
   */
  calculateGini(distribution) {
    const values = Object.values(distribution).sort((a, b) => a - b);
    const n = values.length;

    if (n === 0) return 0;

    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += (i + 1) * values[i];
    }

    const mean = values.reduce((a, b) => a + b, 0) / n;

    if (mean === 0) return 0;

    return (2 * sum) / (n * n * mean) - (n + 1) / n;
  }

  /**
   * Get top N domains.
   */
  getTopDomains(distribution, n = 3) {
    return Object.entries(distribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([domain, pct]) => ({ domain, pct }));
  }

  /**
   * Calculate topology hash.
   * SHA256 of sorted domain distribution (normalized to 2 decimals).
   */
  calculateTopologyHash(distribution) {
    const normalized = Object.entries(distribution)
      .sort((a, b) => a[0].localeCompare(b[0])) // Sort by domain name
      .map(([domain, pct]) => `${domain}:${pct.toFixed(2)}`)
      .join('|');

    return crypto.createHash('sha256').update(normalized).digest('hex');
  }

  /**
   * Generate fingerprint.
   */
  generateFingerprint() {
    const distribution = this.calculateDistribution();
    const gini = this.calculateGini(distribution);
    const top3 = this.getTopDomains(distribution, 3);
    const hash = this.calculateTopologyHash(distribution);

    return {
      timestamp: new Date().toISOString(),
      distribution,
      gini,
      top_domains: top3,
      topology_hash: hash
    };
  }

  /**
   * Load last fingerprint.
   */
  loadFingerprint() {
    if (!fs.existsSync(this.fingerprintFile)) return null;
    try {
      return JSON.parse(fs.readFileSync(this.fingerprintFile, 'utf8'));
    } catch (err) {
      console.error(`[fingerprint] Failed to load fingerprint: ${err.message}`);
      return null;
    }
  }

  /**
   * Save fingerprint.
   */
  saveFingerprint(fingerprint) {
    try {
      fs.writeFileSync(this.fingerprintFile, JSON.stringify(fingerprint, null, 2));
    } catch (err) {
      console.error(`[fingerprint] Failed to save fingerprint: ${err.message}`);
    }
  }

  /**
   * Check if recalculation is needed (cooldown).
   */
  needsRecalculation() {
    const last = this.loadFingerprint();
    if (!last) return true;

    const now = Date.now();
    const lastTime = new Date(last.timestamp).getTime();
    const age_hours = (now - lastTime) / (60 * 60 * 1000);

    return age_hours >= this.cooldownHours;
  }

  /**
   * Detect drift between two fingerprints.
   * Returns drift percentage (0-1).
   */
  detectDrift(oldFp, newFp) {
    if (!oldFp || !newFp) return 0;

    let totalDrift = 0;
    for (const domain of DOMAINS) {
      const oldPct = oldFp.distribution[domain] || 0;
      const newPct = newFp.distribution[domain] || 0;
      totalDrift += Math.abs(oldPct - newPct);
    }

    // Total drift is sum of absolute differences (max = 2.0)
    // Normalize to 0-1 range
    return totalDrift / 2;
  }

  /**
   * Update fingerprint (with drift detection).
   */
  updateFingerprint() {
    if (!this.needsRecalculation()) {
      return { updated: false };
    }

    const oldFp = this.loadFingerprint();
    const newFp = this.generateFingerprint();

    const drift = this.detectDrift(oldFp, newFp);
    const driftDetected = drift >= this.driftThreshold;

    if (driftDetected) {
      console.log(`[fingerprint] ⚠️ Cognitive Drift detected: ${(drift * 100).toFixed(1)}%`);
    }

    this.saveFingerprint(newFp);

    return {
      updated: true,
      drift,
      driftDetected,
      fingerprint: newFp
    };
  }

  /**
   * Generate context injection.
   */
  generateContextInjection() {
    const fp = this.loadFingerprint();
    if (!fp) return '';

    const lines = ['## 🧬 Cognitive Fingerprint (Memory Topology)', ''];

    // Top 3 domains
    const top3Str = fp.top_domains.map(d => `${d.domain} ${(d.pct * 100).toFixed(1)}%`).join(', ');

    lines.push(`**Profile:** ${top3Str}`);
    lines.push(`**Gini:** ${fp.gini.toFixed(3)} (${fp.gini < 0.5 ? 'balanced' : 'specialized'})`);
    lines.push(`**Hash:** ${fp.topology_hash.slice(0, 12)}...`);
    lines.push('');

    lines.push("*This fingerprint reflects your memory's topological structure.*");
    lines.push('', '---', '');

    return lines.join('\n');
  }

  /**
   * Get current fingerprint.
   */
  getFingerprint() {
    return this.loadFingerprint();
  }

  /**
   * Check drift explicitly.
   */
  checkDrift() {
    const result = this.updateFingerprint();
    return {
      drift: result.drift || 0,
      detected: result.driftDetected || false
    };
  }
}

// ── Plugin Registration ──────────────────────────────────────────

let fingerprintInstance = null;

async function beforeAgentStart(event, ctx) {
  if (!fingerprintInstance) return undefined;

  // Update fingerprint (respects cooldown)
  const result = fingerprintInstance.updateFingerprint();

  if (result.updated && result.driftDetected) {
    console.log(`[fingerprint] Drift: ${(result.drift * 100).toFixed(1)}% — Topology changed`);
  }

  // Inject current profile
  const injection = fingerprintInstance.generateContextInjection();
  if (!injection) return undefined;

  return {
    systemMessage: injection
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info('[nox-fingerprint] Initializing...');

  fingerprintInstance = new CognitiveFingerprintEngine(workspace, config);

  // Register hook
  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
    logger.info('[nox-fingerprint] Registered before_agent_start via api.on()');
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
    logger.info('[nox-fingerprint] Registered before_agent_start via registerHook()');
  }

  // Expose for other plugins
  if (api.shared) {
    api.shared.cognitiveFingerprint = fingerprintInstance;
    logger.info('[nox-fingerprint] Exposed as api.shared.cognitiveFingerprint');
  }

  // Export functions
  if (api.export) {
    api.export('getFingerprint', () => fingerprintInstance.getFingerprint());
    api.export('checkDrift', () => fingerprintInstance.checkDrift());
    logger.info('[nox-fingerprint] Exported getFingerprint(), checkDrift()');
  }

  logger.info('[nox-fingerprint] Ready');
}

const plugin = {
  id: 'nox-fingerprint',
  name: 'Nox Cognitive Fingerprint',
  description: 'Memory topology-based personality fingerprint with drift detection',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      driftThreshold: { type: 'number', default: 0.2, minimum: 0, maximum: 1 },
      cooldownHours: { type: 'number', default: 24, minimum: 1 }
    }
  },
  register
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.CognitiveFingerprintEngine = CognitiveFingerprintEngine; // For testing
