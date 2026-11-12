#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY="https://github.com/Multivpnlive/hirbod-khodro.git"
API="https://api.github.com/repos/Multivpnlive/hirbod-khodro/releases/latest"
VERSION_TAG=""
DOMAIN=""

die() { echo "[ERROR] $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --domain) [[ $# -ge 2 ]] || die "Domain missing"; DOMAIN="$2"; shift 2 ;;
    --version) [[ $# -ge 2 ]] || die "Version missing"; VERSION_TAG="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: install-from-github.sh [--domain example.com] [--version v1.1.0]"
      exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"

if [[ -z "$DOMAIN" ]]; then
  [[ -t 0 ]] || die "Run interactively or provide --domain"
  echo
  echo "======================================"
  echo " Hirbod Khodro - Fresh Installation"
  echo "======================================"
  read -r -p "دامنه سامانه را وارد کنید (مثلاً app.example.com): " DOMAIN
fi

python3 - "$DOMAIN" <<'PY'
import re, sys
if not re.fullmatch(r'([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,}', sys.argv[1]):
    raise SystemExit("Invalid domain")
PY

if [[ -z "$VERSION_TAG" ]]; then
  command -v curl >/dev/null 2>&1 || die "curl is required"
  RELEASE_JSON=$(curl -fsSL "$API") || die "Could not fetch latest GitHub release"
  VERSION_TAG=$(printf '%s' "$RELEASE_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("tag_name", ""))') || die "Invalid GitHub release response"
  [[ -n "$VERSION_TAG" ]] || die "No published GitHub release found"
fi

python3 - "$VERSION_TAG" <<'PY'
import sys
v=sys.argv[1]
p=v[1:].split(".") if v.startswith("v") else []
if len(p)!=3 or not all(x.isdigit() for x in p):
    raise SystemExit("Invalid release version")
PY

if ! command -v git >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || die "git and apt-get are unavailable"
  apt-get update
  apt-get install -y git
fi

WORKDIR=$(mktemp -d /tmp/hirbod-install.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

echo "[INFO] Downloading Hirbod $VERSION_TAG"
git clone --depth 1 --branch "$VERSION_TAG" "$REPOSITORY" "$WORKDIR/source"

echo "[INFO] Starting installation for $DOMAIN"
bash "$WORKDIR/source/installer/install.sh" --domain "$DOMAIN"
