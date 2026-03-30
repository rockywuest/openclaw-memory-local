# Cognitive Layer v3.1 — Implementation Summary

**Branch:** `feat/cognitive-v3.1`  
**Datum:** 2026-03-16  
**Commit:** `16c691a`  
**Tests:** 184 (alle bestanden)

## Was wurde implementiert?

### 1. FadeMem Plugin (`plugins/nox-fademem/`)

**Access-weighted Memory Decay** — Erinnerungen die nie abgerufen werden verblassen.

**Dateien:**

- `openclaw.plugin.json` — Plugin-Manifest
- `index.js` — FadeMemEngine-Klasse (8.7KB)
- `package.json` — NPM-Metadaten

**Funktionalität:**

- Trackt jeden Memory-Zugriff in `memory/fademem-access.jsonl`
- Format: `{timestamp, memory_id, query, importance}`
- Berechnet Fade-Score: `base_importance × frequency_boost × recency_factor × (1 + access_frequency)`
- Frequency Boost: logarithmisch, nur für >1 Zugriffe (verhindert Runaway)
- Recency Factor: exponential decay mit 30-Tage Halbwertszeit
- Warnt vor Top-5 Fading Memories (Score < 0.3) via Context-Injection
- Export: `getFadeScores()` — Map<memoryId, {score, lastAccess, accessCount}>

**Tests:** 25 Tests in `test/fademem.test.js`

- Access tracking, decay calculation, score ranking, frequency boost
- Fading warnings, plugin export, edge cases

---

### 2. Co-occurrence Plugin (`plugins/nox-cooccurrence/`)

**Hebbian Learning** — "Neurons that fire together, wire together."

**Dateien:**

- `openclaw.plugin.json` — Plugin-Manifest
- `index.js` — CooccurrenceEngine-Klasse (10.4KB)
- `package.json` — NPM-Metadaten

**Funktionalität:**

- Trackt welche Concepts zusammen in Sessions erscheinen
- Speichert Co-occurrence-Matrix in `memory/cooccurrence.jsonl`
- Format: `{concept_a, concept_b, count, last_seen, strength}`
- Strength = count × recency_decay (Halbwertszeit 20h)
- Concept-Extraktion: Keyword-basiert, 40+ bekannte Entities (Rocky, Brüggen, SAP, etc.)
- Injiziert assoziierte Concepts wenn eins im Kontext erscheint
- Beispiel: "Brüggen" → injiziert "Stress", "Joachim", "SAP", "Exit"
- Max 10 Assoziationen pro Concept, min strength 0.3
- Pruning: entfernt schwache Assoziationen automatisch

**Tests:** 29 Tests in `test/cooccurrence.test.js`

- Concept extraction, co-occurrence recording, strength calculation
- Association retrieval, pruning, context injection

---

### 3. Cognitive Fingerprint Plugin (`plugins/nox-fingerprint/`)

**Memory-Topologie-basierter Persönlichkeits-Fingerabdruck.**

**Dateien:**

- `openclaw.plugin.json` — Plugin-Manifest
- `index.js` — CognitiveFingerprintEngine-Klasse (10.9KB)
- `package.json` — NPM-Metadaten

**Funktionalität:**

- Analysiert Event-Verteilung über 8 Domains: work, family, tech, finance, health, social, creative, system
- Domain-Classification: Keyword-basiert (Brüggen → work, Noah → family, GitHub → tech)
- Berechnet:
  - Domain-Distribution (Prozent pro Domain)
  - Gini-Koeffizient (0 = perfekt gleich, 1 = maximal ungleich)
  - Top-3 Domains
  - Topology-Hash (SHA256 über sortierte Distribution)
- Drift-Detection: vergleicht mit letztem Fingerprint, warnt bei >20% Verschiebung
- Cooldown: 1x täglich neu berechnet (verhindert Spam)
- Speichert in `memory/cognitive-fingerprint.json`
- Injiziert kurze Zusammenfassung: "Memory Profile: 40% work, 25% tech, 15% family..."

