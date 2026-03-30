# Auto-Checkpoint

Session continuity for AI agents. Injects your last operational state into every session and creates backups before context compaction.

## Features

- **State Injection** — reads `state/current.md` and injects it as context
- **Staleness Detection** — warns if checkpoint is older than threshold
- **Compaction Backup** — saves timestamped backup before context compaction
- **Timezone-Aware** — all timestamps respect configured offset

## Quick Start

1. Add to your `openclaw.json`:

```json
{
  "plugins": [
    {
      "id": "auto-checkpoint",
      "enabled": true,
      "config": {
        "workspace": "/path/to/workspace",
        "checkpointFile": "state/current.md"
      }
    }
  ]
}
```

2. Create `state/current.md` in your workspace with your agent's current state.

3. The plugin automatically injects it at every session start.

## Configuration

| Option             | Default            | Description              |
| ------------------ | ------------------ | ------------------------ |
| `workspace`        | cwd                | Workspace root path      |
| `checkpointFile`   | `state/current.md` | Checkpoint file path     |
| `maxInjectChars`   | 3000               | Max injection size       |
| `staleThresholdMs` | 7200000            | Staleness threshold (2h) |
| `tzOffset`         | `+00:00`           | Timezone offset          |

## License

MIT — see [LICENSE](../LICENSE)
