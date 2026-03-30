'use strict';
/**
 * nox-cooccurrence — OpenClaw Plugin
 *
 * Hebbian Learning: "Neurons that fire together, wire together."
 * Tracks which concepts/keywords appear together in sessions.
 *
 * Features:
 * - Co-occurrence matrix stored in JSONL
 * - Strength = count × recency_decay (half-life 20h)
 * - Concept extraction: keyword-based (no LLM)
 * - Association injection: related concepts injected when one appears
 *
 * Format:
 * {concept_a, concept_b, count, last_seen, strength}
 */

const fs = require('fs');
const path = require('path');

class CooccurrenceEngine {
  constructor(workspaceRoot, config = {}) {
    this.workspaceRoot = workspaceRoot;
    this.halfLifeHours = config.halfLifeHours || 20;
    this.maxAssociations = config.maxAssociations || 10;
    this.minStrength = config.minStrength || 0.3;
    this.matrixFile = path.join(workspaceRoot, 'memory', 'cooccurrence.jsonl');
    this.knownConcepts = this.loadKnownConcepts();
    this.ensureMatrixFile();
  }

  ensureMatrixFile() {
    const dir = path.dirname(this.matrixFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.matrixFile)) {
      fs.writeFileSync(this.matrixFile, '');
    }
  }

  /**
   * Load known concepts/entities for extraction.
   * In a full implementation, this could be loaded from a knowledge base.
   */
  loadKnownConcepts() {
    return new Set([
      // People
      'Rocky',
      'Brüggen',
      'Joachim',
      'Bea',
      'Noah',
      'Klara',
      'Eliah',
      'Mareike',
      'Melina',
      'Alexander',

      // Companies / Projects
      'SAP',
      'Horizon',
      'F&W',
      'FRECH & WUEST',
      'eGbR',

      // Topics
      'Exit',
      'Workshop',
      'AI',
      'Recruiting',
      'Stress',
      'Family',
      'Podcast',
      'Hamburg',
      'Lübeck',
      'PiDog',
      'OpenClaw',

      // Tech
      'GitHub',
      'Qdrant',
      'Node.js',
      'Python',
      'JavaScript',
      'API',
      'Plugin',
      'Memory',
      'Agent',

      // Domains
      'work',
      'tech',
      'finance',
      'health',
      'social',
      'creative',
      'system'
    ]);
  }

  /**
   * Extract concepts from text using keyword matching.
   * Returns Set of found concepts.
   */
  extractConcepts(text) {
    if (!text) return new Set();

    const found = new Set();
    const normalized = text.toLowerCase();

    for (const concept of this.knownConcepts) {
      // Case-insensitive match with word boundaries
      const regex = new RegExp(`\\b${concept.toLowerCase()}\\b`, 'i');
      if (regex.test(normalized)) {
        found.add(concept);
      }
    }

    return found;
  }

  /**
   * Read co-occurrence matrix from JSONL.
   */
  readMatrix() {
    if (!fs.existsSync(this.matrixFile)) return [];
    try {
      const lines = fs.readFileSync(this.matrixFile, 'utf8').trim().split('\n');
      return lines.filter(l => l.trim()).map(l => JSON.parse(l));
    } catch (err) {
      console.error(`[cooccurrence] Failed to read matrix: ${err.message}`);
      return [];
    }
  }

  /**
   * Write co-occurrence matrix to JSONL.
   */
  writeMatrix(matrix) {
    try {
      const content = matrix.map(m => JSON.stringify(m)).join('\n') + '\n';
      fs.writeFileSync(this.matrixFile, content);
    } catch (err) {
      console.error(`[cooccurrence] Failed to write matrix: ${err.message}`);
    }
  }

  /**
   * Get pair key (sorted for consistency).
   */
  getPairKey(conceptA, conceptB) {
    return [conceptA, conceptB].sort().join('::');
  }

  /**
   * Record co-occurrence of concepts.
   */
  recordCooccurrence(concepts) {
    if (concepts.size < 2) return; // Need at least 2 concepts

    const matrix = this.readMatrix();
    const matrixMap = new Map();

    // Load existing entries into map
    for (const entry of matrix) {
      const key = this.getPairKey(entry.concept_a, entry.concept_b);
      matrixMap.set(key, entry);
    }

    const now = new Date().toISOString();
    const conceptArray = Array.from(concepts);

    // Record all pairs
    for (let i = 0; i < conceptArray.length; i++) {
      for (let j = i + 1; j < conceptArray.length; j++) {
        const conceptA = conceptArray[i];
        const conceptB = conceptArray[j];
        const key = this.getPairKey(conceptA, conceptB);

        if (matrixMap.has(key)) {
          const entry = matrixMap.get(key);
          entry.count++;
          entry.last_seen = now;
          entry.strength = this.calculateStrength(entry.count, entry.last_seen);
        } else {
          matrixMap.set(key, {
            concept_a: conceptA,
            concept_b: conceptB,
            count: 1,
            last_seen: now,
            strength: this.calculateStrength(1, now)
          });
        }
      }
    }

    // Write back
    this.writeMatrix(Array.from(matrixMap.values()));
  }

  /**
   * Calculate association strength.
   * Strength = count × recency_decay
   */
  calculateStrength(count, lastSeen) {
    const now = Date.now();
    const lastSeenTime = new Date(lastSeen).getTime();
    const age_ms = now - lastSeenTime;
    const age_hours = age_ms / (60 * 60 * 1000);

    // Exponential decay: 0.5^(age_hours / half_life)
    const decay = Math.pow(0.5, age_hours / this.halfLifeHours);

    return count * decay;
  }

  /**
   * Get associations for a concept.
   * Returns sorted array of {concept, strength}.
   */
  getAssociations(concept) {
    const matrix = this.readMatrix();
    const associations = [];

    for (const entry of matrix) {
      let matchedConcept = null;

      if (entry.concept_a === concept) {
        matchedConcept = entry.concept_b;
      } else if (entry.concept_b === concept) {
        matchedConcept = entry.concept_a;
      }

      if (matchedConcept && entry.strength >= this.minStrength) {
        associations.push({
          concept: matchedConcept,
          strength: entry.strength,
          count: entry.count,
          last_seen: entry.last_seen
        });
      }
    }

    // Sort by strength descending
    associations.sort((a, b) => b.strength - a.strength);

    return associations.slice(0, this.maxAssociations);
  }

  /**
   * Generate context injection for concepts in current context.
   */
  generateContextInjection(contextText) {
    const concepts = this.extractConcepts(contextText);
    if (concepts.size === 0) return '';

    const lines = ['## 🧠 Associative Memory (Co-occurrence)', ''];
    let hasAssociations = false;

    for (const concept of concepts) {
      const associations = this.getAssociations(concept);
      if (associations.length > 0) {
        hasAssociations = true;
        const assocList = associations
          .slice(0, 5) // Top 5
          .map(a => `${a.concept} (${a.strength.toFixed(2)})`)
          .join(', ');
        lines.push(`- **${concept}** → ${assocList}`);
      }
    }

    if (!hasAssociations) return '';

    lines.push('', '*These concepts frequently appear together in your memory.*', '', '---', '');

    return lines.join('\n');
  }

  /**
   * Get full co-occurrence matrix.
   */
  getCooccurrenceMatrix() {
    return this.readMatrix();
  }

  /**
   * Prune weak associations.
   */
  pruneWeakAssociations() {
    const matrix = this.readMatrix();
    const filtered = matrix.filter(entry => {
      const strength = this.calculateStrength(entry.count, entry.last_seen);
      return strength >= this.minStrength;
    });

    if (filtered.length < matrix.length) {
      this.writeMatrix(filtered);
      console.log(`[cooccurrence] Pruned ${matrix.length - filtered.length} weak associations`);
    }
  }
}

