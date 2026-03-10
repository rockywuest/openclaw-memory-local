---
name: nox-auto-capture
description: >
  Automatically captures corrections, decisions, facts, and lessons from agent
  conversations and stores them in a local Qdrant vector database. Filters system
  noise with 30+ skip patterns, deduplicates via SHA256, and only captures user
  messages. Use when building agents that should learn from conversations without
  manual memory management.
license: MIT
compatibility: OpenClaw 2026.1.30+, Node.js >= 20, Qdrant (local), mcporter CLI
metadata:
  author: rotomi
  version: "2.0.0"
  platform: openclaw-plugin
---

# Auto-Capture — Passive Learning for AI Agents

Silently watches conversations and stores the important parts — corrections, decisions, new facts, lessons learned — in your local Qdrant database. Your agent builds memory automatically.

## What It Does

1. **Signal Detection** — identifies user messages containing corrections, decisions, facts, or lessons worth remembering
2. **Noise Filtering** — 30+ skip patterns automatically ignore briefings, system events, exec outputs, and technical noise
3. **Deduplication** — SHA256 content hashing prevents storing the same information twice
4. **Content Cleaning** — strips metadata envelopes, markdown headers, and formatting artifacts before storage
5. **User-Only Capture** — only stores human messages (v2.0), not assistant responses or system messages

## Configuration

In your `openclaw.json` plugins section:

```json
{
  "id": "nox-auto-capture",
  "enabled": true,
  "config": {}
}
```

Currently uses sensible defaults. Future versions will expose:
- Custom skip patterns
- Capture sensitivity threshold
- Storage collection name
- Maximum capture rate

## What Gets Captured

| Signal | Example | Stored As |
|--------|---------|-----------|
| Correction | "No, the meeting is Thursday not Wednesday" | Fact correction |
| Decision | "Let's go with option B" | Decision record |
| New fact | "The API key expires in March" | Factual memory |
| Lesson | "Last time we forgot to backup first" | Lesson learned |
| Preference | "Always use bullet points for summaries" | User preference |

## What Gets Skipped

- Morning/evening briefings and digests
- System status updates and health checks
- Shell command outputs and exec results
- Memory operations (sync, hygiene, search results)
- Cron triggers and heartbeat messages
- Git operations and CI/CD notifications
- Messages shorter than ~20 characters

## Architecture

```
User sends message
    │
    ▼
auto-capture intercepts (before_agent_start hook)
    │
    ├── Skip pattern match? → SKIP
    ├── System/assistant message? → SKIP
    ├── SHA256 duplicate? → SKIP (logged)
    ├── Too short / no signal? → SKIP
    │
    ▼
Clean content (strip metadata, normalize)
    │
    ▼
Store in Qdrant (via mcporter) with metadata:
  - timestamp, source: "auto-capture"
  - content hash for dedup
```

## Production Stats

Battle-tested on a Raspberry Pi 5 running 24/7:
- **2,284 clean memories** after hygiene (started at 2,488)
- **7.1% junk rate** caught and removed by v2.0 filters
- **0 duplicates** since SHA256 dedup was added

## Edge Cases

- **Qdrant unavailable** — capture silently skipped, no session impact
- **mcporter timeout** — logged and skipped (5s default)
- **Rapid messages** — internal cooldown prevents burst-storing
- **Very long messages** — truncated to fit embedding model limits

## References

- See [index.js](index.js) for the implementation (280 LOC)
- See [openclaw.plugin.json](openclaw.plugin.json) for the plugin manifest
- Tests: [../../test/auto-capture.test.js](../../test/auto-capture.test.js) (20 tests)
