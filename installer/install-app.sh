#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
APP="$ROOT/app"
SERVICE=/etc/systemd/system/hirbod-app.service
SOURCE="${1:-}"

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Install marker missing"
[[ -d "$SOURCE" ]] || die "Release source directory missing"
[[ -f "$SOURCE/package.json" && -f "$SOURCE/package-lock.json" ]] || die "Application source incomplete"
[[ -f /etc/hirbod/hirbod-runtime.env ]] || die "Runtime environment missing"
[[ -f /etc/hirbod/hirbod-admin.env ]] || die "Admin environment missing"
[[ ! -e "$APP" ]] || die "Application directory already exists"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y rsync
command -v rsync >/dev/null || die "rsync is required"
[[ -x /usr/local/bin/node && -x /usr/local/bin/npm ]] || die "Pinned Node.js is missing"

mkdir -p "$APP"
rsync -a \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='.output' \
  --exclude='.tanstack' \
  --exclude='.wrangler' \
  --exclude='.env' \
  --exclude='*.hirbod' \
  --exclude='*.dump' \
  "$SOURCE/" "$APP/"

if find "$APP" -type f -name '.env' -print -quit | grep -q .; then
  die "Unexpected environment file found in application source"
fi

cd "$APP"

LOG="$(mktemp /run/hirbod-build.XXXXXX)"
chmod 600 "$LOG"
trap 'rm -f "$LOG"' EXIT

if ! /usr/local/bin/npm ci --no-audit --no-fund >"$LOG" 2>&1; then
  die "npm ci failed; private build log was discarded"
fi

if ! /usr/local/bin/npm run build >>"$LOG" 2>&1; then
  die "Production build failed; private build log was discarded"
fi

[[ -s "$APP/.output/server/index.mjs" ]] || die "Production server entry not generated"

install -m 0644 \
  "$APP/installer/templates/hirbod-app.service" "$SERVICE"

systemctl daemon-reload

echo "[PASS] Application source installed"
echo "[PASS] Dependencies installed"
echo "[PASS] Production build generated"
echo "[PASS] Root systemd service prepared"
echo "[INFO] Application service has not been started."
