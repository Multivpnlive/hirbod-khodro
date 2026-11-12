#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
STATE="$ROOT/installer-state/caddy"
CONFIG=/etc/caddy/Caddyfile

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ "$EUID" -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Fresh install marker missing"
[[ $# -eq 1 ]] || die "Usage: configure-caddy.sh example.com"

DOMAIN="$1"
[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || die "Invalid domain"

[[ -x "$(command -v caddy || true)" ]] || die "Caddy is not installed"
command -v systemctl >/dev/null || die "systemctl missing"

ENV="$ROOT/supabase-project/.env"
TEMPLATE="$ROOT/app/installer/templates/Caddyfile"

[[ -f "$ENV" && -f "$TEMPLATE" ]] || die "Required configuration missing"

grep -Fxq "SUPABASE_PUBLIC_URL=https://$DOMAIN" "$ENV" || die "Domain settings mismatch"
grep -Fxq "DISABLE_SIGNUP=true" "$ENV" || die "Public signup is not disabled"
grep -Fxq "API_GW_HTTP_PORT=127.0.0.1:8000" "$ENV" || die "API gateway is not restricted to localhost"

[[ ! -f "$STATE/done" ]] || die "Caddy configuration already completed"

mkdir -p "$STATE"
chmod 700 "$STATE"
chmod 755 /etc/caddy

TEMP="$(mktemp /etc/caddy/.hirbod.XXXXXX)"
trap 'rm -f "$TEMP"' EXIT

sed "s/example\.invalid/$DOMAIN/g" "$TEMPLATE" > "$TEMP"
caddy validate --config "$TEMP" --adapter caddyfile >/dev/null \
  || die "Caddy configuration validation failed"

if [[ -f "$CONFIG" ]]; then
  cp -a "$CONFIG" "$STATE/Caddyfile.previous"
  chmod 600 "$STATE/Caddyfile.previous"
  touch "$STATE/had-previous"
fi

install -m 0644 "$TEMP" "$CONFIG"

if systemctl is-active --quiet caddy; then
  if ! systemctl reload caddy; then
    if [[ -f "$STATE/had-previous" ]]; then
      cp -a "$STATE/Caddyfile.previous" "$CONFIG"
      systemctl reload caddy >/dev/null 2>&1 || true
    else
      rm -f "$CONFIG"
    fi
    die "Caddy reload failed; previous configuration restored where possible"
  fi
else
  if ! systemctl enable --now caddy; then
    if [[ -f "$STATE/had-previous" ]]; then
      cp -a "$STATE/Caddyfile.previous" "$CONFIG"
    else
      rm -f "$CONFIG"
    fi
    die "Caddy could not start"
  fi
fi

systemctl is-active --quiet caddy || die "Caddy is not active"

printf 'completed\n' > "$STATE/done"
chmod 600 "$STATE/done"

echo "[PASS] Caddy configuration validated"
echo "[PASS] Caddy service active"
echo "[PASS] Previous configuration backed up when present"
