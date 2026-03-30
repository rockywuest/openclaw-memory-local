'use strict';
/**
 * Tests for nox-event-bus plugin.
 * Uses node:test + node:assert (zero deps).
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { EventBus } = require('../plugins/nox-event-bus/index.js');

describe('nox-event-bus', () => {
  let tmpDir;
  let bus;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-eventbus-test-'));
    bus = new EventBus(tmpDir, { retentionDays: 7, maxEventsInjected: 10 });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe('emit', () => {
    it('emits event to JSONL', () => {
      bus.emit('sensor.email', {
        source: 'gmail',
        importance: 0.8,
        data: { subject: 'Test Email' }
      });

      const events = bus.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].topic, 'sensor.email');
      assert.equal(events[0].source, 'gmail');
      assert.equal(events[0].importance, 0.8);
      assert.deepEqual(events[0].data, { subject: 'Test Email' });
    });

    it('rejects invalid topic', () => {
      assert.throws(
        () => bus.emit('invalid.topic', { source: 'test', importance: 0.5 }),
        /Invalid topic/
      );
    });

    it('adds timestamp automatically', () => {
      const before = Date.now();
      bus.emit('sensor.system', { source: 'cpu', importance: 0.5 });
      const after = Date.now();

      const events = bus.readEvents();
      const ts = new Date(events[0].timestamp).getTime();
      assert.ok(ts >= before && ts <= after);
    });

    it('defaults importance to 0.5', () => {
      bus.emit('sensor.file', { source: 'test' });
      const events = bus.readEvents();
      assert.equal(events[0].importance, 0.5);
    });
  });

  describe('on/off', () => {
    it('calls listener when event is emitted', () => {
      let called = false;
      const listener = event => {
        called = true;
        assert.equal(event.topic, 'agent.insight');
      };

      bus.on('agent.insight', listener);
      bus.emit('agent.insight', { source: 'test', importance: 0.7 });

      assert.ok(called);
    });

    it('removes listener with off', () => {
      let callCount = 0;
      const listener = () => {
        callCount++;
      };

      bus.on('sensor.calendar', listener);
      bus.emit('sensor.calendar', { source: 'test', importance: 0.5 });
      assert.equal(callCount, 1);

      bus.off('sensor.calendar', listener);
      bus.emit('sensor.calendar', { source: 'test', importance: 0.5 });
      assert.equal(callCount, 1); // Not called again
    });
  });

  describe('persistence', () => {
    it('persists events to JSONL across instances', () => {
      bus.emit('sensor.email', { source: 'test', importance: 0.6, data: 'foo' });
      bus.emit('sensor.file', { source: 'test', importance: 0.7, data: 'bar' });

      const bus2 = new EventBus(tmpDir);
      const events = bus2.readEvents();
      assert.equal(events.length, 2);
      assert.equal(events[0].topic, 'sensor.email');
      assert.equal(events[1].topic, 'sensor.file');
    });

    it('handles empty event file gracefully', () => {
      const events = bus.readEvents();
      assert.deepEqual(events, []);
    });
  });

  describe('pruneOldEvents', () => {
    it('removes events older than retentionDays', () => {
      const oldDate = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const recentDate = new Date().toISOString();

      // Manually write old event
      const oldEvent = {
        timestamp: oldDate,
        topic: 'sensor.email',
        source: 'test',
        importance: 0.5,
        data: 'old',
        ttl_hours: null
      };
      fs.appendFileSync(bus.eventFile, JSON.stringify(oldEvent) + '\n');

      bus.emit('sensor.file', { source: 'test', importance: 0.6, data: 'new' });

      bus.pruneOldEvents();

      const events = bus.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'new');
    });

    it('removes events with expired TTL', () => {
      const expiredDate = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h ago

      const expiredEvent = {
        timestamp: expiredDate,
        topic: 'agent.alert',
        source: 'test',
        importance: 0.9,
        data: 'expired',
        ttl_hours: 2 // Expired 1h ago
      };
      fs.appendFileSync(bus.eventFile, JSON.stringify(expiredEvent) + '\n');

      bus.emit('sensor.system', { source: 'test', importance: 0.5, data: 'active' });

      bus.pruneOldEvents();

      const events = bus.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].data, 'active');
    });
  });

  describe('getRecentRelevantEvents', () => {
    it('returns top N events by importance × recency', () => {
      // Old but high importance
      const old = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      fs.appendFileSync(
        bus.eventFile,
        JSON.stringify({
          timestamp: old,
          topic: 'sensor.email',
          source: 'test',
          importance: 1.0,
          data: 'old-high',
          ttl_hours: null
        }) + '\n'
      );

      // Recent but low importance
      bus.emit('sensor.file', { source: 'test', importance: 0.3, data: 'recent-low' });

      // Recent and high importance
      bus.emit('agent.alert', { source: 'test', importance: 0.9, data: 'recent-high' });

      const relevant = bus.getRecentRelevantEvents(2);
      assert.equal(relevant.length, 2);

      // Should prioritize recent-high, then old-high (decay reduces it)
      assert.equal(relevant[0].data, 'recent-high');
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 10; i++) {
        bus.emit('sensor.system', { source: 'test', importance: 0.5, data: `event-${i}` });
      }

      const relevant = bus.getRecentRelevantEvents(3);
      assert.equal(relevant.length, 3);
    });
  });

  describe('generateContextInjection', () => {
    it('generates markdown context from recent events', () => {
      bus.emit('sensor.email', { source: 'gmail', importance: 0.8, data: { subject: 'Urgent' } });
      bus.emit('agent.insight', { source: 'reflector', importance: 0.7, data: 'Deep thought' });

      const injection = bus.generateContextInjection();
      assert.ok(injection.includes('## Recent Events (Event Bus)'));
      assert.ok(injection.includes('[sensor.email]'));
      assert.ok(injection.includes('[agent.insight]'));
      assert.ok(injection.includes('imp: 0.80'));
    });

    it('returns empty string when no events', () => {
      const injection = bus.generateContextInjection();
      assert.equal(injection, '');
    });
  });

  describe('event format', () => {
    it('includes all required fields', () => {
      bus.emit('sensor.calendar', {
        source: 'gcal',
        importance: 0.6,
        data: { title: 'Meeting' },
        ttl_hours: 24
      });

      const events = bus.readEvents();
      const event = events[0];

      assert.ok(event.timestamp);
      assert.equal(event.topic, 'sensor.calendar');
      assert.equal(event.source, 'gcal');
      assert.equal(event.importance, 0.6);
      assert.deepEqual(event.data, { title: 'Meeting' });
      assert.equal(event.ttl_hours, 24);
    });
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      const plugin = require('../plugins/nox-event-bus/index.js');
      assert.equal(plugin.id, 'nox-event-bus');
      assert.equal(plugin.name, 'Nox Event Bus');
      assert.equal(typeof plugin.register, 'function');
    });
  });
});
