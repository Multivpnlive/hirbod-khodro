#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
APP="$ROOT/app"
SOURCE="${1:-}"
MODE="${2:-}"
STATE_DIR="$ROOT/installer-state/migrations"
DB_DIR="$ROOT/supabase-project"
BACKUP_FILE="${3:-}"

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -n "$SOURCE" && -d "$SOURCE/drizzle/migrations" ]] || die "Release migration directory missing"
[[ -d "$APP/drizzle/migrations" ]] || die "Installed migration directory missing"
[[ -f "$DB_DIR/docker-compose.yml" ]] || die "Supabase Compose file missing"
[[ "$MODE" == preflight || "$MODE" == apply ]] || die "Usage: apply-update-migrations.sh RELEASE_DIR preflight|apply [DATABASE_BACKUP]"

db_psql() {
  (cd "$DB_DIR" && docker compose exec -T db psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres "$@")
}

db_exec() {
  (cd "$DB_DIR" && docker compose exec -T db "$@")
}

db_psql -Atqc 'SELECT 1' >/dev/null || die "PostgreSQL is not ready"

# An update may add migrations, but it must never silently rewrite or remove
# migrations that shipped with the installed release. Some older installations
# predate reliable filesystem markers; matching migrations in the running app
# are the installed schema baseline and are never replayed here.
LEGACY_UNMARKED=()
while IFS= read -r -d '' installed_file; do
  name=${installed_file##*/}
  release_file="$SOURCE/drizzle/migrations/$name"
  [[ -f "$release_file" ]] || die "Release removed installed migration $name"
  cmp -s "$installed_file" "$release_file" || die "Installed migration differs from release: $name"
  prefix=${name%%_*}
  if [[ ! -f "$STATE_DIR/$prefix.done" ]]; then
    LEGACY_UNMARKED+=("$name")
  fi
done < <(find "$APP/drizzle/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' -print0 | sort -z)

mapfile -t RELEASE_MIGRATIONS < <(find "$SOURCE/drizzle/migrations" -maxdepth 1 -type f -name '[0-9][0-9][0-9][0-9]_*.sql' | sort)
(( ${#RELEASE_MIGRATIONS[@]} > 0 )) || die "No numbered release migrations found"

PENDING=()
EXPECTED=0
for file in "${RELEASE_MIGRATIONS[@]}"; do
  name=${file##*/}
  prefix=${name%%_*}
  number=$((10#$prefix))
  (( number == EXPECTED )) || die "Migration sequence gap or duplicate at $name"
  EXPECTED=$((EXPECTED + 1))

  if [[ ! -f "$STATE_DIR/$prefix.done" ]]; then
    if [[ ! -f "$APP/drizzle/migrations/$name" ]]; then
      PENDING+=("$file")
    fi
  fi
done

for name in "${LEGACY_UNMARKED[@]}"; do
  echo "[INFO] Installed migration $name has no marker; treating the active app schema as the baseline and not replaying it."
done

if ((${#PENDING[@]} == 0)); then
  echo "[PASS] Database migrations are already current."
  exit 0
fi

DATABASE_BYTES=$(db_psql -Atqc "SELECT pg_database_size('postgres')")
[[ "$DATABASE_BYTES" =~ ^[0-9]+$ ]] || die "Could not determine PostgreSQL database size"
AVAILABLE_BYTES=$(df -PB1 /root | awk 'NR==2 {print $4}')
REQUIRED_BYTES=$((DATABASE_BYTES + DATABASE_BYTES / 5 + 536870912))
(( AVAILABLE_BYTES >= REQUIRED_BYTES )) ||
  die "Not enough disk space for a verified database backup before migrations"
echo "[INFO] Database backup space available: $((AVAILABLE_BYTES / 1024 / 1024)) MiB; estimated minimum: $((REQUIRED_BYTES / 1024 / 1024)) MiB."

echo "[INFO] Pending database migrations:"
for file in "${PENDING[@]}"; do echo "  - ${file##*/}"; done

if [[ "$MODE" == preflight ]]; then
  echo "[PASS] Migration preflight completed; no database changes made."
  exit 0
fi

[[ -n "$BACKUP_FILE" ]] || die "Database backup path missing"
install -d -m 700 "$(dirname "$BACKUP_FILE")"
[[ ! -e "$BACKUP_FILE" ]] || die "Database backup already exists: $BACKUP_FILE"
TEMP_BACKUP="$BACKUP_FILE.partial.$$"
trap 'rm -f "$TEMP_BACKUP"' EXIT

echo "[INFO] Creating a private PostgreSQL backup before migrations..."
db_exec pg_dump -U postgres -d postgres -Fc > "$TEMP_BACKUP" || die "PostgreSQL backup failed; no migrations were applied"
[[ -s "$TEMP_BACKUP" ]] || die "PostgreSQL backup is empty"
db_exec pg_restore --list < "$TEMP_BACKUP" >/dev/null || die "PostgreSQL backup verification failed"
chmod 600 "$TEMP_BACKUP"
mv "$TEMP_BACKUP" "$BACKUP_FILE"
echo "[PASS] Verified database backup: $BACKUP_FILE"

install -d -m 700 "$ROOT/installer-state" "$STATE_DIR"
chmod 700 "$STATE_DIR"
exec 9>"$STATE_DIR/migrations.lock"
flock -n 9 || die "Another migration process is running"

for file in "${PENDING[@]}"; do
  name=${file##*/}
  prefix=${name%%_*}
  echo "[RUN] Database migration $name"
  db_psql < "$file" || die "Database migration $name failed. The verified backup is retained at $BACKUP_FILE"
  marker_tmp="$STATE_DIR/$prefix.done.tmp.$$"
  printf 'completed\n' > "$marker_tmp"
  chmod 600 "$marker_tmp"
  mv "$marker_tmp" "$STATE_DIR/$prefix.done"
  echo "[PASS] Database migration $name completed"
done

echo "[PASS] All release database migrations completed."
