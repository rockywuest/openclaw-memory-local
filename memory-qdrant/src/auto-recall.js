'use strict';
/**
 * Auto-recall: inject relevant Qdrant memories into session context.
 *
 * Searches both Qdrant (semantic) and an optional facts.jsonl file (keyword).
 * Optionally provides knowledge-file routing hints based on keyword matching.
 */

const { searchMemories, isHealthy } = require('./qdrant-client.js');
const fs = require('fs');
const path = require('path');

// ── Stop words (multilingual: English + German) ─────────────────

const STOP_WORDS = new Set([
  'und',
  'oder',
  'der',
  'die',
  'das',
  'ein',
  'eine',
  'ist',
  'sind',
  'was',
  'wie',
  'wo',
  'wer',
  'the',
  'is',
  'are',
  'what',
  'how',
  'ich',
  'du',
  'wir',
  'mir',
  'mich',
  'dir',
  'kannst',
  'bitte',
  'mal',
  'noch',
  'auch',
  'schon',
  'gibt',
  'hat',
  'haben',
  'machen',
  'soll',
  'kann',
  'will',
  'denn',
  'aber',
  'wenn',
  'dann',
  'den',
  'dem',
  'des',
  'von',
  'mit',
  'für',
  'auf',
  'aus',
  'bei',
  'nach',
  'über',
  'unter',
  'vor',
  'seit',
  'this',
  'that',
  'with',
  'from',
  'have',
  'been',
  'would',
  'could',
  'should',
  'will',
  'just',
  'about',
  'some',
  'into',
  'than',
  'then',
  'here',
  'there',
  'when',
  'where',
  'which',
  'their',
  'them',
  'these',
  'nicht',
  'kein',
  'keine',
  'einem',
  'einer',
  'einen',
  'habe',
  'hast',
  'wäre',
  'würde',
  'könnte',
  'müsste',
  'doch',
  'eben',
  'gerade'
]);

// ── Helpers ──────────────────────────────────────────────────────

function extractKeywords(message) {
  const words = message
    .toLowerCase()
    .replace(/[^\w\sÄäÖöÜüßé]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 8).join(' ');
}

function searchFacts(factsFile, query) {
  try {
    if (!factsFile || !fs.existsSync(factsFile)) return [];
    const facts = fs.readFileSync(factsFile, 'utf-8');
    const lines = facts.split('\n').filter(l => l.trim());
    const queryWords = query
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));

    if (queryWords.length === 0) return [];

    return lines
      .map(l => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter(f => {
        const factLower = (f.fact || '').toLowerCase();
        const keyLower = (f.key || '').toLowerCase();
        return queryWords.some(w => factLower.includes(w) || keyLower.includes(w));
      })
      .slice(0, 3)
      .map(f => `⚡ [${f.date}] ${f.fact}`);
  } catch (err) {
    console.error('[memory-qdrant] facts.jsonl error:', err.message);
    return [];
  }
}

function findKnowledgeHints(query, knowledgeMap) {
  if (!knowledgeMap || Object.keys(knowledgeMap).length === 0) return [];
  const queryLower = query.toLowerCase();
  const hints = new Set();
  for (const [keyword, file] of Object.entries(knowledgeMap)) {
    if (queryLower.includes(keyword)) hints.add(file);
  }
  return [...hints].slice(0, 2);
}

function extractUserQuery(content) {
  let text = null;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (part && part.type === 'text' && part.text) {
        text = part.text;
        break;
      }
    }
  }
  if (!text) return null;

  // Skip injected context blocks
  if (text.includes('DRIFT-MEMORY') || text.includes('QDRANT MEMORY') || text.startsWith('##')) {
    const parts = text.split(/\n---\n?/);
    for (let i = parts.length - 1; i >= 0; i--) {
      const part = parts[i].trim();
      if (!part) continue;
      if (
        part.startsWith('##') ||
        part.startsWith('*') ||
        part.includes('DRIFT-MEMORY') ||
        part.includes('QDRANT MEMORY') ||
        part.includes('VERIFIED FACTS') ||
        part.includes('LETZTER CHECKPOINT') ||
        part.includes('KNOWLEDGE HINT')
      )
        continue;
      if (part.length > 3) return part;
    }
    return null;
  }
  return text;
}

function extractUserMessage(event) {
  if (!event.messages || !Array.isArray(event.messages)) return null;
  for (let i = event.messages.length - 1; i >= 0; i--) {
    const msg = event.messages[i];
    if (msg && msg.role === 'user') {
      const query = extractUserQuery(msg.content);
      if (query && query.length > 3) {
        const metaMatch = query.match(/^\[\w+ .*?\] (.*)$/s);
        return metaMatch ? metaMatch[1] : query;
      }
    }
  }
  return null;
}

// ── Main Hook ────────────────────────────────────────────────────

async function createBeforeAgentStart(config) {
  const factsFile = config?.factsFile || null;
  const knowledgeMap = config?.knowledgeMap || {};
  const qdrantLimit = config?.qdrantLimit || 5;

  return async function beforeAgentStart(event, ctx) {
    const userMessage = extractUserMessage(event);
    if (!userMessage || userMessage.length < 5) return undefined;

    const skipPatterns = [/^(hi|hey|hallo|moin|ok|ja|nein|danke|thanks|NO_REPLY)$/i, /^HEARTBEAT/i];
    if (skipPatterns.some(p => p.test(userMessage.trim()))) return undefined;

    const keywords = extractKeywords(userMessage);
    const searchQuery = keywords.length > 0 ? keywords : userMessage.substring(0, 200);

    const sections = [];

    // 1. Search facts.jsonl (fast, local)
    const facts = searchFacts(factsFile, userMessage);
    if (facts.length > 0) {
      sections.push(`## VERIFIED FACTS\n${facts.join('\n')}`);
    }

    // 2. Search Qdrant (semantic)
    const healthy = await isHealthy();
    if (healthy) {
      try {
        const memories = await searchMemories(searchQuery, qdrantLimit);
        if (memories.length > 0) {
          const memoryText = memories
            .map((m, i) => {
              const score = typeof m.score === 'number' ? `[${(m.score * 100).toFixed(0)}%]` : '';
              return `${i + 1}. ${score} ${m.content}`;
            })
            .join('\n\n');
          sections.push(`## QDRANT MEMORY\n\n${memoryText}`);
        }
      } catch (error) {
        console.error('[memory-qdrant] Qdrant error:', error.message);
      }
    }

    // 3. Knowledge file hints
    const knowledgeHints = findKnowledgeHints(userMessage, knowledgeMap);
    if (knowledgeHints.length > 0) {
      sections.push(knowledgeHints.map(f => `💡 Relevant knowledge file: ${f}`).join('\n'));
    }

    if (sections.length === 0) return undefined;
    return { prependContext: sections.join('\n\n') + '\n\n---' };
  };
}

async function getMemoryStatus() {
  return (await isHealthy()) ? 'Qdrant: healthy' : 'Qdrant: unavailable';
}

module.exports = { createBeforeAgentStart, getMemoryStatus };
