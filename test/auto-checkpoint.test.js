'use strict';
/**
 * Tests for auto-checkpoint plugin.
 *
 * Uses node:test + node:assert (zero deps).
 * Mocks: fs operations via temp directories.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Test helpers ─────────────────────────────────────────────────

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oc-checkpoint-test-'));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writeCheckpoint(dir, content) {
  const stateDir = path.join(dir, 'state');
  fs.mkdirSync(stateDir, { recursive: true });
  const filePath = path.join(stateDir, 'current.md');
  fs.writeFileSync(filePath, content);
  return filePath;
}

function freshRequire(modulePath) {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];
  return require(resolved);
}

function makeNowString(offsetHours = 0) {
  const d = new Date(Date.now() - offsetHours * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const min = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

// ── Load plugin ──────────────────────────────────────────────────

const plugin = freshRequire('../auto-checkpoint/index.js');

// ── Tests ────────────────────────────────────────────────────────

describe('auto-checkpoint', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      assert.equal(plugin.id, 'auto-checkpoint');
      assert.equal(plugin.name, 'Auto-Checkpoint');
      assert.equal(typeof plugin.register, 'function');
      assert.ok(plugin.configSchema);
      assert.equal(plugin.configSchema.type, 'object');
    });

    it('has all expected config properties', () => {
      const props = Object.keys(plugin.configSchema.properties);
      assert.ok(props.includes('enabled'));
      assert.ok(props.includes('workspace'));
      assert.ok(props.includes('maxInjectChars'));
      assert.ok(props.includes('staleThresholdMs'));
      assert.ok(props.includes('tzOffset'));
    });
  });

  describe('register()', () => {
    it('registers hooks via api.on', () => {
      const hooks = {};
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: {},
        on: (name, fn) => {
          hooks[name] = fn;
        }
      };
      plugin.register(api);
      assert.ok(hooks['before_agent_start'], 'before_agent_start hook registered');
      assert.ok(hooks['before_compaction'], 'before_compaction hook registered');
    });

    it('falls back to registerHook if api.on is missing', () => {
      const hooks = {};
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: {},
        registerHook: (name, fn) => {
          hooks[name] = fn;
        }
      };
      plugin.register(api);
      assert.ok(hooks['before_agent_start'], 'before_agent_start registered via registerHook');
    });
  });

  describe('before_agent_start hook', () => {
    async function callHook(config) {
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: config || {},
        on: (name, fn) => {
          if (name === 'before_agent_start') hook = fn;
        }
      };
      // Need fresh module to reset state
      const mod = freshRequire('../auto-checkpoint/index.js');
      mod.register(api);
      assert.ok(hook, 'hook should be registered');
      return hook({}, {});
    }

    it('returns warning when no checkpoint file exists', async () => {
      const result = await callHook({ workspace: tmpDir });
      assert.ok(result.prependContext);
      assert.ok(result.prependContext.includes('No checkpoint file found'));
    });

    it('injects checkpoint content when file exists', async () => {
      const now = makeNowString(0);
      writeCheckpoint(tmpDir, `# Current State — ${now}\n\n## System\n- All good`);
      const result = await callHook({
        workspace: tmpDir,
        tzOffset: '+00:00'
      });
      assert.ok(result.prependContext);
      assert.ok(result.prependContext.includes('LAST CHECKPOINT'));
      assert.ok(result.prependContext.includes('All good'));
    });

    it('adds stale warning for old checkpoints', async () => {
      const oldTime = makeNowString(3); // 3 hours ago
      writeCheckpoint(tmpDir, `# Current State — ${oldTime}\n\n## System\n- Stale`);
      const result = await callHook({
        workspace: tmpDir,
        tzOffset: '+00:00',
        staleThresholdMs: 2 * 60 * 60 * 1000 // 2h
      });
      assert.ok(result.prependContext);
      assert.ok(result.prependContext.includes('STALE'));
    });

    it('does NOT add stale warning for fresh checkpoints', async () => {
      const now = makeNowString(0);
      writeCheckpoint(tmpDir, `# Current State — ${now}\n\n## System\n- Fresh`);
      const result = await callHook({
        workspace: tmpDir,
        tzOffset: '+00:00',
        staleThresholdMs: 2 * 60 * 60 * 1000
      });
      assert.ok(result.prependContext);
      assert.ok(!result.prependContext.includes('STALE'), 'Should not be stale');
    });

    it('truncates long checkpoint content', async () => {
      const now = makeNowString(0);
      const longContent = `# Current State — ${now}\n\n` + 'x'.repeat(5000);
      writeCheckpoint(tmpDir, longContent);
      const result = await callHook({
        workspace: tmpDir,
        maxInjectChars: 500,
        tzOffset: '+00:00'
      });
      // The injected content should be much shorter than 5000
      assert.ok(result.prependContext.length < 1000, 'Content should be truncated');
      assert.ok(result.prependContext.includes('...'), 'Should have truncation marker');
    });

    it('uses custom checkpoint file path', async () => {
      const customPath = path.join(tmpDir, 'custom-state.md');
      const now = makeNowString(0);
      fs.writeFileSync(customPath, `# Current State — ${now}\n\n## Custom\n- Works`);
      const result = await callHook({
        checkpointFile: customPath,
        tzOffset: '+00:00'
      });
      assert.ok(result.prependContext.includes('Custom'));
    });
  });

  describe('before_compaction hook', () => {
    it('creates backup file before compaction', async () => {
      let compactionHook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { workspace: tmpDir },
        on: (name, fn) => {
          if (name === 'before_compaction') compactionHook = fn;
        }
      };
      const mod = freshRequire('../auto-checkpoint/index.js');
      mod.register(api);

      // Create a checkpoint file
      writeCheckpoint(tmpDir, '# Current State — 2026-03-08 22:00\n\n## Test\n- data');

      // Trigger compaction
      await compactionHook({}, {});

      // Check backup exists
      const stateDir = path.join(tmpDir, 'state');
      const files = fs.readdirSync(stateDir);
      const backups = files.filter(f => f.startsWith('pre-compaction-'));
      assert.ok(backups.length >= 1, `Expected backup file, found: ${files.join(', ')}`);

      // Check content
      const backupContent = fs.readFileSync(path.join(stateDir, backups[0]), 'utf-8');
      assert.ok(backupContent.includes('Test'));
    });

    it('appends to compaction log', async () => {
      let compactionHook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { workspace: tmpDir },
        on: (name, fn) => {
          if (name === 'before_compaction') compactionHook = fn;
        }
      };
      const mod = freshRequire('../auto-checkpoint/index.js');
      mod.register(api);

      writeCheckpoint(tmpDir, '# Current State — 2026-03-08 22:00\n\ndata');
      await compactionHook({}, {});

      const logPath = path.join(tmpDir, 'state', 'compaction-log.txt');
      assert.ok(fs.existsSync(logPath), 'Compaction log should exist');
      const logContent = fs.readFileSync(logPath, 'utf-8');
      assert.ok(logContent.includes('compaction triggered'));
    });

    it('handles missing checkpoint gracefully during compaction', async () => {
      let compactionHook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { workspace: tmpDir },
        on: (name, fn) => {
          if (name === 'before_compaction') compactionHook = fn;
        }
      };
      const mod = freshRequire('../auto-checkpoint/index.js');
      mod.register(api);

      // Don't create checkpoint file
      fs.mkdirSync(path.join(tmpDir, 'state'), { recursive: true });

      // Should not throw
      await compactionHook({}, {});

      // Log should still be written
      const logPath = path.join(tmpDir, 'state', 'compaction-log.txt');
      assert.ok(fs.existsSync(logPath));
    });
  });

  describe('timestamp parsing edge cases', () => {
    async function getResult(headerLine) {
      let hook;
      const api = {
        log: { info: () => {}, warn: () => {} },
        config: { workspace: tmpDir, tzOffset: '+01:00' },
        on: (name, fn) => {
          if (name === 'before_agent_start') hook = fn;
        }
      };
      const mod = freshRequire('../auto-checkpoint/index.js');
      mod.register(api);
      writeCheckpoint(tmpDir, headerLine + '\n\nContent here');
      return hook({}, {});
    }

    it('parses standard format: # Current State — 2026-03-08 22:00', async () => {
      const result = await getResult('# Current State — 2026-03-08 22:00');
      assert.ok(result.prependContext.includes('Content here'));
    });

    it('parses single-digit hour: # Current State — 2026-03-08 9:30', async () => {
      const result = await getResult('# Current State — 2026-03-08 9:30');
      assert.ok(result.prependContext.includes('Content here'));
    });

    it('handles missing timestamp gracefully', async () => {
      const result = await getResult('# Some Other Header');
      // Should still work, just with stale warning (no parseable time)
      assert.ok(result.prependContext.includes('Content here'));
      assert.ok(result.prependContext.includes('STALE'), 'Unparseable time = stale');
    });
  });
});
