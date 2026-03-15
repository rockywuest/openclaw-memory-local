# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
