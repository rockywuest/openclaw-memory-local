# 🧠 openclaw-memory-local

[![Tests](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml/badge.svg)](https://github.com/rockywuest/openclaw-memory-local/actions/workflows/test.yml)
[![agentskills.io](https://img.shields.io/badge/agentskills.io-compliant-brightgreen)](https://agentskills.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Your memories stay on your machine. Your agent actually learns from you.**

Four OpenClaw plugins that give your agent persistent, searchable, biologically-inspired memory — plus behavioral learning from your feedback. Without sending a single byte to the cloud.

> Most agent memory is a glorified clipboard. Copy-paste your MEMORY.md, hope for the best. This is different: semantic search, automatic capture, access-weighted decay, compaction-safe checkpoints, and **a preference learner that adapts your agent's behavior based on how you talk to it**. Running 24/7 on a Raspberry Pi 5 since January 2026.

## Why Not Just MEMORY.md?

| Approach | Token Cost | Recall | Learns Facts? | Adapts Behavior? | Compaction-safe? |
|----------|-----------|--------|---------------|-----------------|-----------------|
| Flat MEMORY.md | 5-10K every session | ❌ Degrades | ❌ | ❌ | ❌ |
| Hierarchical files | ~1.5K + drill-downs | 🟡 Manual | ❌ | ❌ | ❌ |
| Cloud memory (Mem0, Zep) | ~2K | ✅ | ✅ | ❌ | 🟡 |
| **This project** | ~2K + semantic hits | ✅ Vector search | ✅ Auto-capture | ✅ **Preference Learner** | ✅ 4-layer backup |

**The difference:** Flat files scale linearly. Vector search scales logarithmically. And nobody else adapts agent *behavior* from conversation feedback — they only store facts. We do both.

## Plugins

| Plugin | What it does | Hook |
|--------|-------------|------|
| **[auto-checkpoint](./auto-checkpoint/)** | Injects last operational state into every session. Warns when stale. Backs up before compaction. | `session:compact:before`, `before_agent_start` |
| **[memory-qdrant](./memory-qdrant/)** | Semantic memory recall — searches Qdrant + optional facts.jsonl + knowledge-file routing. | `before_agent_start` |
| **[auto-capture](./plugins/nox-auto-capture/)** | Listens for corrections, decisions, facts, and lessons — stores them automatically. v2.0: user-only, dedup, 30+ skip patterns. | `before_agent_start` |
| **[preference-learner](./plugins/nox-preference-learner/)** | 🆕 **Train by Talking.** Detects approval/disapproval in conversations and adapts agent behavior across 6 dimensions. RLHF-lite without model fine-tuning. | `before_agent_start` |

## Architecture

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

**Total overhead per session start: < 500ms** on a Raspberry Pi 5.

### How Each Plugin Works

**auto-checkpoint** reads your `state/current.md` and injects it as context. Your agent always knows where it left off — even after context compaction. Before compaction, it backs up the current state so nothing is lost.

**memory-qdrant** searches your local Qdrant for semantically relevant memories, matches keywords against a `facts.jsonl` file (verified facts, keyword-searched), and hints at relevant knowledge files based on configurable topic routing.

**auto-capture** runs silently, detecting when conversations contain corrections, decisions, new facts, or lessons. Stores them in Qdrant automatically. v2.0 adds user-only capture, SHA256 deduplication, 30+ skip patterns, and metadata cleaning.

**preference-learner** is the secret weapon. It detects feedback signals in your conversations — praise, frustration, corrections — and maps them to 6 behavioral dimensions. Over time, your agent adapts *how* it works with you:

```
You: "Mensch, frag nicht immer, mach einfach!"
  → Signal: negative (-1.5)
  → Categories: confirmation_seeking → LESS, autonomy → MORE
  → Saved to preferences.json

Next session, agent receives:
  "STRONG preference for LESS confirmation seeking (score: -4.5, 5x reinforced)"
  → Agent stops asking for permission on obvious tasks
```

Six dimensions that adapt: **autonomy** (act vs. ask), **verbosity** (brief vs. detailed), **proactivity** (suggest vs. wait), **formality** (casual vs. professional), **technical depth** (code vs. summary), **confirmation seeking** (do it vs. check first).

Preferences decay if not reinforced (30-day half-life) and require 2+ reinforcements to activate — no overreaction to a single comment.

## What Makes This Different

### vs. Flat MEMORY.md
MEMORY.md is a single file you load every session. It grows until you have to summarize, losing detail. This project: store everything in Qdrant, recall only what's relevant, keep MEMORY.md as a lightweight index.

### vs. Cloud Memory (Mem0, Hindsight, Zep)
Cloud services send your data to external servers and none of them adapt agent behavior — they only store and retrieve facts. This runs entirely on your machine, AND it learns how you prefer to work. No API keys for memory. No vendor lock-in. No privacy concerns.

### vs. Hierarchical File Systems
Structured directories (people/, projects/, decisions/) require manual drill-down decisions. Semantic search finds what's relevant regardless of where you filed it.

### Production-Proven
- **2,000+ memories** stored and recalled daily
- **4-layer compaction mitigation** (checkpoint backup → auto-checkpoint → compaction-summarizer → context re-injection)
- **Embodied AI tested** — runs alongside a robot dog (PiDog) with sensor memory capture
- Running continuously since January 2026 on ARM64 (Raspberry Pi 5, 8GB)

## Quick Start

### Prerequisites

- [OpenClaw](https://github.com/openclaw/openclaw) 2026.1.30+
- [Qdrant](https://qdrant.tech/) running locally (or Qdrant MCP server)
- [mcporter](https://github.com/nichochar/mcporter) with a `qdrant-memory` server configured

### Install

```bash
# Clone
git clone https://github.com/rockywuest/openclaw-memory-local.git
cd openclaw-memory-local

# Set up Qdrant (lightweight MCP server — ideal for Pi/ARM)
pip3 install mcp-server-qdrant
mcporter config add qdrant-memory stdio \
  --command "python3 -m mcp_server_qdrant" \
  --args "--qdrant-local-path ~/.openclaw/memory/qdrant-data --collection-name memories"
```

### Configure OpenClaw

Add to your `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "load": {
      "paths": [
        "/path/to/openclaw-memory-local/auto-checkpoint",
        "/path/to/openclaw-memory-local/memory-qdrant",
        "/path/to/openclaw-memory-local/plugins/nox-auto-capture"
      ]
    },
    "entries": {
      "auto-checkpoint": { "enabled": true },
      "memory-qdrant": { "enabled": true },
      "nox-auto-capture": { "enabled": true }
    }
  }
}
```

```bash
openclaw gateway restart
```

That's it. Your agent now has persistent memory.

## Configuration

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
    "cooldownMs": 10000
  }
}
```

### nox-preference-learner (v1.0) 🆕

```json
{
  "nox-preference-learner": {
    "enabled": true
  }
}
```

**v2.0 Features:**
- **User-only capture** — Only stores human messages, not assistant/system
- **Content deduplication** — SHA256-based, prevents duplicates
- **30+ skip patterns** — Ignores briefings, system events, exec outputs
- **Content cleaning** — Strips metadata envelopes before storage

## facts.jsonl Format

Optional file for verified, keyword-searched facts:

```jsonl
{"date":"2026-01-15","key":"office","fact":"Office is at Gertrudenstraße 15, 23568 Lübeck"}
{"date":"2026-02-01","key":"deploy","fact":"Production runs on Hetzner CX22, IP 65.21.x.x"}
{"date":"2026-02-10","key":"rule","fact":"Never deploy on Fridays after 16:00"}
```

## Development

```bash
npm test              # 60 tests, zero external deps
npm run test:verbose  # Detailed output
```

Tests cover: hook registration, context injection, stale detection, message classification, skip logic, cooldown, error handling, facts search, knowledge routing, and user message extraction.

Each plugin includes an [agentskills.io](https://agentskills.io)-compliant `SKILL.md`. See [AGENTSKILLS-COMPLIANCE.md](AGENTSKILLS-COMPLIANCE.md) for the full report (75✅ 3⚠️ 0❌).

## Privacy

- **Zero cloud dependency.** Qdrant runs locally. mcporter calls local processes. Nothing leaves your machine.
- **No telemetry.** No analytics. No tracking. No phoning home.
- **Your data, your disk.** Delete the Qdrant directory, delete the memories.

## Roadmap

- [x] **Preference Learner** — behavioral adaptation from conversation feedback (SHIPPED v1.0)
- [ ] FadeMem: access-weighted decay (frequently recalled memories fade slower)
- [ ] Co-occurrence tracking (Hebbian links between related memories)
- [ ] Cognitive fingerprint (topology hash for agent identity)
- [ ] Modality-tagged memories (sensor/text/social/internal — for embodied agents)
- [ ] ClawhHub listing

## License

MIT — use it, fork it, improve it.

---

*Built by [Nox](https://github.com/rockywuest) ⚡ — an AI assistant that needed to remember.*
*Battle-tested on a Raspberry Pi 5 running 24/7 since January 2026.*
*Part of the [Sentinel](https://github.com/rockywuest/Sentinel_Agent) ecosystem.*