// ── Plugin Registration ──────────────────────────────────────────

let cooccurrenceInstance = null;

async function beforeAgentStart(event, ctx) {
  if (!cooccurrenceInstance) return undefined;

  // Prune weak associations periodically
  cooccurrenceInstance.pruneWeakAssociations();

  // Extract concepts from user message (if available)
  const userMessage = event?.userMessage || ctx?.userMessage || '';
  if (userMessage) {
    const concepts = cooccurrenceInstance.extractConcepts(userMessage);
    if (concepts.size > 0) {
      cooccurrenceInstance.recordCooccurrence(concepts);
    }
  }

  // Generate association injection
  const fullContext = [event?.systemMessage || '', userMessage].join(' ');

  const injection = cooccurrenceInstance.generateContextInjection(fullContext);
  if (!injection) return undefined;

  return {
    systemMessage: injection
  };
}

function register(api) {
  const logger = api.log || console;
  const workspace = api.workspace || process.env.OPENCLAW_WORKSPACE || process.cwd();
  const config = api.config || {};

  logger.info('[nox-cooccurrence] Initializing...');

  cooccurrenceInstance = new CooccurrenceEngine(workspace, config);

  // Register hook
  if (api.on) {
    api.on('before_agent_start', beforeAgentStart);
    logger.info('[nox-cooccurrence] Registered before_agent_start via api.on()');
  } else if (api.registerHook) {
    api.registerHook('before_agent_start', beforeAgentStart);
    logger.info('[nox-cooccurrence] Registered before_agent_start via registerHook()');
  }

  // Expose for other plugins
  if (api.shared) {
    api.shared.cooccurrenceEngine = cooccurrenceInstance;
    logger.info('[nox-cooccurrence] Exposed as api.shared.cooccurrenceEngine');
  }

  // Export functions
  if (api.export) {
    api.export('getAssociations', concept => cooccurrenceInstance.getAssociations(concept));
    api.export('getCooccurrenceMatrix', () => cooccurrenceInstance.getCooccurrenceMatrix());
    logger.info('[nox-cooccurrence] Exported getAssociations(), getCooccurrenceMatrix()');
  }

  logger.info('[nox-cooccurrence] Ready');
}

const plugin = {
  id: 'nox-cooccurrence',
  name: 'Nox Co-occurrence',
  description: 'Hebbian Learning — tracks concept co-occurrences for associative memory',
  configSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean', default: true },
      halfLifeHours: { type: 'number', default: 20, minimum: 1 },
      maxAssociations: { type: 'number', default: 10, minimum: 1, maximum: 50 },
      minStrength: { type: 'number', default: 0.3, minimum: 0, maximum: 1 }
    }
  },
  register
};

module.exports = plugin;
module.exports.plugin = plugin;
module.exports.register = register;
module.exports.default = plugin;
module.exports.CooccurrenceEngine = CooccurrenceEngine; // For testing
