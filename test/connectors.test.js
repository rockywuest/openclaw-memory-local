"use strict";
/**
 * Tests for sensor connectors.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");

const FileWatchConnector = require("../plugins/nox-event-bus/connectors/filewatch.js");
const SystemConnector = require("../plugins/nox-event-bus/connectors/system.js");
const ConnectorRegistry = require("../plugins/nox-event-bus/connectors/index.js");

// Mock EventBus for testing
class MockEventBus {
  constructor() {
    this.events = [];
  }

  emit(topic, data) {
    this.events.push({ topic, data });
  }
}

describe("sensor-connectors", () => {
  let tmpDir;
  let mockBus;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-connectors-test-"));
    mockBus = new MockEventBus();
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  describe("FileWatchConnector", () => {
    let connector;

    beforeEach(() => {
      // Create memory directory
      const memDir = path.join(tmpDir, "memory");
      fs.mkdirSync(memDir, { recursive: true });

      connector = new FileWatchConnector(tmpDir, mockBus);
    });

    afterEach(() => {
      if (connector) {
        connector.stop();
      }
    });

    it("starts watching memory directory", () => {
      connector.start();
      // Should not throw
      assert.ok(true);
    });

    it("detects new .md files", (t, done) => {
      connector.start();

      // Wait a bit for watcher to initialize
      setTimeout(() => {
        const testFile = path.join(tmpDir, "memory", "test.md");
        fs.writeFileSync(testFile, "# Test");

        // Give watcher time to detect
        setTimeout(() => {
          connector.stop();
          
          // Should have emitted sensor.file event
          const fileEvents = mockBus.events.filter(e => e.topic === "sensor.file");
          assert.ok(fileEvents.length > 0);
          
          if (fileEvents.length > 0) {
            assert.equal(fileEvents[0].data.source, "filewatch");
            assert.ok(fileEvents[0].data.data.file.includes("test.md"));
          }
          
          done();
        }, 200);
      }, 100);
    });

    it("stops watching when stopped", () => {
      connector.start();
      connector.stop();
      
      // Should not throw
      assert.ok(true);
    });

    it("scans directory recursively", () => {
      const subDir = path.join(tmpDir, "memory", "subdir");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(path.join(subDir, "nested.md"), "# Nested");

      connector.scanDirectory(path.join(tmpDir, "memory"));

      const fileEvents = mockBus.events.filter(e => e.topic === "sensor.file");
      assert.ok(fileEvents.some(e => e.data.data.file.includes("nested.md")));
    });

    it("ignores non-.md files", () => {
      const memDir = path.join(tmpDir, "memory");
      fs.writeFileSync(path.join(memDir, "test.txt"), "text");
      fs.writeFileSync(path.join(memDir, "test.json"), "{}");

      connector.scanDirectory(memDir);

      const fileEvents = mockBus.events.filter(e => e.topic === "sensor.file");
      assert.equal(fileEvents.length, 0);
    });
  });

  describe("SystemConnector", () => {
    let connector;

    beforeEach(() => {
      connector = new SystemConnector(tmpDir, mockBus);
    });

    afterEach(() => {
      if (connector) {
        connector.stop();
      }
    });

    it("starts monitoring", () => {
      connector.start();
      assert.ok(connector.timer);
    });

    it("stops monitoring", () => {
      connector.start();
      connector.stop();
      assert.equal(connector.timer, null);
    });

    it("runs system checks without crashing", () => {
      // Just ensure checks don't throw
      connector.checkDiskSpace();
      connector.checkCPUTemp();
      connector.checkMemory();
      
      assert.ok(true);
    });

    it("emits events only when thresholds exceeded", () => {
      connector.checkDiskSpace();
      connector.checkMemory();

      // On a normal system, these should not emit events
      // (unless actually over threshold)
      const systemEvents = mockBus.events.filter(e => e.topic === "sensor.system");
      
      // Can't assert exact count (depends on system state)
      // Just verify structure if any events emitted
      if (systemEvents.length > 0) {
        assert.ok(systemEvents[0].data.source === "system");
        assert.ok(systemEvents[0].data.data.type);
        assert.ok(systemEvents[0].data.data.message);
      }
    });
  });

  describe("ConnectorRegistry", () => {
    let registry;

    beforeEach(() => {
      registry = new ConnectorRegistry(tmpDir, mockBus);
    });

    afterEach(() => {
      if (registry) {
        registry.stopAll();
      }
    });

    it("registers connectors", () => {
      const connector = registry.registerConnector("test", FileWatchConnector);
      assert.ok(connector);
      assert.ok(registry.connectors.has("test"));
    });

    it("handles registration errors gracefully", () => {
      class BrokenConnector {
        constructor() {
          throw new Error("Broken");
        }
      }

      const connector = registry.registerConnector("broken", BrokenConnector);
      assert.equal(connector, null);
    });

    it("runs all connectors", () => {
      // Create memory dir for FileWatchConnector
      fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });

      registry.registerBuiltins();
      registry.runAll();

      // Should have started both connectors
      const filewatch = registry.getConnector("filewatch");
      const system = registry.getConnector("system");

      assert.ok(filewatch);
      assert.ok(system);
      assert.ok(system.timer); // SystemConnector should be running
    });

    it("stops all connectors", () => {
      fs.mkdirSync(path.join(tmpDir, "memory"), { recursive: true });

      registry.registerBuiltins();
      registry.runAll();
      registry.stopAll();

      const system = registry.getConnector("system");
      assert.equal(system.timer, null);
    });

    it("handles start errors gracefully", () => {
      class FailingConnector {
        start() {
          throw new Error("Start failed");
        }
      }

      registry.registerConnector("failing", FailingConnector);
      
      // Should not throw
      registry.runAll();
      assert.ok(true);
    });

    it("gets connector by name", () => {
      registry.registerConnector("test", FileWatchConnector);
      const connector = registry.getConnector("test");
      
      assert.ok(connector instanceof FileWatchConnector);
    });

    it("registers built-in connectors", () => {
      registry.registerBuiltins();

      assert.ok(registry.connectors.has("filewatch"));
      assert.ok(registry.connectors.has("system"));
      assert.equal(registry.connectors.size, 2);
    });
  });
});
