#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY="https://github.com/Multivpnlive/hirbod-khodro.git"
VERSION_TAG="v1.1.0"
DOMAIN=""

die() { echo "[ERROR] $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --domain)
      [[ $# -ge 2 ]] || die "Domain missing"
      DOMAIN="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || die "Version missing"
      VERSION_TAG="$2"
      shift 2
      ;;
    --help|-h)
      echo "Usage: install-from-github.sh --domain app.example.com [--version v1.1.0]"
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -n "$DOMAIN" ]] || die "A valid --domain is required"

python3 - "$VERSION_TAG" <<'PYVERSION'
import sys
v = sys.argv[1]
parts = v[1:].split(".") if v.startswith("v") else []
if len(parts) != 3 or not all(part.isdigit() for part in parts):
    raise SystemExit("Invalid release version")
PYVERSION

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
