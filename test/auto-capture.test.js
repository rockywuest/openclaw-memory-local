"use strict";
/**
 * Tests for auto-capture plugin.
 *
 * Uses node:test + node:assert (zero deps).
 * Mocks: mcporter CLI calls via execFile mock in child_process.
 *
 * Same strategy as memory-qdrant.test.js: patch cp.execFile BEFORE
 * the plugin module is loaded, because promisify captures the reference.
 */

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");

// ── Global mock ──────────────────────────────────────────────────

let mockExecFileResults = [];
let mockExecFileCalls = [];
let mockEnabled = false;

const _originalExecFile = cp.execFile;

cp.execFile = function dispatchExecFile(cmd, args, opts, callback) {
  if (!mockEnabled) {
    return _originalExecFile.call(cp, cmd, args, opts, callback);
  }
  if (typeof opts === "function") {
    callback = opts;
    opts = {};
  }
  mockExecFileCalls.push({ cmd, args: [...args] });
  const result = mockExecFileResults.shift() || { stdout: "{}", stderr: "" };
  if (result.error) {
    callback(result.error);
  } else {
    callback(null, result.stdout || "{}", result.stderr || "");
  }
};

function freshRequire(modulePath) {
  for (const key of Object.keys(require.cache)) {
    if (key.includes("auto-capture")) delete require.cache[key];
  }
  return require(modulePath);
}

// ── Tests ────────────────────────────────────────────────────────

