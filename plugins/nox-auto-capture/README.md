# Auto-Capture

Passive learning for AI agents. Automatically captures corrections, decisions, facts, and lessons from conversations and stores them in a local Qdrant vector database.

## Features

- **Signal Detection** — identifies corrections, decisions, facts, and lessons
- **Noise Filtering** — 30+ skip patterns filter system noise
- **Deduplication** — SHA256 content hashing prevents duplicates
- **Content Cleaning** — strips metadata envelopes before storage
- **User-Only** — captures human messages only (v2.0)

## Quick Start

1. Ensure Qdrant and mcporter are configured (see [memory-qdrant](../../memory-qdrant/README.md)).

2. Add to your `openclaw.json`:

```json
{
  "plugins": [{
    "id": "nox-auto-capture",
    "enabled": true
  }]
}
```

3. The plugin silently captures important information from your conversations.

## What Gets Captured

| Signal | Example |
|--------|---------|
| Correction | "No, the meeting is Thursday not Wednesday" |
| Decision | "Let's go with option B" |
| New fact | "The API key expires in March" |
| Lesson | "Last time we forgot to backup first" |
| Preference | "Always use bullet points" |

## What Gets Skipped

- Briefings, digests, system status updates
- Shell outputs and exec results
- Memory operations (sync, hygiene)
- Cron triggers and heartbeat messages
- Messages shorter than ~20 characters

## Production Stats

Battle-tested on a Raspberry Pi 5 (24/7 since Jan 2026):
- 2,284 clean memories after hygiene
- 7.1% junk rate caught by v2.0 filters
- 0 duplicates since SHA256 dedup

## License

MIT — see [LICENSE](../../LICENSE)
