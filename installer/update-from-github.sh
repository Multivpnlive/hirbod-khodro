#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPOSITORY="https://github.com/Multivpnlive/hirbod-khodro.git"
API="https://api.github.com/repos/Multivpnlive/hirbod-khodro/releases/latest"
VERSION_TAG=""
HEALTH_URL=""
CONFIRM=0
DRY_RUN=0
MODE_SELECTED=0

die() { echo "[ERROR] $*" >&2; exit 1; }

while (($#)); do
  case "$1" in
    --health-url)
      [[ $# -ge 2 ]] || die "Health URL missing"
      HEALTH_URL="$2"; shift 2 ;;
    --domain)
      [[ $# -ge 2 ]] || die "Domain missing"
      DOMAIN="${2#https://}"; DOMAIN="${DOMAIN#http://}"
      HEALTH_URL="https://$DOMAIN"; shift 2 ;;
    --version)
      [[ $# -ge 2 ]] || die "Version missing"
      VERSION_TAG="$2"; shift 2 ;;
    --yes) CONFIRM=1; MODE_SELECTED=1; shift ;;
    --dry-run) DRY_RUN=1; MODE_SELECTED=1; shift ;;
    --help|-h)
      echo "Usage: update-from-github.sh [--domain example.com] [--dry-run|--yes] [--version v1.1.0]"
      exit 0 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -d /opt/hirbod/app ]] || die "Hirbod installation not found"

if [[ -z "$HEALTH_URL" ]]; then
  DOMAIN=$(python3 - <<'PY'
import re
from pathlib import Path

p = Path("/etc/caddy/Caddyfile")
if p.exists():
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r'^(?:https?://)?([A-Za-z0-9.-]+\.[A-Za-z]{2,})(?:\s*,|\s*\{)', line)
        if m:
            print(m.group(1))
            break
PY
)
  if [[ -n "$DOMAIN" ]]; then
    HEALTH_URL="https://$DOMAIN"
    echo "[INFO] Detected domain: $DOMAIN"
  else
    [[ -t 0 ]] || die "Could not detect domain; provide --domain"
    read -r -p "دامنه سامانه: " DOMAIN
    DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"
    HEALTH_URL="https://$DOMAIN"
  fi
fi

python3 - "$HEALTH_URL" <<'PY'
import sys
from urllib.parse import urlparse
u=urlparse(sys.argv[1])
if u.scheme != "https" or not u.hostname or u.username or u.password or u.path not in ("", "/") or u.query or u.fragment:
    raise SystemExit("A valid HTTPS domain is required")
PY

if [[ -z "$VERSION_TAG" ]]; then
  command -v curl >/dev/null 2>&1 || die "curl is required"
  RELEASE_JSON=$(curl -fsSL "$API") || die "Could not fetch latest GitHub release"
  VERSION_TAG=$(printf '%s' "$RELEASE_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tag_name", ""))') || die "Invalid GitHub release response"
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

if (( ! MODE_SELECTED )) && [[ -t 0 ]]; then
  echo
  echo "دامنه: $HEALTH_URL"
  echo "نسخه مقصد: $VERSION_TAG"
  echo "1) پیش‌بررسی، بدون اعمال تغییرات (پیشنهادی)"
  echo "2) اجرای واقعی به‌روزرسانی"
  read -r -p "انتخاب شما [1]: " choice
  case "$choice" in
    2)
      read -r -p "برای تأیید، UPDATE را وارد کنید: " approval
      [[ "$approval" == "UPDATE" ]] || die "Update cancelled"
      CONFIRM=1 ;;
    ""|1) DRY_RUN=1 ;;
    *) die "Invalid selection" ;;
  esac
fi

if (( ! CONFIRM )); then
  DRY_RUN=1
  echo "[INFO] Safe mode: preflight only."
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
fi

bash "$WORKDIR/source/installer/update.sh" "${ARGS[@]}"
