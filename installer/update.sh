#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
APP="$ROOT/app"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE=/usr/local/bin/node
NPM=/usr/local/bin/npm
SERVICE=hirbod-app.service
DROPIN_DIR=/etc/systemd/system/hirbod-app.service.d
NODE_DROPIN="$DROPIN_DIR/99-hirbod-node26-update.conf"
BACKUP_ROOT=/root/hirbod-backup/updates
HEALTH_URL=""
DRY_RUN=0
CONFIRM=0

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP=""
STAGE=""
BUILD_LOG=""
SERVICE_STOPPED=0
SWAPPED=0
DROPIN_TOUCHED=0
DROPIN_EXISTED=0
SUCCESS=0
BACKUP_TIMER=hirbod-telegram-backup.timer
BACKUP_TIMER_WAS_ACTIVE=0
BACKUP_TIMER_PAUSED=0
BACKUP_LOCK_HELD=0

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

http_code() {
  local result
  result=$(curl -sS -o /dev/null -w '%{http_code}' \
    --max-time 12 "$1" 2>/dev/null) || result=000
  printf '%s' "${result:-000}"
}

healthy_code() {
  [[ "$1" =~ ^[23][0-9][0-9]$ ]]
}

assert_no_restore() {
  [[ ! -e /var/lib/hirbod-backup/restore-running.lock ]] ||
    die "A restore lock exists; update blocked."

  local units
  units=$(systemctl list-units --state=active,activating \
    --type=service --no-legend 'hirbod-restore-v3-*' 2>/dev/null || true)

  [[ -z "$units" ]] || die "A restore systemd job is active; update blocked."
}

pause_backup_writes() {
  assert_no_restore

  if systemctl cat "$BACKUP_TIMER" >/dev/null 2>&1; then
    if systemctl is-active --quiet "$BACKUP_TIMER"; then
      BACKUP_TIMER_WAS_ACTIVE=1
    fi

    systemctl stop "$BACKUP_TIMER"
    BACKUP_TIMER_PAUSED=1
  fi

  install -d -m 700 /var/lib/hirbod-backup
  exec 8>>/var/lib/hirbod-backup/backup.lock

  flock -n 8 || die "A backup process is running; update blocked."
  BACKUP_LOCK_HELD=1

  for unit in hirbod-telegram-backup.service hirbod-telegram-backup-scheduled.service; do
    if systemctl is-active --quiet "$unit"; then
      die "Backup service is active; update blocked."
    fi
  done

  assert_no_restore
}

restore_backup_timer() {
  if (( BACKUP_LOCK_HELD )); then
    flock -u 8 || true
    exec 8>&-
    BACKUP_LOCK_HELD=0
  fi

  if (( BACKUP_TIMER_PAUSED )); then
    if (( BACKUP_TIMER_WAS_ACTIVE )); then
      systemctl start "$BACKUP_TIMER" ||
        echo "[WARNING] Could not restart backup timer." >&2
    fi
    BACKUP_TIMER_PAUSED=0
  fi
}

