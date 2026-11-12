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


# Install Docker from Ubuntu repositories; do not depend on download.docker.com.
. /etc/os-release
[[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" =~ ^(22\.04|24\.04)$ ]] || die "Ubuntu 22.04 or 24.04 required"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq

PACKAGES=(git openssl jq ca-certificates curl gnupg)
command -v docker >/dev/null 2>&1 || PACKAGES+=(docker.io)
docker compose version >/dev/null 2>&1 || PACKAGES+=(docker-compose-v2)

apt-get install -y "${PACKAGES[@]}"
systemctl enable --now docker || die "Docker service could not start"
docker info >/dev/null 2>&1 || die "Docker daemon is not ready"
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin is unavailable"

LOG="$(mktemp /run/hirbod-setup.XXXXXX)"
chmod 600 "$LOG"
trap 'rm -f "$LOG"' EXIT

cd "$ROOT"

if ! sh "$SETUP" \
    --skip-deps \
    --project-dir supabase-project \
    --ref "$REF" -y >"$LOG" 2>&1; then
    die "Supabase setup failed. No secret output was displayed."
fi

DB="$ROOT/supabase-project"

[[ -s "$DB/.env" ]] || die "Generated Supabase environment is missing"
[[ -s "$DB/docker-compose.yml" ]] || die "Compose file is missing"
[[ -f "$DB/utils/add-new-auth-keys.sh" ]] || die "Auth key generator missing"

chmod 600 "$DB/.env"

# SQL initialization files are not secrets; PostgreSQL must be able to read them.
SQL_DIR="$DB/volumes/db"
[[ -d "$SQL_DIR" ]] || die "Supabase database initialization directory is missing"
mapfile -d '' SQL_FILES < <(find "$SQL_DIR" -type f -name '*.sql' -print0)
((${#SQL_FILES[@]} > 0)) || die "No Supabase database initialization SQL files found"
chmod 644 "${SQL_FILES[@]}"
for SQL_FILE in "${SQL_FILES[@]}"; do
    [[ -r "$SQL_FILE" ]] || die "Supabase SQL file is not readable: ${SQL_FILE#"$DB"/}"
done
rm -f "$DB/.env.old" "$DB/docker-compose.yml.old"

echo "[PASS] Supabase source installed: $REF"
echo "[PASS] Environment file generated and protected"
echo "[PASS] Docker Compose configuration prepared"
echo "[PASS] Docker images pulled by setup script"
echo "[INFO] Containers have not been started."
