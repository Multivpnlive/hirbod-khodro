#!/usr/bin/env bash
set -Eeuo pipefail

VERSION=26.13.0
BASE=/opt/hirbod/toolchain
DEST="$BASE/node-v$VERSION"

[[ $EUID -eq 0 ]] || { echo "[ERROR] Root required"; exit 1; }

case "$(uname -m)" in
  x86_64)
    ARCH=x64
    SHA=d28a96af6c38596f6d9d97c0ee531c13d238d757742387d1928de822d959e997
    ;;
  aarch64)
    ARCH=arm64
    SHA=406fe3fbde1c054adff8b297c16fdb5af6659db327c1ac8acd46b56ef1af9a92
    ;;
  *)
    echo "[ERROR] Unsupported architecture"
    exit 1
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y --no-install-recommends \
  ca-certificates curl xz-utils libatomic1

mkdir -p "$BASE"

if [[ -x "$DEST/bin/node" ]]; then
  [[ "$("$DEST/bin/node" --version)" == "v$VERSION" ]] || {
    echo "[ERROR] Existing Node installation mismatch"
    exit 1
  }
else
  [[ ! -e "$DEST" ]] || {
    echo "[ERROR] Incomplete Node directory exists"
    exit 1
  }

  TMP="$BASE/.node-install-$$"
  mkdir -m 700 "$TMP"
  trap 'rm -rf "$TMP"' EXIT

  FILE="node-v$VERSION-linux-$ARCH.tar.xz"
  URL="https://nodejs.org/dist/v$VERSION/$FILE"

  curl -fsSL "$URL" -o "$TMP/$FILE"

  echo "$SHA  $TMP/$FILE" | sha256sum -c -

  mkdir "$TMP/extracted"
  tar -xJf "$TMP/$FILE" \
    --strip-components=1 -C "$TMP/extracted"

  [[ -x "$TMP/extracted/bin/node" ]] || {
    echo "[ERROR] Node binary missing"
    exit 1
  }

  mv "$TMP/extracted" "$DEST"
fi

for BIN in node npm npx; do
  SOURCE="$DEST/bin/$BIN"
  TARGET="/usr/local/bin/$BIN"

  [[ -x "$SOURCE" ]] || {
    echo "[ERROR] Missing executable: $BIN"
    exit 1
  }

  if [[ -e "$TARGET" && ! -L "$TARGET" ]]; then
    echo "[ERROR] Existing non-symlink: $TARGET"
    exit 1
  fi

  ln -sfn "$SOURCE" "$TARGET"
done

[[ "$(/usr/local/bin/node --version)" == "v$VERSION" ]] || {
  echo "[ERROR] Node version verification failed"
  exit 1
}

echo "[PASS] Node.js $VERSION installed"
echo "[PASS] npm $(/usr/local/bin/npm --version)"
