#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod
KEY=/usr/share/keyrings/caddy-stable-archive-keyring.gpg
REPO=/etc/apt/sources.list.d/caddy-stable.list

[[ $EUID -eq 0 ]] || { echo "[ERROR] Root required"; exit 1; }
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || {
  echo "[ERROR] Fresh-install marker missing"
  exit 1
}

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg debian-keyring \
  debian-archive-keyring apt-transport-https

install -d -m 0755 /usr/share/keyrings

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -1fsSL \
  https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
  gpg --dearmor > "$TMP"

test -s "$TMP"
install -m 0644 "$TMP" "$KEY"

curl -1fsSL \
  https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  -o "$TMP"

install -m 0644 "$TMP" "$REPO"

apt-get update -qq
apt-get install -y caddy

systemctl enable caddy
systemctl start caddy

command -v caddy >/dev/null
systemctl is-active --quiet caddy

echo "[PASS] Caddy installed from official repository"
echo "[PASS] Caddy systemd service active"
caddy version
