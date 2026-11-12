#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0
FAIL=0

ok()   { echo "[PASS] $*"; ((PASS+=1)); }
bad()  { echo "[FAIL] $*"; ((FAIL+=1)); }

need_file() {
  if [[ -f "$ROOT/$1" ]]; then
    ok "Found $1"
  else
    bad "Missing $1"
  fi
}

echo "=============================================="
echo " Hirbod Khodro - Release package validation"
echo " Read-only; no deployment or system changes"
echo "=============================================="

need_file package.json
need_file package-lock.json
need_file .nvmrc
need_file .npmrc
need_file installer/install-node.sh
need_file installer/install-supabase.sh
need_file installer/start-supabase.sh
need_file installer/start-app.sh
need_file installer/prepare-restore.sh
need_file installer/install-app.sh
need_file installer/install.sh
need_file installer/bootstrap.sh
need_file installer/configure-runtime-env.sh
need_file installer/secure-supabase-env.sh
need_file installer/configure-domain.sh
need_file installer/configure-caddy.sh
need_file installer/install-caddy.sh
need_file installer/configure-firewall.sh
need_file installer/templates/Caddyfile
need_file installer/templates/hirbod-app.service
need_file installer/templates/hirbod-telegram-backup.service
need_file installer/templates/hirbod-telegram-backup-scheduled.service
need_file installer/templates/hirbod-telegram-backup.timer
need_file installer/install-backup-units.sh
need_file installer/configure-telegram.py
need_file installer/bootstrap-admin.py
need_file installer/apply-migrations.sh
need_file scripts/build.mjs
need_file scripts/telegram_backup.py
need_file src/routes/api/backup/restore.ts
need_file deploy/restore-overlay/manifest.json
need_file deploy/restore-overlay/src/routes/api/backup/restore.ts
need_file deploy/restore-overlay/src/routes/_authenticated/backup.tsx
need_file deploy/restore-overlay/src/lib/telegram-backup.functions.ts
need_file deploy/restore-overlay/scripts/telegram_backup.py
need_file deploy/restore-overlay/scripts/build.mjs
need_file deploy/supabase-project/setup.sh
need_file deploy/supabase-project/run.sh
need_file deploy/supabase-project/.env.example

if [[ -f "$ROOT/deploy/supabase-project/docker-compose.yml" ||
      -f "$ROOT/deploy/supabase-project/docker-compose.yaml" ]]; then
  ok "Supabase Docker Compose file exists"
else
  bad "Supabase Docker Compose file is missing"
fi

if [[ -d "$ROOT/drizzle/migrations" ]]; then
  mapfile -t MIGRATIONS < <(
    find "$ROOT/drizzle/migrations" -maxdepth 1 -type f \
      -regextype posix-extended \
      -regex '.*/[0-9]{4}_.+\.sql' | sort
  )

  if (( ${#MIGRATIONS[@]} > 0 )); then
    ok "Found ${#MIGRATIONS[@]} numbered SQL migrations"
    expected=0
    for file in "${MIGRATIONS[@]}"; do
      prefix="$(printf '%04d' "$expected")"
      if [[ "$(basename "$file")" != "$prefix"_*.sql ]]; then
        bad "Migration sequence gap at $prefix"
        break
      fi
      ((expected+=1))
    done
    if (( expected == ${#MIGRATIONS[@]} )); then
      ok "Migration sequence is contiguous from 0000"
    fi
  else
    bad "No numbered SQL migrations found"
  fi
else
  bad "drizzle/migrations directory is missing"
fi

if [[ -f "$ROOT/.env.example" ]]; then
  ok "Root .env.example exists"
else
  bad "Root .env.example is missing"
fi

if [[ -f "$ROOT/.gitignore" ]] &&
   grep -Eq '(^|/)\.env([[:space:]]|$|\*)' "$ROOT/.gitignore"; then
  ok ".gitignore contains an environment-file exclusion"
else
  bad ".gitignore may not exclude environment files"
fi

# Check working tree for accidentally included environment or credential files.
while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  case "$rel" in
    .env.example|*/.env.example|*.example) continue ;;
    .git/*|node_modules/*|.output/*|.tanstack/*|.wrangler/*) continue ;;
  esac
  case "$(basename "$file")" in
    .env|.env.*|*.pem|*.key|*.hirbod|*.dump)
      bad "Potentially sensitive file present: $rel"
      ;;
  esac
done < <(
  find "$ROOT" \
    \( -name .git -o -name node_modules -o -name .output \
       -o -name .tanstack -o -name .wrangler \) -prune \
    -o -type f -print0
)

# Scan text files for common credential formats. Values are never printed.
python3 - "$ROOT" <<'PY'
import os, re, sys

root = sys.argv[1]
skip_dirs = {".git", "node_modules", ".output", ".tanstack", ".wrangler"}
skip_file = "installer/validate-package.sh"

patterns = [
    ("private key", re.compile(rb"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("Supabase secret API key", re.compile(rb"sb_secret_[A-Za-z0-9_-]{20,}")),
    ("Telegram bot token", re.compile(rb"\b[0-9]{8,10}:[A-Za-z0-9_-]{30,}\b")),
    ("GitHub access token", re.compile(rb"\bgh[pousr]_[A-Za-z0-9_]{30,}\b")),
    ("Slack token", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
]

extensions = {
    ".sh", ".py", ".js", ".mjs", ".ts", ".tsx", ".json",
    ".sql", ".yml", ".yaml", ".md", ".txt", ".conf", ".example"
}

matches = []
for base, dirs, files in os.walk(root):
    dirs[:] = [d for d in dirs if d not in skip_dirs]
    for name in files:
        path = os.path.join(base, name)
        rel = os.path.relpath(path, root)
        if rel == skip_file or os.path.splitext(name)[1] not in extensions:
            continue
        try:
            if os.path.getsize(path) > 5_000_000:
                continue
            data = open(path, "rb").read()
        except OSError:
            continue
        if b"\0" in data:
            continue
        for label, pattern in patterns:
            if pattern.search(data):
                matches.append((rel, label))

if matches:
    for rel, label in matches:
        print(f"[FAIL] Possible {label} found in {rel}")
    sys.exit(1)

print("[PASS] No common private credential patterns detected")
PY
scan_status=$?
if (( scan_status == 0 )); then
  ((PASS+=1))
else
  ((FAIL+=1))
fi

if git -C "$ROOT" diff --check; then
  ok "Git whitespace check passed"
else
  bad "Git whitespace check failed"
fi

echo
echo "=============================================="
echo " Results: PASS=$PASS  FAIL=$FAIL"
echo "=============================================="

if (( FAIL > 0 )); then
  echo "Validation failed. Do not publish this release."
  exit 1
fi

echo "Package validation passed."
