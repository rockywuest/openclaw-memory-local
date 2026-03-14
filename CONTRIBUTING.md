# Contributing

Thanks for considering a contribution! Here's how to get started.

## Quick Start

```bash
git clone https://github.com/rockywuest/openclaw-memory-local.git
cd openclaw-memory-local
npm test  # 60 tests, zero external deps
```

## Before Submitting a PR

1. **Run tests:** `npm test` — all 60 must pass
2. **No new dependencies:** This project has zero runtime deps by design
3. **Follow existing style:** 2-space indent, `"use strict"`, consistent error handling
4. **Update docs:** If you change behavior, update the relevant SKILL.md and README

## What We're Looking For

- Bug fixes with test coverage
- Performance improvements (especially for ARM/Pi)
- New skip patterns for auto-capture
- Preference learner dimension proposals
- Documentation improvements

## What We Won't Merge

- Cloud dependencies or external API calls
- Telemetry, analytics, or tracking
- Breaking changes to plugin interfaces without discussion

## Reporting Issues

Open an issue with:
- What you expected
- What happened
- Your environment (OS, Node version, OpenClaw version)
- Minimal reproduction steps

## License

By contributing, you agree your work is licensed under MIT.
