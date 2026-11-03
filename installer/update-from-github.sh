#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY="https://github.com/Multivpnlive/hirbod-khodro.git"
VERSION_TAG="v1.0.0"
HEALTH_URL=""
CONFIRM=0

die() { echo "[ERROR] $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --health-url)
      [[ $# -ge 2 ]] || die "Health URL missing"
      HEALTH_URL="$2"
      shift 2
      ;;
    --version)
      [[ $# -ge 2 ]] || die "Version missing"
      VERSION_TAG="$2"
      shift 2
      ;;
    --yes)
      CONFIRM=1
      shift
      ;;
    --dry-run)
      CONFIRM=0
      shift
      ;;
    --help|-h)
      echo "Usage: update-from-github.sh --health-url https-domain [--version v1.0.0] [--dry-run|--yes]"
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -d /opt/hirbod/app ]] || die "Hirbod installation not found"

python3 - "$VERSION_TAG" "$HEALTH_URL" <<'PYVALIDATE'
import sys
from urllib.parse import urlparse

version = sys.argv[1]
parts = version[1:].split(".") if version.startswith("v") else []
if len(parts) != 3 or not all(part.isdigit() for part in parts):
    raise SystemExit("Invalid release version")

url = urlparse(sys.argv[2])
if url.scheme != "https" or not url.hostname:
    raise SystemExit("A valid HTTPS health URL is required")
PYVALIDATE

if ! command -v git >/dev/null 2>&1; then
  command -v apt-get >/dev/null 2>&1 || die "git and apt-get are unavailable"
  apt-get update
  apt-get install -y git
fi

WORKDIR=$(mktemp -d /tmp/hirbod-update.XXXXXX)
trap 'rm -rf "$WORKDIR"' EXIT

echo "[INFO] Downloading Hirbod $VERSION_TAG"
git clone --depth 1 --branch "$VERSION_TAG" "$REPOSITORY" "$WORKDIR/source"

ARGS=(--health-url "$HEALTH_URL")
if (( CONFIRM )); then
  ARGS+=(--yes)
else
  ARGS+=(--dry-run)
  echo "[INFO] Safe mode: preflight only. Add --yes to perform the update."
fi

bash "$WORKDIR/source/installer/update.sh" "${ARGS[@]}"
