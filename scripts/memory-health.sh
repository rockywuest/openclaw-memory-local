#!/bin/bash
# memory-health.sh — Health check for openclaw-memory-local systems
# Run standalone or integrate into your agent's heartbeat loop.
# Exit 0 = healthy, Exit 1 = problem(s) found.
#
# Checks:
#   1. Qdrant direct access (qdrant-client)
#   2. mcporter → qdrant-find
#   3. mcporter → qdrant-store
#   4. OpenClaw embedding cache freshness
#   5. Qdrant sync cron (if installed)
#   6. Memory file integrity
#   7. Provider config
#
# Customize QDRANT_DATA_PATH and OPENCLAW_DB_PATH for your setup.

set -euo pipefail

QDRANT_DATA_PATH="${QDRANT_DATA_PATH:-$HOME/.openclaw/memory/qdrant-data}"
OPENCLAW_DB_PATH="${OPENCLAW_DB_PATH:-$HOME/.openclaw/memory/main.sqlite}"
WORKSPACE="${WORKSPACE:-$(pwd)}"
PROBLEMS=0

echo "🧠 Memory Health Check — $(date '+%Y-%m-%d %H:%M')"
echo "================================================"

# 1. Qdrant direct access
echo ""
echo "1️⃣  Qdrant (direct access):"
if QDRANT_OUT=$(python3 -c "
from qdrant_client import QdrantClient
client = QdrantClient(path='$QDRANT_DATA_PATH')
for c in client.get_collections().collections:
    info = client.get_collection(c.name)
    print(f'  {c.name}: {info.points_count} points')
" 2>/dev/null); then
    echo "$QDRANT_OUT"
    echo "  ✅ Qdrant accessible"
else
    echo "  ❌ Qdrant NOT accessible (path: $QDRANT_DATA_PATH)"
    PROBLEMS=$((PROBLEMS+1))
fi

# 2. mcporter → qdrant-find
echo ""
echo "2️⃣  mcporter → Qdrant MCP (find):"
if FIND_OUT=$(timeout 15 mcporter call qdrant-memory.qdrant-find query="health check" 2>&1) && echo "$FIND_OUT" | grep -q "entry\|content\|Results"; then
    echo "  ✅ mcporter qdrant-find works"
else
    echo "  ❌ mcporter qdrant-find FAILED"
    echo "  Output: $(echo "${FIND_OUT:-empty}" | head -3)"
    PROBLEMS=$((PROBLEMS+1))
fi

# 3. mcporter → qdrant-store
echo ""
echo "3️⃣  mcporter → Qdrant MCP (store):"
if STORE_OUT=$(timeout 15 mcporter call qdrant-memory.qdrant-store information="health-check-ping $(date -Iseconds)" 2>&1) && echo "$STORE_OUT" | grep -qi "remembered\|stored\|success"; then
    echo "  ✅ mcporter qdrant-store works"
else
    echo "  ❌ mcporter qdrant-store FAILED"
    echo "  Output: $(echo "${STORE_OUT:-empty}" | head -3)"
    PROBLEMS=$((PROBLEMS+1))
fi

# 4. OpenClaw embedding cache freshness
echo ""
echo "4️⃣  OpenClaw Embedding Cache:"
if [ -f "$OPENCLAW_DB_PATH" ]; then
    CACHE_STATUS=$(python3 -c "
import sqlite3
from datetime import datetime
db = sqlite3.connect('$OPENCLAW_DB_PATH')
try:
    last_ts = db.execute('SELECT MAX(updated_at) FROM embedding_cache').fetchone()[0]
    count = db.execute('SELECT COUNT(*) FROM embedding_cache').fetchone()[0]
    chunks = db.execute('SELECT COUNT(*) FROM chunks').fetchone()[0]
    if last_ts:
        last_dt = datetime.fromtimestamp(last_ts / 1000)
        age_hours = (datetime.now() - last_dt).total_seconds() / 3600
        print(f'  Last embedding: {last_dt.strftime(\"%Y-%m-%d %H:%M\")} ({age_hours:.1f}h ago)')
        print(f'  Cache: {count} embeddings, {chunks} chunks')
        if age_hours > 24:
            print('  ⚠️  STALE: Last embedding >24h ago!')
            exit(1)
        else:
            print('  ✅ Embedding cache fresh')
    else:
        print('  ❌ NO embeddings in cache!')
        exit(1)
except Exception as e:
    print(f'  ❌ DB error: {e}')
    exit(1)
" 2>&1) || PROBLEMS=$((PROBLEMS+1))
    echo "$CACHE_STATUS"
else
    echo "  ⚠️  DB not found at $OPENCLAW_DB_PATH (skipped)"
fi

# 5. Qdrant sync cron
echo ""
echo "5️⃣  Qdrant Sync Cron:"
if crontab -l 2>/dev/null | grep -q "qdrant-sync"; then
    echo "  ✅ Sync cron installed"
else
    echo "  ℹ️  No qdrant-sync cron found (optional)"
fi

# 6. Memory file integrity
echo ""
echo "6️⃣  Memory Files:"
if [ -f "$WORKSPACE/MEMORY.md" ]; then
    MEMORY_LINES=$(wc -l < "$WORKSPACE/MEMORY.md")
    echo "  MEMORY.md: ${MEMORY_LINES} lines"
else
    echo "  ⚠️  No MEMORY.md found in $WORKSPACE"
fi
DAILY=$(find "$WORKSPACE/memory" -name "*.md" -not -path "*/knowledge/*" 2>/dev/null | wc -l)
KNOWLEDGE=$(find "$WORKSPACE/memory/knowledge" -name "*.md" 2>/dev/null | wc -l)
echo "  Daily notes: ${DAILY} files"
echo "  Knowledge: ${KNOWLEDGE} files"

# 7. Provider config
echo ""
echo "7️⃣  Config:"
if [ -f "$HOME/.openclaw/openclaw.json" ]; then
    python3 -c "
import json
c = json.load(open('$HOME/.openclaw/openclaw.json'))
ms = c.get('agents',{}).get('defaults',{}).get('memorySearch',{})
print(f\"  Provider: {ms.get('provider', 'NOT SET')}\")
print(f\"  Model: {ms.get('model', 'default')}\")
print(f\"  Fallback: {ms.get('fallback', 'NOT SET')}\")
" 2>&1
else
    echo "  ⚠️  openclaw.json not found (skipped)"
fi

# Summary
echo ""
echo "================================================"
if [ "$PROBLEMS" -eq 0 ]; then
    echo "✅ All memory systems healthy"
else
    echo "❌ $PROBLEMS problem(s) found!"
fi
exit "$PROBLEMS"
