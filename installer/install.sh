#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOMAIN=""

die() { echo "[ERROR] $*" >&2; exit 1; }
step() { echo; echo "========== $* =========="; }

[[ $EUID -eq 0 ]] || die "Run as root"

while (($#)); do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || die "Domain missing"
      DOMAIN="$2"
      shift 2
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] ||
  die "Valid --domain is required"

[[ ! -e "$ROOT" ]] || die "$ROOT already exists; refusing overwrite"

exec 9>/run/lock/hirbod-installer.lock
flock -n 9 || die "Another installer is running"

step "Validating release package"
bash "$SOURCE/installer/validate-package.sh"

step "Checking server and domain"
bash "$SOURCE/installer/preflight.sh" --domain "$DOMAIN"

step "Preparing installation directory"
install -d -m 700 "$ROOT" "$ROOT/release"
tar -C "$SOURCE" \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=.output \
  --exclude=.tanstack \
  --exclude=.wrangler \
  --exclude=.env \
  --exclude='*.hirbod' \
  --exclude='*.dump' \
  -cf - . | tar -C "$ROOT/release" -xf -

RELEASE="$ROOT/release"
touch "$ROOT/.hirbod-install-in-progress"
chmod 600 "$ROOT/.hirbod-install-in-progress"

step "Installing pinned Node.js"
bash "$RELEASE/installer/install-node.sh"

step "Installing Supabase"
bash "$RELEASE/installer/install-supabase.sh"

step "Configuring customer domain"
bash "$RELEASE/installer/configure-domain.sh" "$DOMAIN"
bash "$RELEASE/installer/secure-supabase-env.sh"
bash "$RELEASE/installer/configure-runtime-env.sh" "$DOMAIN"

step "Starting Supabase"
bash "$RELEASE/installer/start-supabase.sh"

step "Applying initial database migrations"
HIRBOD_APP_SOURCE="$RELEASE" \
  bash "$RELEASE/installer/apply-migrations.sh" pre-admin

step "Creating initial administrator"
python3 "$RELEASE/installer/bootstrap-admin.py"

step "Applying remaining database migrations"
HIRBOD_APP_SOURCE="$RELEASE" \
  bash "$RELEASE/installer/apply-migrations.sh" post-admin

step "Building Hirbod application"
bash "$RELEASE/installer/install-app.sh" "$RELEASE"

step "Preparing backup and restore workspace"
bash "$RELEASE/installer/prepare-restore.sh"

step "Configuring optional Telegram backups"
python3 "$RELEASE/installer/configure-telegram.py"
bash "$RELEASE/installer/install-backup-units.sh"

step "Installing Caddy and firewall"
bash "$RELEASE/installer/install-caddy.sh"
bash "$RELEASE/installer/configure-firewall.sh"

step "Starting Hirbod application"
bash "$RELEASE/installer/start-app.sh"

step "Configuring HTTPS reverse proxy"
bash "$RELEASE/installer/configure-caddy.sh" "$DOMAIN"

step "Verifying public HTTPS"
HTTPS_OK=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 8 "https://$DOMAIN/" >/dev/null 2>&1; then
    HTTPS_OK=1
    break
  fi
  sleep 4
done

[[ "$HTTPS_OK" -eq 1 ]] || die "HTTPS health check failed"

install -d -m 700 "$ROOT/installer-state"
printf 'completed\n' > "$ROOT/installer-state/install-complete"
chmod 600 "$ROOT/installer-state/install-complete"
rm -f "$ROOT/.hirbod-install-in-progress"

echo
echo "=========================================="
echo " HIRBOD INSTALLATION COMPLETED"
echo " Domain: https://$DOMAIN"
echo "=========================================="