describe("auto-capture", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "oc-capture-test-"));
    mockExecFileCalls = [];
    mockExecFileResults = [];
    mockEnabled = true;
  });

  afterEach(() => {
    mockEnabled = false;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
  });

  function loadPlugin() {
    // Clear module cache for both auto-capture and child_process
    for (const key of Object.keys(require.cache)) {
      if (key.includes("auto-capture")) delete require.cache[key];
    }
    return require("../auto-capture/index.js");
  }

  describe("plugin export", () => {
    it("exports correct structure", () => {
      const plugin = loadPlugin();
      assert.equal(plugin.id, "auto-capture");
      assert.equal(plugin.name, "Auto-Capture");
      assert.equal(typeof plugin.register, "function");
      assert.ok(plugin.configSchema);
    });

    it("has configSchema with expected properties", () => {
      const plugin = loadPlugin();
      const props = Object.keys(plugin.configSchema.properties);
      assert.ok(props.includes("serverName"));
      assert.ok(props.includes("minMessageLength"));
      assert.ok(props.includes("maxStoreLength"));
      assert.ok(props.includes("cooldownMs"));
      assert.ok(props.includes("skipPatterns"));
    });
  });

  describe("register()", () => {
    it("registers before_agent_start hook", () => {
      const plugin = loadPlugin();
      const hooks = {};
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: {},
        on: (name, fn) => { hooks[name] = fn; },
      };
      plugin.register(api);
      assert.ok(hooks["before_agent_start"]);
    });
  });

  describe("message classification", () => {
    // We test classification indirectly via the hook's behavior

    it("captures correction patterns", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [
          { role: "user", content: "Nein, das stimmt nicht! Der Termin ist am Freitag." },
        ],
      }, {});

      assert.ok(mockExecFileCalls.length >= 1, "Should call mcporter to store");
      const args = mockExecFileCalls[0].args.join(" ");
      assert.ok(args.includes("qdrant-store"), "Should call qdrant-store");
      assert.ok(args.includes("correction"), "Should tag as correction");
    });

    it("captures decision patterns", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [
          { role: "user", content: "Wir machen das mit dem neuen Dashboard wie besprochen." },
        ],
      }, {});

      assert.ok(mockExecFileCalls.length >= 1);
      const args = mockExecFileCalls[0].args.join(" ");
      assert.ok(args.includes("decision"), "Should tag as decision");
    });

    it("captures fact patterns (price)", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [
          { role: "user", content: "Die Lizenz kostet jetzt €450 pro Jahr statt €350." },
        ],
      }, {});

      assert.ok(mockExecFileCalls.length >= 1);
      const args = mockExecFileCalls[0].args.join(" ");
      assert.ok(args.includes("fact"), "Should tag as fact");
    });

    it("captures lesson patterns", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [
          { role: "user", content: "Wichtig: nie wieder ohne Backup deployen, das war ein Fehler." },
        ],
      }, {});

      assert.ok(mockExecFileCalls.length >= 1);
      const args = mockExecFileCalls[0].args.join(" ");
      assert.ok(args.includes("lesson") || args.includes("fact"), "Should tag as lesson or fact");
    });
  });

  describe("skip logic", () => {
    it("skips short messages", async () => {
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0, minMessageLength: 20 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "ok" }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Should not call mcporter for short message");
    });

    it("skips heartbeat messages", async () => {
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "HEARTBEAT_OK" }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Should skip heartbeat");
    });

    it("skips NO_REPLY messages", async () => {
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "NO_REPLY" }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Should skip NO_REPLY");
    });

    it("skips greetings", async () => {
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "Moin" }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Should skip greeting");
    });

    it("skips messages without classification", async () => {
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "Schau mal was der Hund da macht im Garten." }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Should skip non-classifiable message");
    });

    it("respects custom skip patterns", async () => {
      mockExecFileResults.push({ stdout: "ok" }); // in case it tries
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0, skipPatterns: ["^MORNING BRIEFING"] },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "MORNING BRIEFING — alles gut, keine Fehler." }],
      }, {});

      assert.equal(mockExecFileCalls.length, 0, "Custom skip pattern should work");
    });
  });

  describe("cooldown", () => {
    it("respects cooldown between captures", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 60000 }, // 1 minute
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      // First call — should capture
      await hook({
        messages: [{ role: "user", content: "Nein, das stimmt nicht! Die Version ist 2.0." }],
      }, {});
      const firstCallCount = mockExecFileCalls.length;
      assert.ok(firstCallCount >= 1, "First call should capture");

      // Second call immediately — should be throttled
      await hook({
        messages: [{ role: "user", content: "Falsch! Der Preis ist €100." }],
      }, {});
      assert.equal(mockExecFileCalls.length, firstCallCount, "Second call should be throttled");
    });
  });

  describe("mcporter error handling", () => {
    it("handles mcporter failure gracefully", async () => {
      mockExecFileResults.push({ error: new Error("mcporter not found") });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      // Should not throw
      const result = await hook({
        messages: [{ role: "user", content: "Nein, das stimmt nicht! Korrektur nötig." }],
      }, {});

      assert.equal(result, undefined, "Should return undefined (no injection)");
    });
  });

  describe("return value", () => {
    it("always returns undefined (auto-capture never injects context)", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      const result = await hook({
        messages: [{ role: "user", content: "Wichtig: Das ist ein Fehler den wir nie wiederholen." }],
      }, {});

      assert.equal(result, undefined, "Should return undefined");
    });
  });

  describe("prompt fallback", () => {
    it("falls back to event.prompt when no messages", async () => {
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0 },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        prompt: "Korrektur: Der Deploy war am Dienstag, nicht Mittwoch.",
      }, {});

      assert.ok(mockExecFileCalls.length >= 1, "Should capture from prompt fallback");
    });
  });

  describe("log file", () => {
    it("writes to log file when configured", async () => {
      const logPath = path.join(tmpDir, "capture.log");
      mockExecFileResults.push({ stdout: "ok" });
      const plugin = loadPlugin();
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { cooldownMs: 0, logFile: logPath },
        on: (name, fn) => { if (name === "before_agent_start") hook = fn; },
      };
      plugin.register(api);

      await hook({
        messages: [{ role: "user", content: "Nein, das stimmt nicht! Es waren 5 Bugs." }],
      }, {});

      assert.ok(fs.existsSync(logPath), "Log file should be created");
      const logContent = fs.readFileSync(logPath, "utf-8");
      assert.ok(logContent.includes("Captured"), "Log should contain capture entry");
    });
  });
});
