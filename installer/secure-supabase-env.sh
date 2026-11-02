#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
DB="$ROOT/supabase-project"

[[ "$EUID" -eq 0 ]] || { echo "[ERROR] Root required"; exit 1; }
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || { echo "[ERROR] Install marker missing"; exit 1; }
[[ -f "$DB/.env" ]] || { echo "[ERROR] Supabase .env missing"; exit 1; }

chmod 600 "$DB/.env"

python3 - "$DB/.env" <<'PY'
import sys, json

values = {}
for line in open(sys.argv[1]):
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.rstrip("\n").split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")

required = [
    "JWT_SECRET", "ANON_KEY", "SERVICE_ROLE_KEY",
    "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY",
    "JWT_KEYS", "JWT_JWKS"
]

for key in required:
    if not values.get(key):
        raise SystemExit("[ERROR] Missing generated setting: " + key)

if len(values["JWT_SECRET"]) < 32:
    raise SystemExit("[ERROR] JWT_SECRET is too short")

for key in ("ANON_KEY", "SERVICE_ROLE_KEY"):
    if values[key].count(".") != 2:
        raise SystemExit("[ERROR] Invalid JWT format: " + key)

for key in ("JWT_KEYS", "JWT_JWKS"):
    try:
        json.loads(values[key])
    except Exception:
        raise SystemExit("[ERROR] Invalid JSON setting: " + key)

print("[PASS] Generated Supabase settings verified")
PY

chmod 600 "$DB/.env"
echo "[PASS] Supabase environment file protected"
