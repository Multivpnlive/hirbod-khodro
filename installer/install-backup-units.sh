#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod
TEMPLATES="$ROOT/app/installer/templates"
CONFIG=/etc/hirbod/telegram-backup.json
UNIT_DIR=/etc/systemd/system
DROPIN="$UNIT_DIR/hirbod-telegram-backup.timer.d/override.conf"

[[ $EUID -eq 0 ]] || exit 1
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || {
  echo "[ERROR] Install marker missing"
  exit 1
}

for UNIT in hirbod-telegram-backup.service hirbod-telegram-backup-scheduled.service hirbod-telegram-backup.timer; do
  [[ -f "$TEMPLATES/$UNIT" ]] || { echo "[ERROR] Missing template: $UNIT"; exit 1; }
  install -o root -g root -m 0644 "$TEMPLATES/$UNIT" "$UNIT_DIR/$UNIT"
done

ENABLED=false
HOURS=1
if [[ -f "$CONFIG" ]]; then
  readarray -t VALUES < <(python3 - "$CONFIG" <<'PYCONFIG'
import json,sys
d=json.load(open(sys.argv[1]))
print("true" if d.get("enabled") else "false")
print(d.get("schedule_hours", 1))
PYCONFIG
)
  ENABLED="${VALUES[0]:-false}"
  HOURS="${VALUES[1]:-1}"
fi

case "$HOURS" in
  0.5) INTERVAL=30min ;;
  1) INTERVAL=1h ;;
  2) INTERVAL=2h ;;
  4|6|12|24|48|72|168) INTERVAL="${HOURS}h" ;;
  *) echo "[ERROR] Invalid backup interval: $HOURS"; exit 1 ;;
esac

install -d -o root -g root -m 0755 "$(dirname "$DROPIN")"
TMP="$DROPIN.tmp"
printf '[Timer]\\nOnCalendar=\\nOnBootSec=10min\\nOnUnitActiveSec=%s\\nRandomizedDelaySec=60s\\n' "$INTERVAL" > "$TMP"
chmod 0644 "$TMP"
mv "$TMP" "$DROPIN"

systemctl daemon-reload
if [[ "$ENABLED" == "true" ]]; then
  systemctl enable hirbod-telegram-backup.timer
  systemctl restart hirbod-telegram-backup.timer
else
  systemctl disable --now hirbod-telegram-backup.timer >/dev/null 2>&1 || true
fi
echo "[PASS] Backup units installed; interval=$INTERVAL; enabled=$ENABLED"