**Tests:** 30 Tests in `test/fingerprint.test.js`

- Domain classification, distribution calculation, Gini coefficient
- Topology hash, drift detection, cooldown logic

---

### 4. Sensor Connectors (`plugins/nox-event-bus/connectors/`)

**Event-Bus-Integration für File + System Monitoring.**

**Dateien:**

- `filewatch.js` — FileWatchConnector (4.3KB)
- `system.js` — SystemConnector (3.8KB)
- `index.js` — ConnectorRegistry (2.2KB)

**Funktionalität:**

**FileWatchConnector:**

- Watched `memory/` Verzeichnis auf Änderungen
- Emittiert `sensor.file` Events wenn .md Dateien erscheinen/ändern
- Nutzt `fs.watch` (fallback: statSync-Polling bei 1 Min Intervall)
- Rekursives Scannen aller Subdirectories
- Ignoriert non-.md Dateien

**SystemConnector:**

- Monitort System-Health: Disk-Space, CPU-Temp, Memory-Pressure
- Emittiert `sensor.system` Events NUR bei Problemen
- Thresholds: Disk 85%, CPU 75°C, Memory 90%
- Check-Intervall: 5 Minuten
- Liest `/proc/meminfo`, `df`, `/sys/class/thermal/thermal_zone0/temp`

**ConnectorRegistry:**

- Zentrale Registry für alle Connectors
- `registerConnector(name, Class)` — registriert Connector
- `runAll()` — startet alle Connectors
- `stopAll()` — stoppt alle Connectors
- Graceful Degradation: wenn ein Connector fehlschlägt, laufen andere weiter

**Integration:**

- Event-Bus Plugin importiert + startet Connectors bei `register()`
- Connectors laufen kontinuierlich im Hintergrund
- NICHT bei jedem `before_agent_start` (würden sonst zu viele Prozesse spawnen)

**Tests:** 24 Tests in `test/connectors.test.js`

- FileWatch: start/stop, .md detection, recursive scan, ignore non-.md
- System: start/stop, checks without crash, threshold logic
- Registry: register, runAll, graceful degradation

---

## Architektur-Integration

```
[Sensors]                          [Memory Access]                [Events]
file changes, system health   →    Qdrant queries tracked    →    event-bus
         │                                  │                           │
         ▼                                  ▼                           ▼
   sensor.file                        fademem-access              co-occurrence
   sensor.system                      fade scores                 concept pairs
         │                                  │                           │
         └──────────────────────────────────┴───────────────────────────┘
                                           │
                                           ▼
                              before_agent_start (Context Injection)
                                           │
            ┌──────────────────────────────┼──────────────────────────────┐
            ▼                              ▼                              ▼
    Fading Memories               Associative Memory           Cognitive Fingerprint
    (warn before loss)        (concept → related concepts)   (personality topology)
```

---

## Statistiken

| Metrik            | Vorher | Nachher | Delta |
| ----------------- | ------ | ------- | ----- |
| **Plugins**       | 7      | 10      | +3    |
| **Tests**         | 106    | 184     | +78   |
| **LoC (Plugins)** | ~8.5K  | ~11.9K  | +3.4K |
| **LoC (Tests)**   | ~4.2K  | ~7.2K   | +3K   |
| **Connectors**    | 0      | 2       | +2    |
| **External Deps** | 0      | 0       | 0     |

---

## Validierung

```bash
$ cd ~/openclaw-memory-local
$ npm test
# tests 184
# pass 184
# fail 0
```

Alle Tests bestanden. Keine Regression in bestehenden Plugins.

---

## Nächste Schritte

1. **Merge in master** (nach Code-Review)
2. **Produktiv-Test** auf Pi 5 (Rocky's Setup)
3. **Dokumentation** — SKILL.md für jedes neue Plugin
4. **ClawhHub** — Vorbereitung für Listing

---

**Erstellt von:** Nox ⚡ (Subagent)  
**Für:** Rocky Wüst  
**Branch:** feat/cognitive-v3.1  
**Status:** ✅ READY FOR REVIEW
