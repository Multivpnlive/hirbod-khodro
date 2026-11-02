#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod
STATE=/var/lib/hirbod-backup

[[ $EUID -eq 0 ]] || exit 1
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || exit 1
[[ -f "$ROOT/app/scripts/telegram_backup.py" ]] || exit 1
[[ -d "$ROOT/supabase-project" ]] || exit 1
[[ -x /usr/bin/systemd-run ]] || exit 1
[[ -x /usr/bin/python3 ]] || exit 1

docker compose version >/dev/null
docker volume inspect supabase_db-config >/dev/null

install -d -o root -g root -m 700 \
  "$STATE" \
  "$STATE/work" \
  "$STATE/restore-pending" \
  /root/hirbod-backup/restore-snapshots

chmod 700 "$STATE" "$STATE/work" "$STATE/restore-pending"

echo "[PASS] Restore workspace prepared"
echo "[PASS] Docker database volume verified"
echo "[PASS] systemd restore launcher available"
