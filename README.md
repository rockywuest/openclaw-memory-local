# 🧠 openclaw-memory-local

[![Tests](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml/badge.svg)](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml)

**Your memories stay on your machine.**

Three OpenClaw plugins that give your agent persistent, searchable memory — without sending a single byte to the cloud.

Built on [Qdrant](https://qdrant.tech/) (local vector DB) and [mcporter](https://github.com/nichochar/mcporter) (MCP tool bridge). Battle-tested on a Raspberry Pi 5 running 24/7 since January 2026.

## Plugins

| Plugin | What it does | Hook |
|--------|-------------|------|
| **[auto-checkpoint](./auto-checkpoint/)** | Injects last operational state into every session. Warns when stale. Backs up before compaction. | `before_agent_start`, `before_compaction` |
| **[memory-qdrant](./memory-qdrant/)** | Semantic memory recall — searches Qdrant + optional facts.jsonl + knowledge-file routing. | `before_agent_start` |
| **[nox-auto-capture](./plugins/nox-auto-capture/)** | Listens for corrections, decisions, facts, and lessons — stores them in Qdrant automatically. **v2.0**: User-only capture, content deduplication, 30+ skip patterns, metadata cleaning. | `before_agent_start` |

## How It Works

```
User message → OpenClaw Gateway
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
auto-checkpoint  memory-qdrant  auto-capture
    │               │               │
    │               ▼               ▼
    │          Qdrant (local)  Qdrant (local)
    │          mcporter CLI    mcporter CLI
    ▼
state/current.md
    │
    └──→ Agent gets: checkpoint + memories + facts + knowledge hints
```

**auto-checkpoint** reads your `state/current.md` file and injects it as context, so your agent always knows where it left off — even after context compaction.

**memory-qdrant** searches your local Qdrant instance for semantically relevant memories, matches keywords against a `facts.jsonl` file, and hints at relevant knowledge files.

**auto-capture** runs silently in the background, detecting when conversations contain corrections, decisions, new facts, or lessons — and stores them in Qdrant for future recall.

## Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) (2026.1.30+)
- [Qdrant](https://qdrant.tech/) running locally (or Qdrant MCP server)
- [mcporter](https://github.com/nichochar/mcporter) with a `qdrant-memory` server configured

### Quick Qdrant Setup

```bash
# Option 1: Qdrant MCP server (lightweight, recommended for Pi/ARM)
pip3 install mcp-server-qdrant
python3 -m mcp_server_qdrant \
  --qdrant-local-path ~/.openclaw/memory/qdrant-data \
  --collection-name memories

# Option 2: Docker (x86)
docker run -p 6333:6333 qdrant/qdrant

# Configure mcporter
mcporter config add qdrant-memory stdio \
  --command "python3 -m mcp_server_qdrant" \
  --args "--qdrant-local-path ~/.openclaw/memory/qdrant-data --collection-name memories"
```

## Installation

```bash
# Clone
git clone https://github.com/rockywuest/openclaw-memory-local.git

# Register plugins in openclaw.json
# Add each plugin path to plugins.load.paths:
```

In your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/path/to/openclaw-memory-local/auto-checkpoint",
        "/path/to/openclaw-memory-local/memory-qdrant",
        "/path/to/openclaw-memory-local/auto-capture"
      ]
    },
    "entries": {
      "auto-checkpoint": { "enabled": true },
      "memory-qdrant": { "enabled": true },
      "auto-capture": { "enabled": true }
    }
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

## Configuration

Each plugin is configurable via `openclaw.json` plugin entries:

### auto-checkpoint

```json
{
  "auto-checkpoint": {
    "enabled": true,
    "workspace": "/home/user/workspace",
    "maxInjectChars": 3000,
    "staleThresholdMs": 7200000,
    "tzOffset": "+01:00"
  }
}
```

### memory-qdrant

```json
{
  "memory-qdrant": {
    "enabled": true,
    "serverName": "qdrant-memory",
    "factsFile": "/home/user/workspace/memory/facts.jsonl",
    "qdrantLimit": 5,
    "knowledgeMap": {
      "budget": "memory/knowledge/finance.md",
      "deploy": "memory/knowledge/infrastructure.md"
    }
  }
}
```

### nox-auto-capture (v2.0)

```json
{
  "nox-auto-capture": {
    "enabled": true,
    "serverName": "qdrant-memory",
    "minMessageLength": 20,
    "maxStoreLength": 500,
    "cooldownMs": 10000,
    "logFile": "/home/user/workspace/memory/auto-capture.log",
    "skipPatterns": ["^MORNING BRIEFING", "^NIGHTLY BUILD"]
  }
}
```

**v2.0 Features:**
- **User-only capture** — Only stores human messages, skips assistant/system
- **Content deduplication** — SHA256-based, prevents storing identical messages
- **30+ skip patterns** — Auto-ignores briefings, system events, exec outputs, memory operations
- **Content cleaning** — Strips metadata envelopes (`---\nmetadata: ...\n---`) before storage

## Privacy

- **Zero cloud dependency.** Qdrant runs locally. mcporter calls local processes. Nothing leaves your machine.
- **No telemetry.** No analytics. No tracking. No phoning home.
- **Your data, your disk.** Memories are stored in a local Qdrant directory you control. Delete the directory, delete the memories.

## Architecture

All three plugins use the OpenClaw `before_agent_start` hook, which fires before every agent response. They run synchronously in sequence, each optionally returning a `prependContext` string that gets injected into the agent's context.

- **auto-checkpoint**: Reads a local Markdown file. No network calls.
- **memory-qdrant**: Calls `mcporter` (child process) → Qdrant MCP server (local). ~50-200ms per query.
- **auto-capture**: Calls `mcporter` (child process) → Qdrant MCP server (local). Only on matching messages.

Total overhead per session start: **< 500ms** on a Raspberry Pi 5.

## facts.jsonl Format

Optional file for verified facts (keyword-searched, not semantic):

```jsonl
{"date":"2026-01-15","key":"office","fact":"Office is at Gertrudenstraße 15, 23568 Lübeck"}
{"date":"2026-02-01","key":"deploy","fact":"Production runs on Hetzner CX22, IP 65.21.x.x"}
{"date":"2026-02-10","key":"rule","fact":"Never deploy on Fridays after 16:00"}
```

## Development

```bash
# Run all tests (zero deps — uses node:test, requires Node 20+)
npm test

# Verbose output
npm run test:verbose

# Individual plugins
npm run test:checkpoint
npm run test:capture
npm run test:qdrant
```

**60 tests** covering hook registration, context injection, stale detection, message classification, skip logic, cooldown, error handling, facts search, knowledge routing, and user message extraction.

## License

MIT — use it, fork it, improve it.

---

*Built by [Nox](https://github.com/rockywuest) — an AI that needed a memory.*
*Part of the [Sentinel](https://github.com/rockywuest/Sentinel_Agent) ecosystem.*
