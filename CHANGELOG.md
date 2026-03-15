# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-03-15

### Added — Ambient Intelligence Engine (AIE)

Inspired by [Total Recall](https://github.com/gavdalf/total-recall), but OpenClaw-native.

**Three new plugins:**

- **nox-event-bus**: Central event bus for sensors and insights
  - JSONL persistence (`memory/events/bus.jsonl`)
  - Auto-pruning (7-day retention, TTL expiry)
  - In-memory listeners (`on/off/emit`)
  - Context injection (top-N events by importance × recency)
  - Supported topics: `sensor.email`, `sensor.calendar`, `sensor.file`, `sensor.system`, `agent.insight`, `agent.alert`

- **nox-preconscious**: Preconscious buffer plugin
  - Scores events: importance × recency_decay × reinforcement_count
  - Recency decay: 24h half-life (configurable)
  - Generates Markdown buffer (`memory/preconscious-buffer.md`)
  - Token limiting (max 500 tokens, auto-truncates)
  - Reinforcement tracking (`memory/events/reinforcement.jsonl`)

- **nox-emergency**: Emergency surface plugin
  - Escalates urgent events (importance ≥ 0.85)
  - TTL expiry detection (alerts if <2h remaining)
  - SHA256 deduplication (same alert not escalated twice)
  - Rate limiting (max 2 alerts/day, anti-spam)
  - Unhandled alert injection as ⚠️ URGENT context

**45 new tests:**
- `test/event-bus.test.js` — 16 tests (emit, on/off, persistence, pruning, relevance scoring)
- `test/preconscious.test.js` — 15 tests (scoring, decay, buffer generation, token limit)
- `test/emergency.test.js` — 15 tests (threshold, TTL, dedup, rate limit, alert format)

**Zero external dependencies**: Node.js stdlib only (fs, path, crypto, os).

### Changed
- README: Added AIE architecture diagram, plugin table, Total Recall comparison
- Architecture: Event-driven sensor pipeline alongside existing memory system
- All existing tests still pass (auto-capture, auto-checkpoint, memory-qdrant)

### Technical Notes
- **vs. Total Recall**: OpenClaw plugin hooks (no cron), Node.js (no bash/jq), testable architecture (100% coverage), native event listeners
- **Integration**: Plugins expose instances via `api.shared` for cross-plugin communication
- **Performance**: < 500ms overhead per session start (tested on Raspberry Pi 5)

## [2.0.1] - 2026-03-15

### Added
- **Troubleshooting section** in README: diagnosing empty `memory_search` results, verifying plugin independence from OpenClaw embedding provider
- **`scripts/memory-health.sh`**: Standalone health check covering 7 subsystems (Qdrant access, mcporter find/store, embedding cache, sync cron, memory files, config). Exit 0/1 for automation.

## [2.0.0] - 2026-03-10

### Added
- **nox-auto-capture v2.0**: Major redesign for production use
  - User-only capture: Only stores human messages, skips assistant/system
  - Content deduplication: SHA256-based hash prevents storing identical messages
  - 30+ skip patterns: Auto-ignores briefings, system events, exec outputs, memory operations
  - Content cleaning: Strips metadata envelopes before storage
  - Improved signal-to-noise: 7.1% junk reduction in production testing

### Changed
- Plugin renamed from `auto-capture` to `nox-auto-capture` for clarity
- Default skip patterns expanded to cover common system messages
- Log format now includes deduplication status

### Fixed
- Metadata pollution: Markdown metadata blocks no longer stored in embeddings
- Duplicate memories: Same user correction no longer stored multiple times
- System noise: Status updates, briefings, and technical logs properly filtered

## [1.0.0] - 2026-01-15

### Added
- Initial release
- `auto-checkpoint`: State injection and compaction backup
- `memory-qdrant`: Semantic recall + facts.jsonl search
- `auto-capture`: Automatic memory storage from conversations
- 60 test coverage
- Zero-cloud architecture
