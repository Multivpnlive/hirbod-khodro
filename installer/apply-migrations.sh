#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT="${HIRBOD_ROOT:-/opt/hirbod}"
APP_DIR="${HIRBOD_APP_SOURCE:-$ROOT/app}"
DB_DIR="$ROOT/supabase-project"
MARKER="$ROOT/.hirbod-install-in-progress"
STATE_DIR="$ROOT/installer-state/migrations"

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

[[ "$EUID" -eq 0 ]] || die "Run as root"
[[ -f "$MARKER" ]] || die "Fresh-install marker missing"
[[ -d "$APP_DIR/drizzle/migrations" ]] || die "Migration directory missing"
[[ -f "$DB_DIR/docker-compose.yml" ]] || die "Supabase Compose file missing"

PHASE="${1:-}"
case "$PHASE" in
  pre-admin)
    PREFIXES=(0000 0001 0002 0003 0004 0005 0006 0007 0008 0009)
    ;;
  post-admin)
    PREFIXES=(0010 0011 0012 0013 0014 0015 0016 0017 0018 0019)
    ;;
  *)
    die "Usage: apply-migrations.sh pre-admin|post-admin"
    ;;
esac

mkdir -p "$STATE_DIR"
chmod 700 "$ROOT/installer-state" "$STATE_DIR"

exec 9>"$STATE_DIR/migrations.lock"
flock -n 9 || die "Another migration process is running"

cd "$DB_DIR"

db_psql() {
  docker compose exec -T db \
    psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@"
}

db_psql -Atqc 'SELECT 1' >/dev/null \
  || die "PostgreSQL is not ready"

if [[ "$PHASE" == "pre-admin" ]]; then
  FIRST_MARKER="$STATE_DIR/0000.done"

  if [[ ! -f "$FIRST_MARKER" ]]; then
    EXISTS="$(db_psql -Atqc \
      "SELECT (to_regclass('public.user_roles') IS NOT NULL)::text")"

    [[ "$EXISTS" == "false" ]] \
      || die "Application schema already exists; refusing fresh migrations"
  fi
else
  for PREFIX in 0000 0001 0002 0003 0004 0005 0006 0007 0008 0009; do
    [[ -f "$STATE_DIR/$PREFIX.done" ]] \
      || die "Pre-admin migration $PREFIX has not completed"
  done

  ADMIN_EXISTS="$(db_psql -Atqc \
    "SELECT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE role::text = 'admin'
     )::text")"

  [[ "$ADMIN_EXISTS" == "true" ]] \
    || die "No administrator role found; post-admin migrations blocked"
fi

for PREFIX in "${PREFIXES[@]}"; do
  STATE="$STATE_DIR/$PREFIX.done"

  if [[ -f "$STATE" ]]; then
    echo "[SKIP] Migration $PREFIX already completed"
    continue
  fi

  mapfile -t MATCHES < <(
    find "$APP_DIR/drizzle/migrations" \
      -maxdepth 1 -type f \
      -name "${PREFIX}_*.sql" | sort
  )

  [[ "${#MATCHES[@]}" -eq 1 ]] \
    || die "Expected exactly one migration for $PREFIX"

  FILE="${MATCHES[0]}"
  echo "[RUN] Migration $(basename "$FILE")"

  db_psql < "$FILE" \
    || die "Migration $PREFIX failed; installation stopped"

  TEMP="$STATE.tmp.$$"
  printf 'completed\n' > "$TEMP"
  chmod 600 "$TEMP"
  mv "$TEMP" "$STATE"

  echo "[PASS] Migration $PREFIX completed"
done

if [[ "$PHASE" == "post-admin" ]]; then
  ADMIN_EXISTS="$(db_psql -Atqc \
    "SELECT EXISTS (
       SELECT 1 FROM public.user_roles
       WHERE role::text = 'admin'
     )::text")"

  [[ "$ADMIN_EXISTS" == "true" ]] \
    || die "Administrator role verification failed"
fi

echo "[PASS] Phase $PHASE completed"
