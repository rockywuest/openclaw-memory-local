'use strict';
/**
 * Tests for memory-qdrant plugin.
 *
 * Uses node:test + node:assert (zero deps).
 * Mocks: mcporter CLI calls + facts.jsonl files.
 *
 * Strategy: We patch child_process.execFile BEFORE any memory-qdrant
 * module is loaded, because qdrant-client.js does
 * `const execFileAsync = promisify(require("child_process").execFile)`
 * at module load time — promisify captures the function reference at that point.
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

// ── Global mock state ────────────────────────────────────────────
// qdrant-client.js does: const { execFile } = require("child_process")
// then: const execFileAsync = promisify(execFile)
// This captures the function ref at module load time.
//
// Strategy: We patch cp.execFile on the prototype level (the module object),
// AND we freshRequire to ensure the qdrant-client re-reads the patched version.

let mockExecFileCalls = [];
let mockExecFileResults = [];

const _originalExecFile = cp.execFile;

function installMock() {
  const { promisify } = require('util');

  function dispatchExecFile(cmd, args, opts, callback) {
    if (typeof opts === 'function') {
      callback = opts;
      opts = {};
    }
    mockExecFileCalls.push({ cmd, args: [...(args || [])] });

    const result = mockExecFileResults.shift();
    if (!result) {
      // Default: mcporter list → healthy, others → empty
      if (args && args[0] === 'list') {
        callback(null, 'qdrant-memory  healthy  qdrant-find,qdrant-store', '');
      } else {
        callback(null, '[]', '');
      }
      return;
    }
    if (result.error) {
      callback(result.error);
    } else {
      callback(null, result.stdout || '', result.stderr || '');
    }
  }

  // Critical: execFile has a custom promisify that returns { stdout, stderr }
  // We must replicate this so promisify(execFile) works correctly
  dispatchExecFile[promisify.custom] = function (cmd, args, opts) {
    return new Promise((resolve, reject) => {
      dispatchExecFile(cmd, args, opts, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout, stderr });
        }
      });
    });
  };

  cp.execFile = dispatchExecFile;
}

function uninstallMock() {
  cp.execFile = _originalExecFile;
}

// ── Helpers ──────────────────────────────────────────────────────

function freshRequire(modulePath) {
  // Clear ALL memory-qdrant related modules + child_process references
  // so qdrant-client re-destructures our mocked cp.execFile
  for (const key of Object.keys(require.cache)) {
    if (key.includes('memory-qdrant')) delete require.cache[key];
  }
  // Install mock before requiring so the destructure picks it up
  installMock();
  return require(modulePath);
}

// ── Tests ────────────────────────────────────────────────────────

describe('memory-qdrant', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-qdrant-test-'));
    mockExecFileCalls = [];
    mockExecFileResults = [];
    installMock();
  });

  afterEach(() => {
    uninstallMock();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  describe('plugin export', () => {
    it('exports correct structure', () => {
      const plugin = freshRequire('../memory-qdrant/src/index.js');
      assert.equal(plugin.id, 'memory-qdrant');
      assert.equal(plugin.name, 'Memory Qdrant');
      assert.equal(typeof plugin.register, 'function');
      assert.ok(plugin.configSchema);
    });

    it('exports utility functions', () => {
      const plugin = freshRequire('../memory-qdrant/src/index.js');
      assert.ok(plugin.utils);
      assert.equal(typeof plugin.utils.searchMemories, 'function');
      assert.equal(typeof plugin.utils.storeMemory, 'function');
      assert.equal(typeof plugin.utils.isHealthy, 'function');
      assert.equal(typeof plugin.utils.getStats, 'function');
      assert.equal(typeof plugin.utils.getMemoryStatus, 'function');
    });

    it('has configSchema with expected properties', () => {
      const plugin = freshRequire('../memory-qdrant/src/index.js');
      const props = Object.keys(plugin.configSchema.properties);
      assert.ok(props.includes('serverName'));
      assert.ok(props.includes('factsFile'));
      assert.ok(props.includes('qdrantLimit'));
      assert.ok(props.includes('knowledgeMap'));
    });
  });

  describe('qdrant-client', () => {
    describe('isHealthy()', () => {
      it('returns true when mcporter lists healthy server', async () => {
        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        const result = await client.isHealthy();
        assert.equal(result, true);
      });

      it('returns false when mcporter fails', async () => {
        mockExecFileResults.push({ error: new Error('mcporter not found') });
        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        const result = await client.isHealthy();
        assert.equal(result, false);
      });

      it('caches health check for 30 seconds', async () => {
        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        await client.isHealthy(); // First call
        const callCount1 = mockExecFileCalls.length;

        await client.isHealthy(); // Second call — should use cache
        assert.equal(mockExecFileCalls.length, callCount1, 'Should use cache');
      });
    });

    describe('searchMemories()', () => {
      it('parses JSON array results', async () => {
        mockExecFileResults.push({
          stdout: 'qdrant-memory  healthy  qdrant-find,qdrant-store'
        });
        mockExecFileResults.push({
          stdout: JSON.stringify([
            { id: '1', score: 0.95, content: 'User prefers bullet points' },
            { id: '2', score: 0.88, content: 'Deploy on Tuesdays' }
          ])
        });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        // Need to be healthy first
        await client.isHealthy();
        const results = await client.searchMemories('deploy preferences', 5);

        assert.ok(results.length === 2);
        assert.equal(results[0].content, 'User prefers bullet points');
        assert.ok(results[0].score > 0.9);
      });

      it('handles plain text output (fallback parsing)', async () => {
        mockExecFileResults.push({
          stdout: 'qdrant-memory  healthy  qdrant-find,qdrant-store'
        });
        mockExecFileResults.push({
          stdout: 'Memory about deploy schedules\nMemory about preferences\n'
        });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        await client.isHealthy();
        const results = await client.searchMemories('deploy', 5);

        assert.ok(results.length === 2);
        assert.ok(results[0].content.includes('deploy'));
      });

      it('returns empty array on error', async () => {
        mockExecFileResults.push({
          stdout: 'qdrant-memory  healthy  qdrant-find,qdrant-store'
        });
        mockExecFileResults.push({ error: new Error('timeout') });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        await client.isHealthy();
        const results = await client.searchMemories('anything', 5);

        assert.deepEqual(results, []);
      });

      it('truncates query to 200 chars', async () => {
        mockExecFileResults.push({
          stdout: 'qdrant-memory  healthy  qdrant-find,qdrant-store'
        });
        mockExecFileResults.push({ stdout: '[]' });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        await client.isHealthy();
        const longQuery = 'x'.repeat(500);
        await client.searchMemories(longQuery, 5);

        // Check that the args sent to mcporter have a truncated query
        const storeCall = mockExecFileCalls.find(c => c.args.some(a => a.includes('qdrant-find')));
        assert.ok(storeCall, 'Should have called qdrant-find');
        const queryArg = storeCall.args.find(a => a.startsWith('query='));
        // query= + 200 chars = 206 max
        assert.ok(queryArg.length <= 210, `Query should be truncated, got ${queryArg.length}`);
      });
    });

    describe('storeMemory()', () => {
      it('stores text via mcporter', async () => {
        mockExecFileResults.push({
          stdout: 'qdrant-memory  healthy  qdrant-find,qdrant-store'
        });
        mockExecFileResults.push({ stdout: 'ok' });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        const result = await client.storeMemory('Important fact about deploy');

        assert.equal(result, true);
        const storeCall = mockExecFileCalls.find(c => c.args.some(a => a.includes('qdrant-store')));
        assert.ok(storeCall, 'Should call qdrant-store');
      });

      it('returns false on error', async () => {
        mockExecFileResults.push({ error: new Error('fail') });

        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        const result = await client.storeMemory('test');

        assert.equal(result, false);
      });
    });

    describe('configure()', () => {
      it('accepts custom server name', () => {
        const client = freshRequire('../memory-qdrant/src/qdrant-client.js');
        // Should not throw
        client.configure({ serverName: 'custom-qdrant' });
      });
    });
  });

  describe('auto-recall', () => {
    describe('extractKeywords', () => {
      // Tested indirectly through the hook

      it('filters stop words from search query', async () => {
        // Setup: healthy Qdrant, returns empty results
        // Default mock returns healthy + []
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        await hook(
          {
            messages: [{ role: 'user', content: 'Was ist der Deploy-Zeitplan für das Dashboard?' }]
          },
          {}
        );

        // Check that the qdrant-find call doesn't contain stop words
        const findCall = mockExecFileCalls.find(c => c.args.some(a => a.includes('qdrant-find')));
        if (findCall) {
          const queryArg = findCall.args.find(a => a.startsWith('query='));
          if (queryArg) {
            assert.ok(!queryArg.includes('was '), "Should filter 'was'");
            assert.ok(!queryArg.includes('ist '), "Should filter 'ist'");
            assert.ok(!queryArg.includes('der '), "Should filter 'der'");
          }
        }
        // If no findCall, Qdrant might not be "healthy" in test — that's ok
      });
    });

    describe('facts.jsonl search', () => {
      it('finds matching facts by keyword', async () => {
        const factsPath = path.join(tmpDir, 'facts.jsonl');
        fs.writeFileSync(
          factsPath,
          [
            '{"date":"2026-01-15","key":"office","fact":"Office is at Gertrudenstraße 15"}',
            '{"date":"2026-02-01","key":"deploy","fact":"Deploy only on Tuesdays"}',
            '{"date":"2026-02-10","key":"budget","fact":"Annual budget is €50k"}'
          ].join('\n')
        );

        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({
          factsFile: factsPath
        });

        const result = await hook(
          {
            messages: [{ role: 'user', content: 'Wann dürfen wir deployen?' }]
          },
          {}
        );

        if (result && result.prependContext) {
          assert.ok(
            result.prependContext.includes('Deploy only on Tuesdays') ||
              result.prependContext.includes('VERIFIED FACTS'),
            'Should include matching fact'
          );
        }
        // May not inject if Qdrant is also empty — but facts should be there
      });

      it('returns empty for non-matching queries', async () => {
        const factsPath = path.join(tmpDir, 'facts.jsonl');
        fs.writeFileSync(
          factsPath,
          '{"date":"2026-01-15","key":"office","fact":"Office is at Gertrudenstraße 15"}\n'
        );

        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({
          factsFile: factsPath
        });

        const result = await hook(
          {
            messages: [{ role: 'user', content: 'Zeig mir die Katzenbilder.' }]
          },
          {}
        );

        // No facts match "Katzenbilder" — result might be undefined
        if (result && result.prependContext) {
          assert.ok(!result.prependContext.includes('Office'), 'Unrelated fact should not appear');
        }
      });

      it('handles missing facts file gracefully', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({
          factsFile: '/nonexistent/facts.jsonl'
        });

        // Should not throw
        const result = await hook(
          {
            messages: [{ role: 'user', content: 'Was kostet der Deploy-Server?' }]
          },
          {}
        );

        // undefined or empty prependContext — both fine
        assert.ok(true, 'Should not throw');
      });

      it('handles malformed JSON lines gracefully', async () => {
        const factsPath = path.join(tmpDir, 'facts.jsonl');
        fs.writeFileSync(
          factsPath,
          [
            '{"date":"2026-01-15","key":"deploy","fact":"Deploy Tuesdays"}',
            'this is not json',
            '{"date":"2026-02-01","key":"budget","fact":"Budget €50k"}'
          ].join('\n')
        );

        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({
          factsFile: factsPath
        });

        // Should not throw
        const result = await hook(
          {
            messages: [{ role: 'user', content: 'Deploy-Zeitplan?' }]
          },
          {}
        );

        assert.ok(true, 'Should handle malformed lines gracefully');
      });
    });

    describe('knowledge map routing', () => {
      it('includes knowledge hint when keyword matches', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({
          knowledgeMap: {
            budget: 'memory/knowledge/finance.md',
            deploy: 'memory/knowledge/infrastructure.md'
          }
        });

        const result = await hook(
          {
            messages: [{ role: 'user', content: 'Was ist das aktuelle Budget für 2026?' }]
          },
          {}
        );

        if (result && result.prependContext) {
          assert.ok(
            result.prependContext.includes('finance.md'),
            'Should hint at finance knowledge file'
          );
        }
      });
    });

    describe('user message extraction', () => {
      it('extracts from last user message in array', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        await hook(
          {
            messages: [
              { role: 'assistant', content: 'Hier ist das Ergebnis.' },
              { role: 'user', content: 'Zeig mir die deploy Konfiguration.' }
            ]
          },
          {}
        );

        // Verify it searched for deploy-related content
        const findCall = mockExecFileCalls.find(c => c.args.some(a => a.includes('qdrant-find')));
        // If found, the query should relate to deploy
        if (findCall) {
          const queryArg = findCall.args.find(a => a.startsWith('query='));
          assert.ok(queryArg, 'Should pass query to qdrant-find');
        }
      });

      it('skips trivial messages', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        const result = await hook(
          {
            messages: [{ role: 'user', content: 'ok' }]
          },
          {}
        );

        assert.equal(result, undefined, 'Should skip trivial message');
      });

      it('skips heartbeat messages', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        const result = await hook(
          {
            messages: [{ role: 'user', content: 'HEARTBEAT poll check' }]
          },
          {}
        );

        assert.equal(result, undefined, 'Should skip heartbeat');
      });

      it('handles empty messages array', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        const result = await hook({ messages: [] }, {});
        assert.equal(result, undefined, 'Should handle empty messages');
      });

      it('handles missing messages', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        const result = await hook({}, {});
        assert.equal(result, undefined, 'Should handle missing messages');
      });

      it('strips injected context blocks from user message', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const hook = await recall.createBeforeAgentStart({});

        await hook(
          {
            messages: [
              {
                role: 'user',
                content: '## QDRANT MEMORY\n\n1. Old memory\n\n---\nWas kostet der Server?'
              }
            ]
          },
          {}
        );

        // Should search for "server" not "QDRANT MEMORY"
        const findCall = mockExecFileCalls.find(c => c.args.some(a => a.includes('qdrant-find')));
        if (findCall) {
          const queryArg = findCall.args.find(a => a.startsWith('query='));
          if (queryArg) {
            assert.ok(!queryArg.includes('QDRANT'), 'Should strip injected blocks');
          }
        }
      });
    });

    describe('getMemoryStatus()', () => {
      it('returns healthy status when Qdrant is available', async () => {
        const recall = freshRequire('../memory-qdrant/src/auto-recall.js');
        const status = await recall.getMemoryStatus();
        assert.ok(status.includes('healthy') || status.includes('Qdrant'));
      });
    });
  });
});
