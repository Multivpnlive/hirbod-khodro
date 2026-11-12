#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
DB="$ROOT/supabase-project"
STATE="$ROOT/installer-state/supabase"
LOG=""

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Install marker missing"
[[ -f "$DB/.env" && -f "$DB/docker-compose.yml" ]] || die "Supabase project incomplete"

grep -Fxq 'API_GW_HTTP_PORT=127.0.0.1:8000' "$DB/.env" ||
  die "API gateway must be restricted to localhost"

grep -Fxq 'DISABLE_SIGNUP=true' "$DB/.env" ||
  die "Public signup must be disabled"

docker compose version >/dev/null 2>&1 ||
  die "Docker Compose plugin is unavailable"

mkdir -p "$STATE"
chmod 700 "$STATE"

exec 9>"$STATE/start.lock"
flock -n 9 || die "Supabase startup already running"

LOG="$(mktemp /run/hirbod-supabase-start.XXXXXX)"
chmod 600 "$LOG"
trap 'rm -f "$LOG"' EXIT

cd "$DB"

if ! docker compose up -d --wait --wait-timeout 900 >"$LOG" 2>&1; then
  die "Supabase startup failed; private log discarded"
fi

for SERVICE in db api-gw; do
  CID="$(docker compose ps -q "$SERVICE")"
  [[ -n "$CID" ]] || die "Required service missing: $SERVICE"

  RUNNING="$(docker inspect -f '{{.State.Running}}' "$CID")"
  [[ "$RUNNING" == "true" ]] || die "Service is not running: $SERVICE"
done

printf 'completed\n' > "$STATE/done"
chmod 600 "$STATE/done"

echo "[PASS] Supabase containers started"
echo "[PASS] Database and API gateway are running"
echo "[PASS] API gateway remains bound to localhost"
