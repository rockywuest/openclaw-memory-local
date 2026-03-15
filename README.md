# 🧠 openclaw-memory-local

[![Tests](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml/badge.svg)](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml)
[![agentskills.io](https://img.shields.io/badge/agentskills.io-compliant-brightgreen)](https://agentskills.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Your memories stay on your machine. Your agent actually learns from you.**

Ten OpenClaw plugins that give your agent persistent, searchable, biologically-inspired memory — with behavioral learning, ambient intelligence, cognitive adaptation, and emergency alerting. Without sending a single byte to the cloud.

**New: One-line install with `nox-memory-suite`.** One plugin path, one config entry, full stack. [Quick Start →](#quick-start)

> Most agent memory is a glorified clipboard. Copy-paste your MEMORY.md, hope for the best. This is different: semantic search, automatic capture, behavioral adaptation, ambient awareness, and emergency escalation — all local, all open source. Running 24/7 in production since January 2026.

## Why Not Just MEMORY.md?

| Approach | Token Cost | Recall | Learns Facts? | Adapts Behavior? | Watches for You? |
|----------|-----------|--------|---------------|-----------------|-----------------|
| Flat MEMORY.md | 5-10K every session | ❌ Degrades | ❌ | ❌ | ❌ |
| Hierarchical files | ~1.5K + drill-downs | 🟡 Manual | ❌ | ❌ | ❌ |
| Cloud memory (Mem0, Zep) | ~2K | ✅ | ✅ | ❌ | ❌ |
| **This project** | ~2K + semantic hits | ✅ Vector search | ✅ Auto-capture | ✅ Preference Learner | ✅ Ambient Intelligence |

Flat files scale linearly. Vector search scales logarithmically. Nobody else adapts agent *behavior* from conversation feedback — they only store facts. And nobody else watches for urgent events and surfaces them proactively.

## Plugins

| Plugin | What it does | Layer |
|--------|-------------|-------|
| **[auto-checkpoint](./auto-checkpoint/)** | Injects last operational state. Warns when stale. Backs up before compaction. | Remember |
| **[memory-qdrant](./memory-qdrant/)** | Semantic recall — searches Qdrant + facts.jsonl + knowledge-file routing. | Recall |
| **[auto-capture](./plugins/nox-auto-capture/)** | Detects corrections, decisions, facts, lessons — stores them automatically. | Learn |
| **[preference-learner](./plugins/nox-preference-learner/)** | **Train by Talking.** Adapts agent behavior across 6 dimensions from your feedback. | Adapt |
| **[event-bus](./plugins/nox-event-bus/)** | Central event bus + sensor connectors (file, system). JSONL persistence. | Sense |
| **[preconscious](./plugins/nox-preconscious/)** | Scores events by importance × recency. Surfaces top insights as context. | Anticipate |
| **[emergency](./plugins/nox-emergency/)** | Escalates urgent events. Dedup, rate limiting, TTL expiry detection. | Alert |
| **[fademem](./plugins/nox-fademem/)** | Access-weighted Memory Decay — memories that are never retrieved fade. | Cognitive |
| **[cooccurrence](./plugins/nox-cooccurrence/)** | Hebbian Learning — tracks concept co-occurrences for associative memory. | Cognitive |
| **[fingerprint](./plugins/nox-fingerprint/)** | Cognitive Fingerprint — personality profile based on memory topology + drift detection. | Cognitive |
| **[memory-suite](./plugins/nox-memory-suite/)** | **Meta-plugin** — one config entry activates all of the above. Presets: `full`, `core`, `minimal`. | All |

All plugins hook into `before_agent_start` — your agent gets the full picture before every response.

## Architecture

```
                    External World
                         │
          ┌──────────────┼──────────────┐
          ▼              ▼              ▼
     [Sensors]      [User Talk]    [Agent Work]
     email, cal,    corrections,   checkpoints,
     files, system  decisions      state changes
          │              │              │
          ▼              ▼              ▼
    ┌─────────────── event-bus ──────────────────┐
    │            (JSONL persistence)              │
    └──────┬─────────────┬──────────────┬────────┘
           │             │              │
           ▼             ▼              ▼
     preconscious   auto-capture   emergency
     (score+buffer) (→ Qdrant)     (urgent alerts)
           │             │              │
           ▼             ▼              ▼
    ┌────────────────────────────────────────────┐
    │          Session Context Injection          │
    │                                            │
    │  checkpoint + memories + preferences       │
    │  + preconscious buffer + emergency alerts  │
    └────────────────────────────────────────────┘
           │             │              │
           ▼             ▼              ▼
     auto-checkpoint  memory-qdrant  preference-learner
     (state/current)  (vector search) (behavioral scores)
```

**Total overhead per session start: < 500ms** (tested on ARM64 and x86).

## How It Works

**auto-checkpoint** reads your `state/current.md` and injects it as context. Your agent always knows where it left off — even after context compaction. Before compaction, it backs up the current state so nothing is lost.

**memory-qdrant** searches your local Qdrant for semantically relevant memories, matches keywords against a `facts.jsonl` file (verified facts, keyword-searched), and hints at relevant knowledge files based on configurable topic routing.

**auto-capture** runs silently, detecting when conversations contain corrections, decisions, new facts, or lessons. Stores them in Qdrant automatically. User-only capture, SHA256 deduplication, 30+ skip patterns, metadata cleaning.

**preference-learner** detects feedback signals in your conversations — praise, frustration, corrections — and maps them to 6 behavioral dimensions. Over time, your agent adapts *how* it works with you:

```
You: "Dude, stop asking for permission every time — just do it!"
  → Signal: negative (-1.5)
  → Categories: confirmation_seeking → LESS, autonomy → MORE
  → Saved to preferences.json

Next session, agent receives:
  "STRONG preference for LESS confirmation seeking (score: -4.5, 5x reinforced)"
  → Agent stops asking for permission on obvious tasks
```

Six dimensions: **autonomy**, **verbosity**, **proactivity**, **formality**, **technical depth**, **confirmation seeking**. Preferences decay if not reinforced (30-day half-life) — no overreaction to a single comment.

**event-bus** is the nervous system. Any plugin or sensor can emit events with a topic, importance score, and TTL. Events persist as JSONL and auto-prune after 7 days. At session start, the most relevant recent events are injected as context.

**preconscious** watches the event bus and asks: "What's important right now, even if nobody asked?" It scores events by `importance × recency_decay × reinforcement_count` and writes the top 5 as a Markdown buffer (max 500 tokens). Your agent gets ambient awareness without being overwhelmed.

**emergency** watches for critical events (importance ≥ 0.85) and soon-to-expire TTLs. Deduplicates via SHA256, rate-limits to 2 alerts per day, and injects unhandled alerts as priority context. Your agent sees `⚠️ URGENT` before anything else.

## What Makes This Different

### vs. Flat MEMORY.md
MEMORY.md grows until you summarize, losing detail. This project stores everything in Qdrant, recalls only what's relevant, and keeps MEMORY.md as a lightweight index.

### vs. Cloud Memory (Mem0, Zep)
Cloud services send your data elsewhere and none adapt agent behavior. This runs on your machine, learns how you work, AND watches for problems proactively.

### vs. [Total Recall](https://github.com/gavdalf/total-recall)
Total Recall pioneered ambient intelligence for agents. We build on that foundation:

| | Total Recall | This project |
|---|---|---|
| Runtime | Shell (bash + jq + python) | Node.js (OpenClaw plugins) |
| Scheduling | Cron jobs | Runs on every session start |
| Dependencies | jq, python, PyYAML | Node.js stdlib only |
| Testing | Manual | 106 automated tests |
| Integration | Standalone scripts | Native OpenClaw hooks |
| Emergency | Webhook/Telegram | Context injection + dedup |
| Extensibility | Fork scripts | Import + event listeners |

### Production-Proven
- **2,000+ memories** stored and recalled daily
- **4-layer compaction mitigation** (checkpoint backup → auto-checkpoint → compaction-summarizer → context re-injection)
- **Embodied AI tested** — also used with a robot dog for sensor memory
- Running continuously since January 2026 on a Raspberry Pi 5

## Quick Start

> Start with `auto-checkpoint` + `memory-qdrant` — they give you 80% of the value. Add plugins as you need them.

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) 2026.1.30+
- [Qdrant](https://qdrant.tech/) running locally (or Qdrant MCP server)
- [mcporter](https://github.com/steipete/mcporter) with a `qdrant-memory` server configured

### Install

```bash
git clone https://github.com/rockywuest/openclaw-memory-local.git
cd openclaw-memory-local

pip3 install mcp-server-qdrant
mcporter config add qdrant-memory stdio \
  --command "python3 -m mcp_server_qdrant" \
  --args "--qdrant-local-path ~/.openclaw/memory/qdrant-data --collection-name memories"
```

### Configure OpenClaw

**Option A: One-line setup (recommended)**

Add `nox-memory-suite` — one path, one entry, full stack:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/path/to/openclaw-memory-local/auto-checkpoint",
        "/path/to/openclaw-memory-local/memory-qdrant",
        "/path/to/openclaw-memory-local/plugins/nox-memory-suite"
      ]
    },
    "entries": {
      "nox-memory-suite": { "enabled": true }
    }
  }
}
```

The suite auto-loads all 8 plugins in dependency order. Presets:

| Preset | Plugins | Use Case |
|--------|---------|----------|
| `full` (default) | All 8 | Production — everything including cognitive layer |
| `core` | capture, events, preconscious, emergency, preferences | Daily use without cognitive analysis |
| `minimal` | capture, preferences | Lightweight — just learning and fact capture |

Override individual plugins:

```json
{
  "nox-memory-suite": {
    "enabled": true,
    "preset": "core",
    "plugins": { "fademem": true }
  }
}
```

**Option B: Manual setup (pick and choose)**

Add individual plugin paths:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/path/to/openclaw-memory-local/auto-checkpoint",
        "/path/to/openclaw-memory-local/memory-qdrant",
        "/path/to/openclaw-memory-local/plugins/nox-auto-capture",
        "/path/to/openclaw-memory-local/plugins/nox-preference-learner",
        "/path/to/openclaw-memory-local/plugins/nox-event-bus",
        "/path/to/openclaw-memory-local/plugins/nox-preconscious",
        "/path/to/openclaw-memory-local/plugins/nox-emergency",
        "/path/to/openclaw-memory-local/plugins/nox-fademem",
        "/path/to/openclaw-memory-local/plugins/nox-cooccurrence",
        "/path/to/openclaw-memory-local/plugins/nox-fingerprint"
      ]
    }
  }
}
```

