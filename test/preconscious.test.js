"use strict";
/**
 * Tests for nox-preconscious plugin.
 * Uses node:test + node:assert (zero deps).
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const { PreconsciousBuffer } = require("../plugins/nox-preconscious/index.js");

describe("nox-preconscious", () => {
  let tmpDir;
  let buffer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-precon-test-"));
    buffer = new PreconsciousBuffer(tmpDir, {
      topN: 5,
      maxTokens: 500,
      halfLifeHours: 24,
    });

    // Create events directory
    const eventsDir = path.join(tmpDir, "memory", "events");
    fs.mkdirSync(eventsDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  function writeEvent(event) {
    fs.appendFileSync(buffer.eventFile, JSON.stringify(event) + "\n");
  }

  describe("readEvents", () => {
    it("reads events from JSONL", () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: "sensor.email",
        source: "gmail",
        importance: 0.8,
        data: { subject: "Test" },
      });

      const events = buffer.readEvents();
      assert.equal(events.length, 1);
      assert.equal(events[0].topic, "sensor.email");
    });

    it("returns empty array when no events", () => {
      const events = buffer.readEvents();
      assert.deepEqual(events, []);
    });
  });

  describe("scoreEvents", () => {
    it("scores by importance × recency × reinforcement", () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      writeEvent({
        timestamp: yesterday.toISOString(),
        topic: "sensor.email",
        source: "test",
        importance: 0.8,
        data: "old",
      });

      writeEvent({
        timestamp: now.toISOString(),
        topic: "agent.insight",
        source: "test",
        importance: 0.6,
        data: "recent",
      });

      const events = buffer.readEvents();
      const scored = buffer.scoreEvents(events);

      assert.equal(scored.length, 2);

      // Recent event should score higher despite lower importance
      const recentScore = scored.find(s => s.event.data === "recent").score;
      const oldScore = scored.find(s => s.event.data === "old").score;

      // Recent: 0.6 × 1.0 × 1 = 0.6
      // Old (24h): 0.8 × 0.5 × 1 = 0.4
      assert.ok(recentScore > oldScore);
    });

    it("applies half-life decay correctly", () => {
      const now = Date.now();
      const halfLife = 24; // hours

      // Event from 24h ago
      const event24h = {
        timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        topic: "sensor.system",
        source: "test",
        importance: 1.0,
        data: "24h-old",
      };

      writeEvent(event24h);

      const events = buffer.readEvents();
      const scored = buffer.scoreEvents(events);

      // Score should be ~0.5 (1.0 × 0.5 × 1)
      assert.ok(Math.abs(scored[0].score - 0.5) < 0.01);
    });

    it("includes reinforcement count", () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: "sensor.email",
        source: "test",
        importance: 0.7,
        data: "test-event",
      });

      const events = buffer.readEvents();
      const scored = buffer.scoreEvents(events);

      assert.equal(scored[0].reinforcementCount, 1); // Default
    });
  });

  describe("generateBuffer", () => {
    it("generates markdown buffer with top N insights", () => {
      for (let i = 0; i < 10; i++) {
        writeEvent({
          timestamp: new Date().toISOString(),
          topic: "sensor.system",
          source: "test",
          importance: 0.5 + i * 0.05,
          data: `event-${i}`,
        });
      }

      const content = buffer.generateBuffer();

      assert.ok(content.includes("# Preconscious Buffer"));
      assert.ok(content.includes("Top insights"));

      // Should only include top 5
      const eventMatches = content.match(/event-\d+/g);
      assert.ok(eventMatches.length <= 5);
    });

    it("respects max token limit", () => {
      const shortBuffer = new PreconsciousBuffer(tmpDir, {
        topN: 10,
        maxTokens: 200, // Very small
        halfLifeHours: 24,
      });

      for (let i = 0; i < 10; i++) {
        writeEvent({
          timestamp: new Date().toISOString(),
          topic: "sensor.email",
          source: "test",
          importance: 0.9,
          data: "x".repeat(100), // Long data
        });
      }

      const content = shortBuffer.generateBuffer();
      const estimatedTokens = content.length / 4;

      assert.ok(estimatedTokens <= 220); // Allow small buffer
    });

    it("returns empty string when no events", () => {
      const content = buffer.generateBuffer();
      assert.equal(content, "");
    });
  });

  describe("writeBuffer", () => {
    it("writes buffer to file", () => {
      writeEvent({
        timestamp: new Date().toISOString(),
        topic: "agent.insight",
        source: "test",
        importance: 0.8,
        data: "important insight",
      });

      buffer.writeBuffer();

      assert.ok(fs.existsSync(buffer.bufferFile));
      const content = fs.readFileSync(buffer.bufferFile, "utf8");
      assert.ok(content.includes("# Preconscious Buffer"));
      assert.ok(content.includes("important insight"));
    });

    it("handles no events gracefully", () => {
      buffer.writeBuffer();
      // Should not crash, file may not exist
    });
  });

  describe("readBuffer", () => {
    it("reads buffer from file", () => {
      const testContent = "# Test Buffer\n\nSome content\n";
      const dir = path.dirname(buffer.bufferFile);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(buffer.bufferFile, testContent);

      const content = buffer.readBuffer();
      assert.equal(content, testContent);
    });

    it("returns empty string when buffer doesn't exist", () => {
      const content = buffer.readBuffer();
      assert.equal(content, "");
    });
  });

  describe("hashEvent", () => {
    it("generates consistent hash for same event", () => {
      const event = {
        timestamp: new Date().toISOString(),
        topic: "sensor.email",
        source: "test",
        importance: 0.7,
        data: { subject: "Test" },
      };

      const hash1 = buffer.hashEvent(event);
      const hash2 = buffer.hashEvent(event);

      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 16); // Truncated SHA256
    });

    it("generates different hash for different data", () => {
      const event1 = {
        topic: "sensor.email",
        data: { subject: "A" },
      };

      const event2 = {
        topic: "sensor.email",
        data: { subject: "B" },
      };

      const hash1 = buffer.hashEvent(event1);
      const hash2 = buffer.hashEvent(event2);

      assert.notEqual(hash1, hash2);
    });
  });

  describe("plugin export", () => {
    it("exports correct structure", () => {
      const plugin = require("../plugins/nox-preconscious/index.js");
      assert.equal(plugin.id, "nox-preconscious");
      assert.equal(plugin.name, "Nox Preconscious Buffer");
      assert.equal(typeof plugin.register, "function");
    });
  });
});
