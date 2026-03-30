---
name: nox-preference-learner
description: >
  Train your agent by talking. Detects approval/disapproval signals in conversations
  and builds a behavioral preference database. Injects learned preferences into agent
  context before each response. RLHF-lite without model fine-tuning — the agent adapts
  its behavior based on accumulated human feedback patterns.
license: MIT
compatibility: OpenClaw 2026.1.30+, Node.js >= 20
---

# Preference Learner — Train by Talking

## What It Does

Listens to your conversations and detects feedback signals:

- **Positive**: "perfekt", "genau so", "gut gemacht", "mach", 👍, 💪
- **Negative**: "wrong", "annoying", "stop that", "never again", "don't ask"  
  Also detects German: "falsch", "nervt", "frag nicht"

Maps signals to 6 behavioral dimensions:

1. **Autonomy** — act independently vs. ask first
2. **Verbosity** — brief vs. detailed
3. **Proactivity** — suggest things vs. wait for instructions
4. **Formality** — casual vs. professional
5. **Technical depth** — show code vs. high-level summary
6. **Confirmation seeking** — just do it vs. check first

Each dimension has a score that increases/decreases with feedback and decays
if not reinforced (30-day half-life). Strong, consistent feedback creates
strong preferences. Occasional remarks create mild nudges.

## How It Works

```
User says "Stop asking me every time, just do it!"
  → Signal: negative (-1.5)
  → Category: confirmation_seeking → LESS
  → Category: autonomy → MORE
  → Score updated, saved to preferences.json

Next session:
  → Plugin loads preferences.json
  → Injects: "STRONG preference for LESS confirmation seeking"
  → Agent adjusts behavior accordingly
```

## Configuration

```json
{
  "nox-preference-learner": {
    "enabled": true
  }
}
```

Preferences stored in: `memory/preferences.json`
Log: `memory/preference-learner.log`