Then:

```bash
openclaw gateway restart
```

That's it. Your agent now has memory, behavioral adaptation, and ambient intelligence.

## Troubleshooting

### memory_search returns empty results

OpenClaw's built-in `memory_search` uses a **separate embedding provider** (OpenAI, Gemini, etc.) — independent of these plugins. If `memory_search` returns empty:

1. Check provider config: `openclaw memory status`
2. Common causes: API key expired, rate limit during reindex, provider switch without reindex
3. Verify plugins work independently: `mcporter call qdrant-memory.qdrant-find query="test"`

> These plugins use mcporter → Qdrant (local embeddings). OpenClaw's `memory_search` uses a cloud embedding provider. They are independent systems.

### Monitoring

```bash
bash scripts/memory-health.sh
```

Checks 7 subsystems: Qdrant access, mcporter find/store, embedding cache, sync cron, memory files, provider config. Exit 0 = healthy. Run it in your agent's heartbeat loop.

## Privacy

- **Zero cloud dependency.** Qdrant runs locally. Nothing leaves your machine.
- **No telemetry.** No analytics. No tracking.
- **Your data, your disk.** Delete the Qdrant directory, delete the memories.

## Development

```bash
npm test    # 184 tests, zero external deps
```

Each plugin includes an [agentskills.io](https://agentskills.io)-compliant `SKILL.md`.

## Roadmap

- [x] Semantic recall via Qdrant
- [x] Automatic fact/decision capture
- [x] Behavioral preference learning
- [x] Ambient Intelligence Engine (event bus, preconscious buffer, emergency surface)
- [x] FadeMem: access-weighted decay
- [x] Co-occurrence tracking (Hebbian links)
- [x] Cognitive fingerprint (topology hash)
- [x] Sensor connectors (file watchers, system monitoring)
- [x] Meta-plugin (`nox-memory-suite`) — one-line activation with presets
- [ ] ClawhHub listing

## License

MIT — use it, fork it, improve it.

---

**Contributors:** [Rocky Wüst](https://github.com/rockywuest) (creator), Nox ⚡ (architecture + implementation), Claude (Anthropic)

*Running 24/7 since January 2026. Part of the [Sentinel Agent](https://rotomi.de/sentinel-agent.html) ecosystem.*
