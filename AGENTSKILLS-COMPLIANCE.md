# agentskills.io Compliance Report

**Date:** 2026-03-10
**Spec Version:** agentskills.io v1 (fetched 2026-03-10)
**Validator:** `scripts/validate-skills.sh`

## Summary

| Plugin | Frontmatter | Body | License | Tests | Status |
|--------|-------------|------|---------|-------|--------|
| auto-checkpoint | ✅ | ✅ 73 lines / ~431 tokens | MIT | ✅ 16 tests | **COMPLIANT** |
| memory-qdrant | ✅ | ✅ 87 lines / ~520 tokens | MIT | ✅ 24 tests | **COMPLIANT** |
| nox-auto-capture | ✅ | ✅ 92 lines / ~579 tokens | MIT | ✅ 20 tests | **COMPLIANT** |

All 3 plugins pass spec validation: **39 ✅, 0 ⚠️, 0 ❌**

## Spec Compliance Checklist

### Required Fields
- [x] `name` — lowercase, a-z + hyphens, max 64 chars, matches directory name
- [x] `description` — non-empty, max 1024 chars, describes what + when to use

### Optional Fields (all present)
- [x] `license` — MIT (matches root LICENSE file)
- [x] `compatibility` — runtime requirements listed
- [x] `metadata` — author (rotomi), version, platform

### Structure
- [x] SKILL.md with YAML frontmatter (`---` delimiters)
- [x] Body content < 500 lines (all plugins: 73-92 lines)
- [x] Estimated tokens < 5000 (all plugins: 431-579 tokens)
- [x] README.md present in each plugin
- [x] LICENSE file accessible (root level)
- [x] Implementation files in each plugin
- [x] Tests: 60 tests, 100% pass rate (repo-level `test/`)

### Progressive Disclosure
- [x] Metadata (~100 tokens per plugin at boot)
- [x] Full SKILL.md body loaded on activation (< 600 tokens each)
- [x] Implementation files loaded on demand

## Dual-Format: OpenClaw Plugin + agentskills.io Skill

Each plugin contains both:
- `openclaw.plugin.json` — OpenClaw plugin manifest (hooks, configSchema)
- `SKILL.md` — agentskills.io skill format (description, instructions, references)

This makes them discoverable on both the ClawhHub marketplace and any agent supporting agentskills.io (Claude Code, Codex, Cursor, Gemini CLI, Junie, OpenHands, Goose, Amp, Letta, and 25+ others).

## Compatible Platforms (33+)

These skills work with any agent that supports the agentskills.io format:
- OpenAI Codex, Claude Code, Cursor, VS Code Copilot
- Gemini CLI, Junie (JetBrains), Goose (Block)
- OpenHands, Amp, Letta, Roo Code, TRAE (ByteDance)
- Databricks, Spring AI, Factory, Mux, Firebender, and many more

## Validation

```bash
# Run the validator
cd openclaw-memory-local
./scripts/validate-skills.sh

# Run tests
npm test

# Validate a single plugin
./scripts/validate-skills.sh auto-checkpoint/
```

## What Changed

### Added
- `auto-checkpoint/SKILL.md` — agentskills.io frontmatter + instructions
- `memory-qdrant/SKILL.md` — agentskills.io frontmatter + instructions
- `plugins/nox-auto-capture/SKILL.md` — agentskills.io frontmatter + instructions
- `auto-checkpoint/README.md` — plugin-level documentation
- `memory-qdrant/README.md` — plugin-level documentation
- `plugins/nox-auto-capture/README.md` — plugin-level documentation
- `scripts/validate-skills.sh` — 13-point spec validator
- `AGENTSKILLS-COMPLIANCE.md` — this file

## Next Steps

1. **maintainer approval** → Submit to ClawhHub
2. Add `agentskills.io` badge to main README
3. Consider submitting to agentskills.io registry (if they have one)
