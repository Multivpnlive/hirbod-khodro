#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod
TEMPLATES="$ROOT/app/installer/templates"
CONFIG=/etc/hirbod/telegram-backup.json

[[ $EUID -eq 0 ]] || exit 1
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || {
  echo "[ERROR] Install marker missing"
  exit 1
}

for UNIT in \
  hirbod-telegram-backup.service \
  hirbod-telegram-backup-scheduled.service \
  hirbod-telegram-backup.timer
do
  [[ -f "$TEMPLATES/$UNIT" ]] || {
    echo "[ERROR] Missing template: $UNIT"
    exit 1
  }
  install -m 0644 "$TEMPLATES/$UNIT" "/etc/systemd/system/$UNIT"
done

systemctl daemon-reload

ENABLED=false
if [[ -f "$CONFIG" ]]; then
  ENABLED="$(python3 -c \
    'import json,sys; print("true" if json.load(open(sys.argv[1])).get("enabled") else "false")' \
    "$CONFIG")"
fi

if [[ "$ENABLED" == "true" ]]; then
  systemctl enable --now hirbod-telegram-backup.timer
  systemctl is-active --quiet hirbod-telegram-backup.timer
  echo "[PASS] Hourly Telegram backup timer enabled"
else
  systemctl disable --now hirbod-telegram-backup.timer >/dev/null 2>&1 || true
  echo "[INFO] Automatic Telegram backups are disabled"
fi

echo "[PASS] Backup systemd units installed"
