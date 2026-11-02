#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=/opt/hirbod
die() { echo "[ERROR] $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Root required"
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || die "Install marker missing"
[[ -s "$ROOT/app/.output/server/index.mjs" ]] || die "Application build missing"
[[ -f /etc/hirbod/hirbod-runtime.env ]] || die "Runtime environment missing"
[[ -f /etc/hirbod/hirbod-admin.env ]] || die "Admin environment missing"

systemctl daemon-reload
systemctl enable --now hirbod-app.service

for i in $(seq 1 60); do
    if curl -fsS --max-time 3 http://127.0.0.1:3000/ >/dev/null; then
        mkdir -p "$ROOT/installer-state"
        chmod 700 "$ROOT/installer-state"
        printf 'completed\n' > "$ROOT/installer-state/app-started"
        chmod 600 "$ROOT/installer-state/app-started"
        echo "[PASS] Hirbod application is responding"
        exit 0
    fi
    sleep 2
done

die "Application did not become healthy; inspect systemd journal"
