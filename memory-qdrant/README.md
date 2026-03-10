# Memory Qdrant

Semantic memory recall for AI agents using a local Qdrant vector database. Searches past conversations, matches facts, and routes to knowledge files — all without leaving your machine.

## Features

- **Semantic Search** — vector similarity search via Qdrant + mcporter
- **Facts Matching** — keyword search against `facts.jsonl` for verified facts
- **Knowledge Routing** — maps queries to domain-specific knowledge files
- **Privacy-First** — everything runs locally

## Quick Start

1. Set up Qdrant locally:

```bash
pip3 install mcp-server-qdrant
python3 -m mcp_server_qdrant \
  --qdrant-local-path ~/.openclaw/memory/qdrant-data \
  --collection-name memories
```

2. Configure mcporter with a `qdrant-memory` server.

3. Add to your `openclaw.json`:

```json
{
  "plugins": [{
    "id": "memory-qdrant",
    "enabled": true,
    "config": {
      "serverName": "qdrant-memory",
      "factsFile": "memory/facts.jsonl",
      "qdrantLimit": 5
    }
  }]
}
```

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `serverName` | `qdrant-memory` | mcporter server name |
| `factsFile` | — | Path to facts.jsonl |
| `qdrantLimit` | 5 | Max search results |
| `knowledgeMap` | `{}` | Keyword → file mapping |

## License

MIT — see [LICENSE](../LICENSE)
