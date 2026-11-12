#!/usr/bin/env bash
set -Eeuo pipefail

REPO="https://github.com/Multivpnlive/hirbod-khodro.git"
REF="${HIRBOD_RELEASE_REF:-v1.1.0}"

die() {
  echo "[ERROR] $*" >&2
  exit 1
}

[[ $EUID -eq 0 ]] || die "Run with sudo or as root"

[[ $# -eq 2 && "$1" == "--domain" ]] ||
  die "Usage: bootstrap.sh --domain customer.example.com"

DOMAIN="$2"

[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] ||
  die "Invalid domain"

. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] ||
  die "Ubuntu is required"

export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y --no-install-recommends \
  git ca-certificates curl

WORK="$(mktemp -d /var/tmp/hirbod-bootstrap.XXXXXX)"
chmod 700 "$WORK"
trap 'rm -rf "$WORK"' EXIT

echo "[1/3] Downloading Hirbod release from GitHub"

git clone \
  --depth 1 \
  --single-branch \
  --branch "$REF" \
  "$REPO" "$WORK/source"

echo "[2/3] Checking release files"

[[ -f "$WORK/source/installer/install.sh" ]] ||
  die "Installer not found in GitHub release"

[[ -f "$WORK/source/installer/validate-package.sh" ]] ||
  die "Release validator missing"

echo "[3/3] Starting installation"

bash "$WORK/source/installer/install.sh" --domain "$DOMAIN"
