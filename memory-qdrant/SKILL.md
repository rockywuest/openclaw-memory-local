---
name: memory-qdrant
description: >
  Semantic memory recall for AI agents using a local Qdrant vector database.
  Searches past conversations, matches keywords against a facts file, and routes
  queries to relevant knowledge files. Use when building agents that need long-term
  memory, fact verification, or domain-specific knowledge retrieval — all without
  sending data to the cloud.
license: MIT
compatibility: OpenClaw 2026.1.30+, Node.js >= 20, Qdrant (local), mcporter CLI
metadata:
  author: rotomi
  version: "2.0.0"
  platform: openclaw-plugin
---

# Memory Qdrant — Semantic Recall for AI Agents

Gives your agent a searchable long-term memory backed by a local Qdrant vector database. No cloud, no API keys for storage — your memories stay on your machine.

## What It Does

1. **Semantic Search** — finds relevant past conversations using vector similarity (via Qdrant + mcporter)
2. **Facts Matching** — searches a `facts.jsonl` file for keyword matches (exact facts that override fuzzy recall)
3. **Knowledge Routing** — maps query keywords to domain-specific knowledge files and hints the agent to read them
4. **Privacy-First** — everything runs locally, no data leaves your machine

## Configuration

In your `openclaw.json` plugins section:

```json
{
  "id": "memory-qdrant",
  "enabled": true,
  "config": {
    "serverName": "qdrant-memory",
    "factsFile": "/home/user/workspace/memory/facts.jsonl",
    "qdrantLimit": 5,
    "knowledgeMap": {
      "project": "memory/knowledge/projekte.md",
      "finance": "memory/knowledge/buchhaltung.md",
      "infra": "memory/knowledge/infrastruktur.md"
    }
  }
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `serverName` | `qdrant-memory` | mcporter server name for Qdrant |
| `factsFile` | — | Path to facts.jsonl (one JSON object per line) |
| `qdrantLimit` | 5 | Max number of semantic search results |
| `knowledgeMap` | `{}` | Keyword → knowledge file mapping |

## Architecture

```
User message arrives
    │
    ▼
memory-qdrant extracts query from message
    │
    ├──→ Qdrant (via mcporter) → top-N semantic matches
    ├──→ facts.jsonl → keyword grep → exact facts
    └──→ knowledgeMap → keyword match → file hints
    │
    ▼
Agent gets: "ERINNERUNG: [memories + facts + hints]"
```

## Facts File Format

`facts.jsonl` contains one JSON object per line — human-verified facts that override fuzzy memory:

```jsonl
{"fact": "PiDog battery shows 6.5V — this is a hardware problem, NOT software", "date": "2026-02-15", "source": "Rocky"}
{"fact": "OpenRouter is deactivated since Feb 2026", "date": "2026-02-10", "source": "Rocky"}
```

## Knowledge Routing

The `knowledgeMap` maps keywords in the user's message to knowledge files. When a match is found, the agent receives a hint like:

```
📚 Relevante Knowledge-Datei: memory/knowledge/buchhaltung.md
```

This uses progressive disclosure — the agent decides whether to read the full file.

## Edge Cases

- **Qdrant unavailable** — graceful degradation, falls back to facts + knowledge hints only
- **Empty query** — skipped, no search performed
- **No matches** — no memory section injected (clean context)
- **mcporter timeout** — 5s default, logged and skipped

## References

- See [src/](src/) for the implementation (index.js, auto-recall.js, qdrant-client.js)
- See [openclaw.plugin.json](openclaw.plugin.json) for the plugin manifest
- Tests: [../test/memory-qdrant.test.js](../test/memory-qdrant.test.js) (20 tests)
