'use strict';
/**
 * Tests for nox-emergency plugin.
 * Uses node:test + node:assert (zero deps).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { EmergencySurface } = require('../plugins/nox-emergency/index.js');

describe('nox-emergency', () => {
  let tmpDir;
  let emergency;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-emergency-test-'));
    emergency = new EmergencySurface(tmpDir, {
      importanceThreshold: 0.85,
      maxAlertsPerDay: 2
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

  function writeEvent(event) {
    fs.appendFileSync(emergency.eventFile, JSON.stringify(event) + '\n');
  }

  describe('readEvents', () => {
    it('reads events from JSONL', () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: 'urgent'
      });

      const events = emergency.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].importance, 0.9);
    });
  });

  describe('processEvents', () => {
    it('generates alerts for high-importance events', () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: 'urgent matter'
      });

      const alerts = emergency.processEvents();
      assert.equal(alerts.length, 1);
      assert.equal(alerts[0].topic, 'agent.alert');
      assert.equal(alerts[0].importance, 0.9);
      assert.ok(alerts[0].summary.includes('urgent matter'));
    });

    it('ignores low-importance events', () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'sensor.system',
        source: 'test',
        importance: 0.5,
        data: 'normal event'
      });

      const alerts = emergency.processEvents();
      assert.equal(alerts.length, 0);
    });

    it('generates alerts for expiring TTL events', () => {
      const now = Date.now();
      const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

      writeEvent({
        timestamp: oneHourAgo,
        topic: 'agent.alert',
        source: 'test',
        importance: 0.7, // Below threshold but has expiring TTL
        data: 'expiring soon',
        ttl_hours: 2 // Expires in 1 hour
      });

      const alerts = emergency.processEvents();
      assert.equal(alerts.length, 1);
      assert.ok(alerts[0].expires);
    });

    it('respects daily alert limit', () => {
      // Add 3 urgent events
      for (let i = 0; i < 3; i++) {
        writeEvent({
          timestamp: new Date().toISOString(),
          topic: 'agent.alert',
          source: 'test',
          importance: 0.95,
          data: `urgent-${i}`
        });
      }

      const alerts = emergency.processEvents();
      assert.ok(alerts.length <= 2); // Max 2 per day
    });
  });

  describe('deduplication', () => {
    it('does not create duplicate alerts', () => {
      const event = {
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: 'duplicate test'
      };

      writeEvent(event);
      emergency.processEvents();

      // Process again
      const alerts2 = emergency.processEvents();
      assert.equal(alerts2.length, 0); // Already alerted
    });

    it('uses SHA256 hash for dedup', () => {
      const event1 = {
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: { msg: 'test' }
      };

      const event2 = {
        timestamp: new Date(Date.now() + 1000).toISOString(), // Different timestamp
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: { msg: 'test' } // Same data
      };

      writeEvent(event1);
      const alerts1 = emergency.processEvents();
      assert.equal(alerts1.length, 1);

      writeEvent(event2);
      const alerts2 = emergency.processEvents();
      assert.equal(alerts2.length, 0); // Deduplicated
    });
  });

  describe('countAlertsToday', () => {
    it('counts alerts created today', () => {
      const today = new Date().toISOString();
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Write alerts directly
      fs.appendFileSync(
        emergency.alertFile,
        JSON.stringify({
          timestamp: today,
          hash: 'hash1',
          topic: 'agent.alert',
          importance: 0.9,
          summary: 'today',
          handled: false
        }) + '\n'
      );

      fs.appendFileSync(
        emergency.alertFile,
        JSON.stringify({
          timestamp: yesterday,
          hash: 'hash2',
          topic: 'agent.alert',
          importance: 0.9,
          summary: 'yesterday',
          handled: false
        }) + '\n'
      );

      const count = emergency.countAlertsToday();
      assert.equal(count, 1);
    });
  });

  describe('getUnhandledAlerts', () => {
    it('returns only unhandled alerts', () => {
      fs.appendFileSync(
        emergency.alertFile,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          hash: 'hash1',
          topic: 'agent.alert',
          importance: 0.9,
          summary: 'unhandled',
          handled: false
        }) + '\n'
      );

      fs.appendFileSync(
        emergency.alertFile,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          hash: 'hash2',
          topic: 'agent.alert',
          importance: 0.9,
          summary: 'handled',
          handled: true
        }) + '\n'
      );

      const unhandled = emergency.getUnhandledAlerts();
      assert.equal(unhandled.length, 1);
      assert.equal(unhandled[0].summary, 'unhandled');
    });
  });

  describe('generateContextInjection', () => {
    it('generates URGENT context from unhandled alerts', () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.95,
        data: 'critical issue'
      });

      emergency.processEvents();
      const injection = emergency.generateContextInjection();

      assert.ok(injection.includes('⚠️ URGENT ALERTS'));
      assert.ok(injection.includes('critical issue'));
      assert.ok(injection.includes('immediate attention'));
    });

    it('returns empty string when no unhandled alerts', () => {
      const injection = emergency.generateContextInjection();
      assert.equal(injection, '');
    });
  });

  describe('markAsHandled', () => {
    it('marks alert as handled', () => {
      const hash = emergency.hashEvent({
        topic: 'agent.alert',
        source: 'test',
        data: 'test'
      });

      fs.appendFileSync(
        emergency.alertFile,
        JSON.stringify({
          timestamp: new Date().toISOString(),
          hash,
          topic: 'agent.alert',
          importance: 0.9,
          summary: 'test',
          handled: false
        }) + '\n'
      );

      emergency.markAsHandled(hash);

      const alerts = emergency.readAlerts();
      assert.equal(alerts[0].handled, true);
    });
  });

  describe('alert format', () => {
    it('includes all required fields', () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: { msg: 'urgent' },
        ttl_hours: 2
      });

      const alerts = emergency.processEvents();
      const alert = alerts[0];

      assert.ok(alert.timestamp);
      assert.ok(alert.hash);
      assert.equal(alert.topic, 'agent.alert');
      assert.equal(alert.importance, 0.9);
      assert.ok(alert.summary);
      assert.ok(alert.expires);
      assert.equal(alert.handled, false);
    });
  });

  describe('rate limiting', () => {
    it('enforces max alerts per day', () => {
      const emergency2 = new EmergencySurface(tmpDir, {
        importanceThreshold: 0.85,
        maxAlertsPerDay: 1 // Only 1 allowed
      });

      writeEvent({
        timestamp: new Date().toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.95,
        data: 'alert1'
      });

      writeEvent({
        timestamp: new Date(Date.now() + 1000).toISOString(),
        topic: 'agent.alert',
        source: 'test',
        importance: 0.95,
        data: 'alert2'
      });

      const alerts = emergency2.processEvents();
      assert.equal(alerts.length, 1); // Rate limited
    });
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      const plugin = require('../plugins/nox-emergency/index.js');
      assert.equal(plugin.id, 'nox-emergency');
      assert.equal(plugin.name, 'Nox Emergency Surface');
      assert.equal(typeof plugin.register, 'function');
    });
  });
});
