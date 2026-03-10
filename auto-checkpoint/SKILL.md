---
name: auto-checkpoint
description: >
  Injects last operational state into every agent session and creates backups before
  context compaction. Reads a checkpoint file (e.g. state/current.md) and injects it
  as context so the agent always knows where it left off. Warns when the checkpoint
  is stale. Use when building persistent agents that need continuity across sessions,
  context compactions, or restarts.
license: MIT
compatibility: OpenClaw 2026.1.30+, Node.js >= 20
metadata:
  author: rotomi
  version: "2.0.0"
  platform: openclaw-plugin
---

# Auto-Checkpoint — Session Continuity for AI Agents

Ensures your agent never loses track of what it was doing. Reads your checkpoint file at session start and injects it as structured context.

## What It Does

1. **State Injection** — reads `state/current.md` (configurable) and injects it into the agent's context at session start
2. **Staleness Detection** — warns if the checkpoint is older than a configurable threshold (default: 2 hours)
3. **Compaction Backup** — before OpenClaw compacts context, saves the current checkpoint with a timestamp suffix
4. **Timezone-Aware** — all timestamps respect your configured timezone offset

## Configuration

In your `openclaw.json` plugins section:

```json
{
  "id": "auto-checkpoint",
  "enabled": true,
  "config": {
    "workspace": "/home/user/workspace",
    "checkpointFile": "state/current.md",
    "maxInjectChars": 3000,
    "staleThresholdMs": 7200000,
    "tzOffset": "+01:00"
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `workspace` | cwd | Path to your workspace root |
| `checkpointFile` | `state/current.md` | Checkpoint file relative to workspace |
| `maxInjectChars` | 3000 | Max characters to inject (truncates from end) |
| `staleThresholdMs` | 7200000 | Staleness warning threshold (2h) |
| `tzOffset` | `+00:00` | Timezone offset for timestamps |

## Hooks

| Hook | When | What |
|------|------|------|
| `before_agent_start` | Every session | Reads checkpoint, injects as context, warns if stale |
| `before_compaction` | Before context compaction | Creates timestamped backup of checkpoint |

## How It Works

```
Agent session starts
    │
    ▼
auto-checkpoint reads state/current.md
    │
    ├── File exists + fresh → Inject as context ✅
    ├── File exists + stale → Inject + warn ⚠️
    └── File missing → Skip silently
    │
    ▼
Agent gets: "LETZTER CHECKPOINT: [content]"
```

## Edge Cases

- **Empty checkpoint file** — skipped, no injection
- **File exceeds maxInjectChars** — truncated with `[TRUNCATED]` marker
- **Compaction backup** — saved as `state/current.md.backup-20260310T120000`
- **Read errors** — logged and skipped (never blocks session start)

## References

- See [index.js](index.js) for the implementation
- See [openclaw.plugin.json](openclaw.plugin.json) for the plugin manifest
- Tests: [../test/auto-checkpoint.test.js](../test/auto-checkpoint.test.js) (20 tests)
