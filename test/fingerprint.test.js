'use strict';
/**
 * Tests for nox-fingerprint plugin.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { CognitiveFingerprintEngine } = require('../plugins/nox-fingerprint/index.js');

describe('nox-fingerprint', () => {
  let tmpDir;
  let engine;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-fingerprint-test-'));
    engine = new CognitiveFingerprintEngine(tmpDir, {
      driftThreshold: 0.2,
      cooldownHours: 24
    });

    // Create events directory
    const eventsDir = path.join(tmpDir, 'memory', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('classifyDomain', () => {
    it('classifies work-related events', () => {
      const event = {
        topic: 'sensor.email',
        data: { subject: 'SAP Horizon project meeting' }
      };

      const domain = engine.classifyDomain(event);
      assert.equal(domain, 'work');
    });

    it('classifies family-related events', () => {
      const event = {
        topic: 'sensor.calendar',
        data: { title: "Noah's birthday party" }
      };

      const domain = engine.classifyDomain(event);
      assert.equal(domain, 'family');
    });

    it('classifies tech-related events', () => {
      const event = {
        topic: 'agent.insight',
        data: { message: 'GitHub API update available' }
      };

      const domain = engine.classifyDomain(event);
      assert.equal(domain, 'tech');
    });

    it('defaults to system for unknown events', () => {
      const event = {
        topic: 'sensor.unknown',
        data: { something: 'random' }
      };

      const domain = engine.classifyDomain(event);
      assert.equal(domain, 'system');
    });
  });

  describe('calculateDistribution', () => {
    it('calculates domain percentages', () => {
      // Create test events
      const events = [
        { topic: 'sensor.email', data: { subject: 'SAP meeting' } },
        { topic: 'sensor.email', data: { subject: 'Brüggen project' } },
        { topic: 'sensor.calendar', data: { title: 'Family dinner' } }
      ];

      const eventsFile = path.join(tmpDir, 'memory', 'events', 'bus.jsonl');
      fs.writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const distribution = engine.calculateDistribution();

      assert.ok(distribution.work > 0);
      assert.ok(distribution.family > 0);

      // Check percentages sum to ~1.0
      const total = Object.values(distribution).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - 1.0) < 0.01);
    });

    it('returns zero distribution for empty events', () => {
      const distribution = engine.calculateDistribution();

      const total = Object.values(distribution).reduce((a, b) => a + b, 0);
      assert.equal(total, 0);
    });
  });

  describe('calculateGini', () => {
    it('returns 0 for perfectly equal distribution', () => {
      const distribution = {
        work: 0.125,
        family: 0.125,
        tech: 0.125,
        finance: 0.125,
        health: 0.125,
        social: 0.125,
        creative: 0.125,
        system: 0.125
      };

      const gini = engine.calculateGini(distribution);
      assert.ok(gini < 0.1); // Nearly zero
    });

    it('returns high value for very unequal distribution', () => {
      const distribution = {
        work: 0.9,
        family: 0.025,
        tech: 0.025,
        finance: 0.0125,
        health: 0.0125,
        social: 0.0125,
        creative: 0.0125,
        system: 0.0
      };

      const gini = engine.calculateGini(distribution);
      assert.ok(gini > 0.5); // High inequality
    });

    it('handles zero distribution', () => {
      const distribution = {
        work: 0,
        family: 0,
        tech: 0,
        finance: 0,
        health: 0,
        social: 0,
        creative: 0,
        system: 0
      };

      const gini = engine.calculateGini(distribution);
      assert.equal(gini, 0);
    });
  });

  describe('getTopDomains', () => {
    it('returns top N domains sorted by percentage', () => {
      const distribution = {
        work: 0.5,
        tech: 0.3,
        family: 0.1,
        finance: 0.05,
        health: 0.025,
        social: 0.025,
        creative: 0,
        system: 0
      };

      const top3 = engine.getTopDomains(distribution, 3);

      assert.equal(top3.length, 3);
      assert.equal(top3[0].domain, 'work');
      assert.equal(top3[1].domain, 'tech');
      assert.equal(top3[2].domain, 'family');
      assert.equal(top3[0].pct, 0.5);
    });
  });

  describe('calculateTopologyHash', () => {
    it('generates consistent hash for same distribution', () => {
      const distribution = {
        work: 0.5,
        family: 0.3,
        tech: 0.2,
        finance: 0,
        health: 0,
        social: 0,
        creative: 0,
        system: 0
      };

      const hash1 = engine.calculateTopologyHash(distribution);
      const hash2 = engine.calculateTopologyHash(distribution);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // SHA256 hex
    });

    it('generates different hash for different distribution', () => {
      const dist1 = {
        work: 0.5,
        family: 0.5,
        tech: 0,
        finance: 0,
        health: 0,
        social: 0,
        creative: 0,
        system: 0
      };

      const dist2 = {
        work: 0.3,
        family: 0.7,
        tech: 0,
        finance: 0,
        health: 0,
        social: 0,
        creative: 0,
        system: 0
      };

      const hash1 = engine.calculateTopologyHash(dist1);
      const hash2 = engine.calculateTopologyHash(dist2);

      assert.notEqual(hash1, hash2);
    });
  });

  describe('generateFingerprint', () => {
    it('creates complete fingerprint', () => {
      // Create test events
      const events = [
        { topic: 'sensor.email', data: { subject: 'Work email' } },
        { topic: 'sensor.calendar', data: { title: 'Family event' } }
      ];

      const eventsFile = path.join(tmpDir, 'memory', 'events', 'bus.jsonl');
      fs.writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const fp = engine.generateFingerprint();

      assert.ok(fp.timestamp);
      assert.ok(fp.distribution);
      assert.ok(typeof fp.gini === 'number');
      assert.ok(Array.isArray(fp.top_domains));
      assert.equal(fp.top_domains.length, 3);
      assert.ok(fp.topology_hash);
      assert.equal(fp.topology_hash.length, 64);
    });
  });

  describe('saveFingerprint / loadFingerprint', () => {
    it('persists and loads fingerprint', () => {
      const fp = {
        timestamp: new Date().toISOString(),
        distribution: {
          work: 0.5,
          family: 0.5,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        },
        gini: 0.3,
        top_domains: [{ domain: 'work', pct: 0.5 }],
        topology_hash: 'abc123'
      };

      engine.saveFingerprint(fp);
      const loaded = engine.loadFingerprint();

      assert.deepEqual(loaded, fp);
    });

    it('returns null when no fingerprint exists', () => {
      const loaded = engine.loadFingerprint();
      assert.equal(loaded, null);
    });
  });

  describe('needsRecalculation', () => {
    it('returns true when no fingerprint exists', () => {
      assert.ok(engine.needsRecalculation());
    });

    it('returns false within cooldown period', () => {
      const recent = {
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(), // 1h ago
        distribution: {},
        gini: 0,
        top_domains: [],
        topology_hash: 'abc'
      };

      engine.saveFingerprint(recent);
      assert.ok(!engine.needsRecalculation());
    });

    it('returns true after cooldown period', () => {
      const old = {
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), // 25h ago
        distribution: {},
        gini: 0,
        top_domains: [],
        topology_hash: 'abc'
      };

      engine.saveFingerprint(old);
      assert.ok(engine.needsRecalculation());
    });
  });

  describe('detectDrift', () => {
    it('calculates drift between two fingerprints', () => {
      const oldFp = {
        distribution: {
          work: 0.8,
          family: 0.2,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        }
      };

      const newFp = {
        distribution: {
          work: 0.5,
          family: 0.5,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        }
      };

      const drift = engine.detectDrift(oldFp, newFp);

      // |0.8-0.5| + |0.2-0.5| = 0.3 + 0.3 = 0.6
      // Normalized: 0.6 / 2 = 0.3
      assert.ok(drift > 0.25 && drift < 0.35);
    });

    it('returns 0 for identical fingerprints', () => {
      const fp = {
        distribution: {
          work: 0.5,
          family: 0.5,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        }
      };

      const drift = engine.detectDrift(fp, fp);
      assert.equal(drift, 0);
    });

    it('returns 0 when fingerprint is null', () => {
      const drift = engine.detectDrift(null, null);
      assert.equal(drift, 0);
    });
  });

  describe('updateFingerprint', () => {
    it('updates fingerprint after cooldown', () => {
      // Set old fingerprint
      const old = {
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        distribution: {
          work: 0.8,
          family: 0.2,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        },
        gini: 0.5,
        top_domains: [],
        topology_hash: 'old'
      };

      engine.saveFingerprint(old);

      const result = engine.updateFingerprint();

      assert.ok(result.updated);
      assert.ok(typeof result.drift === 'number');
    });

    it('skips update within cooldown', () => {
      const recent = {
        timestamp: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
        distribution: {},
        gini: 0,
        top_domains: [],
        topology_hash: 'recent'
      };

      engine.saveFingerprint(recent);

      const result = engine.updateFingerprint();

      assert.ok(!result.updated);
    });

    it('detects drift above threshold', () => {
      const old = {
        timestamp: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
        distribution: {
          work: 1.0,
          family: 0,
          tech: 0,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        },
        gini: 1.0,
        top_domains: [],
        topology_hash: 'old'
      };

      engine.saveFingerprint(old);

      // Create new events with different distribution
      const events = [
        { topic: 'sensor.calendar', data: { title: 'Family event' } },
        { topic: 'sensor.calendar', data: { title: 'Family dinner' } }
      ];

      const eventsFile = path.join(tmpDir, 'memory', 'events', 'bus.jsonl');
      fs.writeFileSync(eventsFile, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = engine.updateFingerprint();

      assert.ok(result.updated);
      assert.ok(result.drift > engine.driftThreshold);
      assert.ok(result.driftDetected);
    });
  });

  describe('generateContextInjection', () => {
    it('generates markdown summary', () => {
      const fp = {
        timestamp: new Date().toISOString(),
        distribution: {
          work: 0.5,
          tech: 0.3,
          family: 0.2,
          finance: 0,
          health: 0,
          social: 0,
          creative: 0,
          system: 0
        },
        gini: 0.4,
        top_domains: [
          { domain: 'work', pct: 0.5 },
          { domain: 'tech', pct: 0.3 },
          { domain: 'family', pct: 0.2 }
        ],
        topology_hash: 'abc123def456'
      };

      engine.saveFingerprint(fp);

      const injection = engine.generateContextInjection();

      assert.ok(injection.includes('Cognitive Fingerprint'));
      assert.ok(injection.includes('work 50.0%'));
      assert.ok(injection.includes('tech 30.0%'));
      assert.ok(injection.includes('Gini'));
    });

    it('returns empty string when no fingerprint', () => {
      const injection = engine.generateContextInjection();
      assert.equal(injection, '');
    });
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      const plugin = require('../plugins/nox-fingerprint/index.js');
      assert.equal(plugin.id, 'nox-fingerprint');
      assert.equal(plugin.name, 'Nox Cognitive Fingerprint');
      assert.equal(typeof plugin.register, 'function');
      assert.ok(plugin.configSchema);
    });
  });
});
