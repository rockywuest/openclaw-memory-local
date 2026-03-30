'use strict';
/**
 * Tests for nox-cooccurrence plugin.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { CooccurrenceEngine } = require('../plugins/nox-cooccurrence/index.js');

describe('nox-cooccurrence', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-cooccur-test-'));
    engine = new CooccurrenceEngine(tmpDir, {
      halfLifeHours: 20,
      maxAssociations: 10,
      minStrength: 0.3
    });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('extractConcepts', () => {
    it('extracts known concepts from text', () => {
      const text = 'Rocky is working on SAP Horizon project with Joachim in Lübeck';
      const concepts = engine.extractConcepts(text);

      assert.ok(concepts.has('Rocky'));
      assert.ok(concepts.has('SAP'));
      assert.ok(concepts.has('Horizon'));
      assert.ok(concepts.has('Joachim'));
      assert.ok(concepts.has('Lübeck'));
    });

    it('is case-insensitive', () => {
      const text = 'rocky is working on sap';
      const concepts = engine.extractConcepts(text);

      assert.ok(concepts.has('Rocky'));
      assert.ok(concepts.has('SAP'));
    });

    it('handles empty text', () => {
      const concepts = engine.extractConcepts('');
      assert.equal(concepts.size, 0);
    });

    it('returns empty set for unknown concepts', () => {
      const text = 'some random text without known entities';
      const concepts = engine.extractConcepts(text);

      // May find some generic concepts like "work" but won't find random words
      assert.ok(!concepts.has('random'));
      assert.ok(!concepts.has('entities'));
    });
  });

  describe('recordCooccurrence', () => {
    it('records co-occurrence of two concepts', () => {
      const concepts = new Set(['Rocky', 'SAP']);
      engine.recordCooccurrence(concepts);

      const matrix = engine.readMatrix();
      assert.equal(matrix.length, 1);
      assert.ok(matrix[0].concept_a === 'Rocky' || matrix[0].concept_a === 'SAP');
      assert.ok(matrix[0].concept_b === 'Rocky' || matrix[0].concept_b === 'SAP');
      assert.equal(matrix[0].count, 1);
      assert.ok(matrix[0].strength);
    });

    it('increments count for repeated co-occurrence', () => {
      const concepts = new Set(['Rocky', 'Brüggen']);

      engine.recordCooccurrence(concepts);
      engine.recordCooccurrence(concepts);
      engine.recordCooccurrence(concepts);

      const matrix = engine.readMatrix();
      assert.equal(matrix.length, 1);
      assert.equal(matrix[0].count, 3);
    });

    it('records all pairs in multi-concept set', () => {
      const concepts = new Set(['Rocky', 'SAP', 'Brüggen']);
      engine.recordCooccurrence(concepts);

      const matrix = engine.readMatrix();

      // Should create 3 pairs: Rocky-SAP, Rocky-Brüggen, SAP-Brüggen
      assert.equal(matrix.length, 3);
    });

    it('ignores single-concept set', () => {
      const concepts = new Set(['Rocky']);
      engine.recordCooccurrence(concepts);

      const matrix = engine.readMatrix();
      assert.equal(matrix.length, 0);
    });

    it('uses consistent pair keys (sorted)', () => {
      const concepts1 = new Set(['Rocky', 'SAP']);
      const concepts2 = new Set(['SAP', 'Rocky']);

      engine.recordCooccurrence(concepts1);
      engine.recordCooccurrence(concepts2);

      const matrix = engine.readMatrix();

      // Should be same entry (count = 2)
      assert.equal(matrix.length, 1);
      assert.equal(matrix[0].count, 2);
    });
  });

  describe('calculateStrength', () => {
    it('calculates strength as count × recency_decay', () => {
      const now = new Date().toISOString();
      const strength = engine.calculateStrength(5, now);

      // Recent access, decay ≈ 1, so strength ≈ count
      assert.ok(strength >= 4.5 && strength <= 5.5);
    });

    it('applies exponential decay to old entries', () => {
      const oldDate = new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(); // 40h ago
      const strength = engine.calculateStrength(5, oldDate);

      // Half-life 20h, 40h = 2 half-lives → decay ≈ 0.25
      // Strength ≈ 5 × 0.25 = 1.25
      assert.ok(strength < 2);
      assert.ok(strength > 0.5);
    });
  });

  describe('getAssociations', () => {
    it('returns associated concepts for a given concept', () => {
      const concepts1 = new Set(['Rocky', 'SAP', 'Brüggen']);
      const concepts2 = new Set(['Rocky', 'Stress', 'Exit']);

      engine.recordCooccurrence(concepts1);
      engine.recordCooccurrence(concepts2);

      const associations = engine.getAssociations('Rocky');

      assert.ok(associations.length >= 2);
      assert.ok(associations.some(a => a.concept === 'SAP'));
      assert.ok(associations.some(a => a.concept === 'Stress'));

      // Should include strength, count, last_seen
      assert.ok(associations[0].strength);
      assert.ok(associations[0].count);
      assert.ok(associations[0].last_seen);
    });

    it('sorts by strength descending', () => {
      // Create strong association (multiple co-occurrences)
      const strong = new Set(['Rocky', 'Brüggen']);
      for (let i = 0; i < 5; i++) {
        engine.recordCooccurrence(strong);
      }

      // Create weak association (single co-occurrence)
      const weak = new Set(['Rocky', 'Hamburg']);
      engine.recordCooccurrence(weak);

      const associations = engine.getAssociations('Rocky');

      // First should be stronger
      assert.ok(associations[0].strength > associations[1].strength);
    });

    it('respects maxAssociations limit', () => {
      // Create many associations
      for (let i = 0; i < 20; i++) {
        const concepts = new Set(['Rocky', `Concept${i}`]);
        engine.recordCooccurrence(concepts);
      }

      const associations = engine.getAssociations('Rocky');
      assert.ok(associations.length <= engine.maxAssociations);
    });

    it('filters by minStrength', () => {
      // Create old weak association
      const oldDate = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();

      const oldEntry = {
        concept_a: 'Rocky',
        concept_b: 'Weak',
        count: 1,
        last_seen: oldDate,
        strength: 0.1 // Below minStrength (0.3)
      };

      engine.writeMatrix([oldEntry]);

      const associations = engine.getAssociations('Rocky');

      // Should not include weak association
      assert.ok(!associations.some(a => a.concept === 'Weak'));
    });

    it('returns empty array for unknown concept', () => {
      const associations = engine.getAssociations('UnknownConcept');
      assert.equal(associations.length, 0);
    });
  });

  describe('generateContextInjection', () => {
    it('generates markdown with associations', () => {
      const concepts = new Set(['Rocky', 'Brüggen', 'SAP']);
      engine.recordCooccurrence(concepts);

      const contextText = 'Rocky is working on something';
      const injection = engine.generateContextInjection(contextText);

      assert.ok(injection.includes('Associative Memory'));
      assert.ok(injection.includes('Rocky'));
    });

    it('returns empty string when no concepts in context', () => {
      const injection = engine.generateContextInjection('some random text');
      assert.equal(injection, '');
    });

    it('returns empty string when no associations exist', () => {
      const injection = engine.generateContextInjection('Rocky is here');
      // No associations recorded yet
      assert.equal(injection, '');
    });
  });

  describe('pruneWeakAssociations', () => {
    it('removes associations below minStrength', () => {
      // Create old weak entry
      const oldDate = new Date(Date.now() - 200 * 60 * 60 * 1000).toISOString();

      const weakEntry = {
        concept_a: 'Rocky',
        concept_b: 'Weak',
        count: 1,
        last_seen: oldDate,
        strength: 0.05
      };

      const strongEntry = {
        concept_a: 'Rocky',
        concept_b: 'Strong',
        count: 5,
        last_seen: new Date().toISOString(),
        strength: 5.0
      };

      engine.writeMatrix([weakEntry, strongEntry]);
      engine.pruneWeakAssociations();

      const matrix = engine.readMatrix();

      // Only strong should remain
      assert.equal(matrix.length, 1);
      assert.ok(matrix[0].concept_b === 'Strong' || matrix[0].concept_a === 'Strong');
    });
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      const plugin = require('../plugins/nox-cooccurrence/index.js');
      assert.equal(plugin.id, 'nox-cooccurrence');
      assert.equal(plugin.name, 'Nox Co-occurrence');
      assert.equal(typeof plugin.register, 'function');
      assert.ok(plugin.configSchema);
    });
  });
});
