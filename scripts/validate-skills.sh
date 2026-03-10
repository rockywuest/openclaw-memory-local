#!/usr/bin/env bash
# validate-skills.sh — agentskills.io v1 spec validator for openclaw-memory-local
# Usage: ./scripts/validate-skills.sh [skill-dir/]
# If no argument, validates all 3 plugins.

set -euo pipefail

PASS=0; WARN=0; FAIL=0
TOTAL_PASS=0; TOTAL_WARN=0; TOTAL_FAIL=0

pass() { echo "  ✅ $1"; PASS=$((PASS + 1)); }
warn() { echo "  ⚠️  $1"; WARN=$((WARN + 1)); }
fail() { echo "  ❌ $1"; FAIL=$((FAIL + 1)); }

validate_skill() {
  local dir="$1"
  local skill_md="$dir/SKILL.md"
  PASS=0; WARN=0; FAIL=0

  echo ""
  echo "━━━ Validating: $dir ━━━"

  # 1. SKILL.md exists
  if [[ ! -f "$skill_md" ]]; then
    fail "SKILL.md not found"
    TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
    return
  fi
  pass "SKILL.md exists"

  # 2. Frontmatter delimiters
  local first_line
  first_line=$(head -1 "$skill_md")
  if [[ "$first_line" != "---" ]]; then
    fail "Missing YAML frontmatter opening ---"
    return
  fi
  pass "YAML frontmatter present"

  # Extract frontmatter
  local frontmatter
  frontmatter=$(sed -n '2,/^---$/p' "$skill_md" | head -n -1)

  # 3. name field
  local name
  name=$(echo "$frontmatter" | grep -E '^name:' | sed 's/name: *//' | tr -d '"' | tr -d "'")
  if [[ -z "$name" ]]; then
    fail "Missing 'name' field"
  elif [[ ${#name} -gt 64 ]]; then
    fail "name exceeds 64 chars: '$name' (${#name})"
  elif ! echo "$name" | grep -qE '^[a-z0-9][a-z0-9-]*[a-z0-9]$'; then
    fail "name invalid format: '$name' (must be lowercase, a-z, 0-9, hyphens, no leading/trailing hyphen)"
  elif echo "$name" | grep -qE '\-\-'; then
    fail "name contains consecutive hyphens: '$name'"
  else
    # Check directory name matches
    local dirname
    dirname=$(basename "$dir")
    if [[ "$name" == "$dirname" ]]; then
      pass "name: $name (matches directory)"
    else
      warn "name '$name' does not match directory '$dirname'"
    fi
  fi

  # 4. description field
  local desc
  desc=$(echo "$frontmatter" | sed -n '/^description:/,/^[a-z]/p' | head -n -1 | sed 's/^description: *//' | sed 's/^  *//' | tr '\n' ' ')
  if [[ -z "$desc" ]]; then
    fail "Missing 'description' field"
  elif [[ ${#desc} -gt 1024 ]]; then
    fail "description exceeds 1024 chars (${#desc})"
  else
    pass "description present (${#desc} chars)"
  fi

  # 5. license field (optional)
  local license
  license=$(echo "$frontmatter" | grep -E '^license:' | sed 's/license: *//' | tr -d '"' | tr -d "'")
  if [[ -n "$license" ]]; then
    pass "license: $license"
  else
    warn "No license field (optional)"
  fi

  # 6. compatibility field (optional)
  local compat
  compat=$(echo "$frontmatter" | grep -E '^compatibility:' | sed 's/compatibility: *//' | tr -d '"' | tr -d "'")
  if [[ -n "$compat" ]]; then
    if [[ ${#compat} -gt 500 ]]; then
      fail "compatibility exceeds 500 chars (${#compat})"
    else
      pass "compatibility present (${#compat} chars)"
    fi
  else
    warn "No compatibility field (optional)"
  fi

  # 7. metadata field (optional)
  if echo "$frontmatter" | grep -q '^metadata:'; then
    pass "metadata section present"
  else
    warn "No metadata section (optional)"
  fi

  # 8. Body content
  local body_start
  body_start=$(grep -n '^---$' "$skill_md" | tail -1 | cut -d: -f1)
  local total_lines
  total_lines=$(wc -l < "$skill_md")
  local body_lines=$((total_lines - body_start))

  if [[ $body_lines -lt 5 ]]; then
    fail "Body too short ($body_lines lines)"
  elif [[ $body_lines -gt 500 ]]; then
    warn "Body exceeds 500 lines ($body_lines) — consider splitting"
  else
    pass "Body: $body_lines lines"
  fi

  # 9. Estimated tokens (rough: words * 1.3)
  local body_words
  body_words=$(tail -n +"$((body_start + 1))" "$skill_md" | wc -w)
  local est_tokens=$(( (body_words * 13 + 9) / 10 ))
  if [[ $est_tokens -gt 5000 ]]; then
    warn "Estimated ~$est_tokens tokens (recommended < 5000)"
  else
    pass "Estimated ~$est_tokens tokens"
  fi

  # 10. LICENSE file (check repo root)
  if [[ -f "$dir/LICENSE" ]] || [[ -f "$(dirname "$dir")/LICENSE" ]] || [[ -f "$(dirname "$(dirname "$dir")")/LICENSE" ]]; then
    pass "LICENSE file accessible"
  else
    warn "No LICENSE file in skill or parent directories"
  fi

  # 11. README (optional)
  if [[ -f "$dir/README.md" ]]; then
    pass "README.md present"
  else
    warn "No README.md (optional)"
  fi

  # 12. Implementation files
  local has_impl=false
  for ext in js ts py sh; do
    if find "$dir" -maxdepth 2 -name "*.$ext" 2>/dev/null | grep -q .; then
      has_impl=true
      break
    fi
  done
  if $has_impl; then
    pass "Implementation files found"
  else
    warn "No implementation files found"
  fi

  # 13. Tests (check repo-level test dir)
  local repo_root
  repo_root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null || dirname "$dir")
  if [[ -d "$repo_root/test" ]] && ls "$repo_root/test/"*.test.* 2>/dev/null | grep -q .; then
    pass "Tests available (repo-level)"
  elif [[ -d "$dir/test" ]] || [[ -d "$dir/tests" ]]; then
    pass "Tests directory present"
  else
    warn "No tests found (optional)"
  fi

  echo "  ── Result: $PASS ✅  $WARN ⚠️  $FAIL ❌"
  TOTAL_PASS=$((TOTAL_PASS + PASS))
  TOTAL_WARN=$((TOTAL_WARN + WARN))
  TOTAL_FAIL=$((TOTAL_FAIL + FAIL))
}

# Main
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "🔍 agentskills.io v1 Spec Validator — openclaw-memory-local"
echo "   Repo: $REPO_ROOT"

if [[ $# -gt 0 ]]; then
  validate_skill "$1"
else
  validate_skill "auto-checkpoint"
  validate_skill "memory-qdrant"
  validate_skill "plugins/nox-auto-capture"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "TOTAL: $TOTAL_PASS ✅  $TOTAL_WARN ⚠️  $TOTAL_FAIL ❌"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ $TOTAL_FAIL -gt 0 ]]; then
  exit 2
elif [[ $TOTAL_WARN -gt 0 ]]; then
  exit 1
else
  exit 0
fi
