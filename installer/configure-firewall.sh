#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod

die() { echo "[ERROR] $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Install marker missing"

command -v sshd >/dev/null || die "OpenSSH server not found"

mapfile -t SSH_PORTS < <(
  sshd -T 2>/dev/null | awk '$1=="port" {print $2}' | sort -un
)
((${#SSH_PORTS[@]} > 0)) || die "Cannot determine SSH ports"

for PORT in "${SSH_PORTS[@]}"; do
  [[ "$PORT" =~ ^[0-9]+$ ]] && ((PORT > 0 && PORT < 65536)) ||
    die "Invalid SSH port detected"
done

if command -v ufw >/dev/null 2>&1 &&
   ufw status 2>/dev/null | grep -q "Status: active"; then
    die "Existing active firewall detected; refusing to overwrite rules"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y ufw

for PORT in "${SSH_PORTS[@]}"; do ufw allow "${PORT}/tcp"; done
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp

ufw default deny incoming
ufw default allow outgoing

ufw --force enable
ufw status verbose

ufw status | grep -q "Status: active" || die "Firewall activation failed"

echo "[PASS] SSH ports ${SSH_PORTS[*]} allowed"
echo "[PASS] HTTP and HTTPS allowed"
echo "[PASS] Firewall activated"
