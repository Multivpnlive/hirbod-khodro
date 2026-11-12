#!/usr/bin/env bash
set -Eeuo pipefail

DOMAIN=""

usage() {
  echo "Usage: sudo bash preflight.sh --domain example.com"
}

while (($#)); do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || { usage; exit 2; }
      DOMAIN="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 2
      ;;
  esac
done

PASS=0
WARN=0
FAIL=0

ok()   { echo "[PASS] $*"; ((PASS+=1)); }
warn() { echo "[WARN] $*"; ((WARN+=1)); }
fail() { echo "[FAIL] $*"; ((FAIL+=1)); }

echo "================================================"
echo " Hirbod Khodro - Installer preflight"
echo " Read-only checks; no system changes"
echo "================================================"

if [[ "${EUID}" -eq 0 ]]; then
  ok "Running as root"
else
  fail "Run this check as root (sudo)"
fi

if [[ -r /etc/os-release ]]; then
  . /etc/os-release
  if [[ "${ID:-}" == "ubuntu" && "${VERSION_ID:-}" =~ ^(22\.04|24\.04) ]]; then
    ok "Supported OS: Ubuntu ${VERSION_ID}"
  else
    fail "Unsupported OS: ${PRETTY_NAME:-unknown}; Ubuntu 22.04 or 24.04 required"
  fi
else
  fail "Cannot read /etc/os-release"
fi

ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
  ok "CPU architecture: $ARCH"
else
  fail "Unsupported CPU architecture: $ARCH"
fi

CPU_COUNT="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 0)"
if (( CPU_COUNT >= 2 )); then
  ok "CPU cores: $CPU_COUNT"
else
  fail "At least 2 CPU cores required; found $CPU_COUNT"
fi

MEM_KB="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
MEM_GB=$(( MEM_KB / 1024 / 1024 ))
if (( MEM_GB >= 4 )); then
  ok "RAM: approximately ${MEM_GB} GiB"
else
  fail "At least 4 GiB RAM required; found approximately ${MEM_GB} GiB"
fi

DISK_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
DISK_GB=$(( DISK_KB / 1024 / 1024 ))
if (( DISK_GB >= 25 )); then
  ok "Available root filesystem space: approximately ${DISK_GB} GiB"
else
  fail "At least 25 GiB free on / required; found approximately ${DISK_GB} GiB"
fi

if [[ -n "$DOMAIN" ]]; then
  if [[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]]; then
    ok "Domain syntax looks valid: $DOMAIN"

    if command -v getent >/dev/null 2>&1; then
      DNS_IPS="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)"
    else
      DNS_IPS=""
    fi

    if [[ -z "$DNS_IPS" ]]; then
      fail "No IPv4 DNS record found for $DOMAIN"
    elif command -v curl >/dev/null 2>&1; then
      PUBLIC_IP="$(curl -4fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
      if [[ -z "$PUBLIC_IP" ]]; then
        fail "Could not determine this server's public IPv4 address"
      elif grep -Fxq "$PUBLIC_IP" <<< "$DNS_IPS"; then
        ok "Domain resolves to this server's public IPv4"
      else
        fail "DNS for $DOMAIN does not point to this server; DNS=$DNS_IPS"
      fi
    else
      fail "curl is required to verify the domain's public IPv4"
    fi
  else
    fail "Invalid domain format: $DOMAIN"
  fi
else
  fail "Domain is required; use --domain example.com"
fi

if command -v ss >/dev/null 2>&1; then
  if ss -ltnH "( sport = :80 )" 2>/dev/null | grep -q .; then
    warn "TCP port 80 is occupied; HTTPS will use TLS-ALPN on port 443"
  else
    ok "TCP port 80 is available (not required for TLS-ALPN)"
  fi

  for PORT in 443 3000 8000 5432 54321; do
    if ss -ltnH "( sport = :$PORT )" 2>/dev/null | grep -q .; then
      fail "TCP port $PORT is already listening"
    else
      ok "TCP port $PORT is available"
    fi
  done
else
  fail "The ss command is missing; install the iproute2 package"
fi

if [[ -e /opt/hirbod ]]; then
  fail "/opt/hirbod already exists; installer must not overwrite an existing installation"
else
  ok "/opt/hirbod is available for a fresh installation"
fi

if command -v docker >/dev/null 2>&1; then
  if docker info >/dev/null 2>&1; then
    warn "Docker is already installed and running; existing containers need review"
  else
    warn "Docker is installed but not running"
  fi
else
  ok "Docker is not installed; installer can provision it"
fi

if command -v ufw >/dev/null 2>&1; then
  UFW_STATUS="$(ufw status 2>/dev/null | head -n 1 || true)"
  case "$UFW_STATUS" in
    "Status: active")   warn "UFW is active; existing firewall settings will be left unchanged. Verify inbound TCP 443 is allowed." ;;
    "Status: inactive") ok "UFW is inactive; installer will not enable or modify it" ;;
    *)                  warn "Could not determine UFW status" ;;
  esac
else
  warn "UFW is not installed; installer will not manage firewall rules. Ensure inbound TCP 443 is allowed."
fi

echo
echo "================================================"
echo " Results: PASS=$PASS  WARN=$WARN  FAIL=$FAIL"
echo "================================================"

if (( FAIL > 0 )); then
  echo "Preflight failed. No changes were made."
  exit 1
fi

echo "Preflight passed. No changes were made."