rollback() {
  set +e
  echo
  echo "[ROLLBACK] Restoring previous application..."

  systemctl stop "$SERVICE" >/dev/null 2>&1

  if (( SWAPPED )); then
    if [[ -d "$APP" ]]; then
      mv "$APP" "$BACKUP/failed-app"
    fi
    if [[ -d "$BACKUP/app" ]]; then
      mv "$BACKUP/app" "$APP"
    fi
  fi

  if (( DROPIN_TOUCHED )); then
    if (( DROPIN_EXISTED )); then
      cp -a "$BACKUP/node-override.conf" "$NODE_DROPIN"
    else
      rm -f "$NODE_DROPIN"
    fi
  fi

  systemctl daemon-reload >/dev/null 2>&1
  systemctl restart "$SERVICE" >/dev/null 2>&1

  local rollback_local rollback_public
  rollback_local=$(http_code http://127.0.0.1:3000/)
  rollback_public=$(http_code "$HEALTH_URL")

  if systemctl is-active --quiet "$SERVICE" &&
     healthy_code "$rollback_local" &&
     healthy_code "$rollback_public"; then
    echo "[PASS] Previous application and website restored."
  else
    echo "[CRITICAL] Rollback health check failed."
    echo "[CRITICAL] Local HTTP: $rollback_local"
    echo "[CRITICAL] Public HTTP: $rollback_public"
    echo "[CRITICAL] Backup: $BACKUP/app"
  fi
}

on_exit() {
  local rc=$?
  trap - EXIT

  if (( rc != 0 && SERVICE_STOPPED && !SUCCESS )); then
    rollback
  fi

  restore_backup_timer

  if [[ -n "$STAGE" && -d "$STAGE" ]]; then
    rm -rf "$STAGE"
  fi

  exit "$rc"
}
trap on_exit EXIT

while (($#)); do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --yes)
      CONFIRM=1
      shift
      ;;
    --health-url)
      [[ $# -ge 2 ]] || die "Health URL missing"
      HEALTH_URL="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -d "$APP" ]] || die "Existing application not found"
[[ -f "$APP/.output/server/index.mjs" ]] || die "Current app build missing"
[[ -f "$SOURCE/package.json" ]] || die "Release package missing"
[[ -f "$SOURCE/package-lock.json" ]] || die "Release package lock missing"
[[ -f "$SOURCE/.nvmrc" ]] || die "Release Node version missing"
[[ -x "$NODE" && -x "$NPM" ]] || die "Node 26 toolchain missing"
[[ -f /etc/hirbod/hirbod-runtime.env ]] || die "Runtime environment missing"
[[ -f /etc/hirbod/hirbod-admin.env ]] || die "Admin environment missing"
[[ -f /etc/systemd/system/hirbod-app.service ]] || die "App systemd unit missing"
[[ -d "$APP/drizzle/migrations" && -d "$SOURCE/drizzle/migrations" ]] ||
  die "Migration directory missing"
[[ -f /opt/hirbod/supabase-project/docker-compose.yml ]] ||
  die "Active Supabase project missing"

[[ "$HEALTH_URL" == https://* ]] ||
  die "Use --health-url https://your-domain"

EXPECTED_NODE=$(tr -d 'v\r\n' < "$SOURCE/.nvmrc")
ACTUAL_NODE=$("$NODE" --version)

[[ "$ACTUAL_NODE" == "v$EXPECTED_NODE" ]] ||
  die "Node mismatch: expected v$EXPECTED_NODE, found $ACTUAL_NODE"

[[ "$EXPECTED_NODE" == "26.13.0" ]] ||
  die "This updater currently supports Node 26.13.0 only"

systemctl is-active --quiet "$SERVICE" ||
  die "Application service is not active"

systemctl is-active --quiet caddy ||
  die "Caddy is not active"

command -v rsync >/dev/null || die "rsync is required"
command -v curl >/dev/null || die "curl is required"

diff -qr "$APP/drizzle/migrations" "$SOURCE/drizzle/migrations" >/dev/null ||
  die "Migration files differ. Database migration requires a separate reviewed step."

LOCAL_BASELINE=$(http_code http://127.0.0.1:3000/)
PUBLIC_BASELINE=$(http_code "$HEALTH_URL")

healthy_code "$LOCAL_BASELINE" ||
  die "Current local application is unhealthy: HTTP $LOCAL_BASELINE"

healthy_code "$PUBLIC_BASELINE" ||
  die "Current public website is unhealthy: HTTP $PUBLIC_BASELINE"

AVAILABLE_KB=$(df -Pk "$ROOT" | awk 'NR==2 {print $4}')
(( AVAILABLE_KB >= 5 * 1024 * 1024 )) ||
  die "At least 5 GB of free disk space is required"

[[ "$(stat -c %d "$ROOT")" == "$(stat -c %d /root)" ]] ||
  die "Application and backup directories must be on the same filesystem"

RELEASE_VERSION=$(tr -d 'v\r\n' < "$SOURCE/VERSION")
PACKAGE_VERSION=$("$NODE" -p "require('$SOURCE/package.json').version")
[[ "$RELEASE_VERSION" == "$PACKAGE_VERSION" ]] ||
  die "VERSION and package.json versions do not match"
COMMIT_ID=$(git -C "$SOURCE" rev-parse --short HEAD 2>/dev/null || echo package)

echo "======================================"
echo " Hirbod Application Update"
echo "======================================"
echo "Version:       $RELEASE_VERSION"
echo "Commit:        $COMMIT_ID"
echo "Node:          $ACTUAL_NODE"
echo "Local health:  HTTP $LOCAL_BASELINE"
echo "Public health: HTTP $PUBLIC_BASELINE"
echo "Migrations:    unchanged"
echo "Supabase:      will not be modified"
echo "Caddy:         will not be modified"
echo "======================================"

if (( DRY_RUN )); then
  echo "[PASS] Preflight completed. No changes made."
  exit 0
fi

(( CONFIRM )) || die "Actual update requires --yes"

exec 9>/run/lock/hirbod-update.lock
flock -n 9 || die "Another update is running"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"

BACKUP="$BACKUP_ROOT/$STAMP"
STAGE="$ROOT/.hirbod-update-stage-$STAMP"
BUILD_LOG="$BACKUP/build.log"

mkdir -m 700 "$BACKUP"
mkdir -m 700 "$STAGE"
chmod 600 "$BUILD_LOG" 2>/dev/null || true

echo
echo "[1/5] Preparing release files..."

rsync -a --delete \
  --exclude='.git/' \
  --exclude='node_modules/' \
  --exclude='.output/' \
  --exclude='.tanstack/' \
  --exclude='.wrangler/' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='.env.*.local' \
  --exclude='*.hirbod' \
  --exclude='*.dump' \
  "$SOURCE/" "$STAGE/"

echo
echo "[2/5] Installing dependencies and building..."

if ! (
  cd "$STAGE"
  PATH="/usr/local/bin:/usr/bin:/bin" "$NPM" ci --no-audit --no-fund
) >"$BUILD_LOG" 2>&1; then
  die "npm ci failed. Restricted log: $BUILD_LOG"
fi

if ! (
  cd "$STAGE"
  PATH="/usr/local/bin:/usr/bin:/bin" "$NPM" run build
) >>"$BUILD_LOG" 2>&1; then
  die "Production build failed. Restricted log: $BUILD_LOG"
fi

[[ -s "$STAGE/.output/server/index.mjs" ]] ||
  die "Production server entry missing"

[[ -d "$STAGE/.output/public" ]] ||
  die "Production public output missing"

echo "[PASS] Production build completed."

echo
echo "[3/5] Saving previous application..."

if [[ -e "$NODE_DROPIN" ]]; then
  grep -q 'Managed by Hirbod update.sh' "$NODE_DROPIN" ||
    die "Reserved Node drop-in exists and is not managed by this updater"

  cp -a "$NODE_DROPIN" "$BACKUP/node-override.conf"
  DROPIN_EXISTED=1
fi

pause_backup_writes
assert_no_restore

systemctl stop "$SERVICE"
SERVICE_STOPPED=1
sleep 2
assert_no_restore

mv "$APP" "$BACKUP/app"
SWAPPED=1
mv "$STAGE" "$APP"

echo "[PASS] Previous application preserved: $BACKUP/app"

echo
echo "[4/5] Configuring Node 26 and starting application..."

mkdir -p "$DROPIN_DIR"
TMP_DROPIN=$(mktemp "$DROPIN_DIR/.node26.XXXXXX")

cat > "$TMP_DROPIN" <<EOF
# Managed by Hirbod update.sh
[Service]
ExecStart=
ExecStart=$NODE $APP/.output/server/index.mjs
EOF

chmod 644 "$TMP_DROPIN"
DROPIN_TOUCHED=1
mv "$TMP_DROPIN" "$NODE_DROPIN"

systemctl daemon-reload
systemctl restart "$SERVICE"

echo
echo "[5/5] Checking application health..."

LOCAL_OK=0
LOCAL_CODE=000
for _ in $(seq 1 60); do
  code=$(http_code http://127.0.0.1:3000/)
  LOCAL_CODE=$code

  if systemctl is-active --quiet "$SERVICE" && healthy_code "$code"; then
    LOCAL_OK=1
    break
  fi

  sleep 2
done

(( LOCAL_OK )) || die "Local application health check failed"

PUBLIC_OK=0
PUBLIC_CODE=000
for _ in $(seq 1 15); do
  code=$(http_code "$HEALTH_URL")
  PUBLIC_CODE=$code

  if healthy_code "$code"; then
    PUBLIC_OK=1
    break
  fi

  sleep 2
done

(( PUBLIC_OK )) || die "Public HTTPS health check failed"

systemctl is-active --quiet caddy ||
  die "Caddy health check failed"

SUCCESS=1

echo
echo "======================================"
echo " HIRBOD UPDATE COMPLETED"
echo " Version: $RELEASE_VERSION"
echo " Commit:  $COMMIT_ID"
echo " Node:    $("$NODE" --version)"
echo " Backup:  $BACKUP/app"
echo " Local:   HTTP $LOCAL_CODE"
echo " Public:  HTTP $PUBLIC_CODE"
echo "======================================"
