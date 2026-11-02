#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
REF=self-hosted/v0.8.3
SETUP="$(cd "$(dirname "$0")/../deploy/supabase-project" && pwd)/setup.sh"

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Install marker missing"
[[ -f "$SETUP" ]] || die "Supabase setup script missing"
[[ ! -e "$ROOT/supabase-project" ]] || die "Supabase directory already exists"

LOG="$(mktemp /run/hirbod-setup.XXXXXX)"
chmod 600 "$LOG"
trap 'rm -f "$LOG"' EXIT

cd "$ROOT"

if ! sh "$SETUP" \
    --project-dir supabase-project \
    --ref "$REF" -y >"$LOG" 2>&1; then
    die "Supabase setup failed. No secret output was displayed."
fi

DB="$ROOT/supabase-project"

[[ -s "$DB/.env" ]] || die "Generated Supabase environment is missing"
[[ -s "$DB/docker-compose.yml" ]] || die "Compose file is missing"
[[ -f "$DB/utils/add-new-auth-keys.sh" ]] || die "Auth key generator missing"

chmod 600 "$DB/.env"
rm -f "$DB/.env.old" "$DB/docker-compose.yml.old"

echo "[PASS] Supabase source installed: $REF"
echo "[PASS] Environment file generated and protected"
echo "[PASS] Docker Compose configuration prepared"
echo "[PASS] Docker images pulled by setup script"
echo "[INFO] Containers have not been started."
