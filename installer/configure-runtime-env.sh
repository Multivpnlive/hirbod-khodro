#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
DB="$ROOT/supabase-project"
ENV="$DB/.env"
DIR=/etc/hirbod

[[ $EUID -eq 0 ]] || exit 1
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || exit 1
[[ -f "$ENV" ]] || exit 1
[[ $# -eq 1 ]] || { echo "Usage: configure-runtime-env.sh domain"; exit 2; }

DOMAIN="$1"
[[ "$DOMAIN" =~ ^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$ ]] || exit 2

python3 - "$ENV" "$DIR" "$DOMAIN" <<'PY'
import sys, os, tempfile
from pathlib import Path

envfile, directory, domain = sys.argv[1:]
values = {}

for line in Path(envfile).read_text().splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        values[k.strip()] = v.strip().strip('"').strip("'")

for key in ("SUPABASE_PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"):
    if not values.get(key):
        raise SystemExit("[ERROR] Missing required Supabase setting: " + key)

if values.get("API_GW_HTTP_PORT") != "127.0.0.1:8000":
    raise SystemExit("[ERROR] API gateway is not restricted to localhost")

if values.get("DISABLE_SIGNUP", "").lower() != "true":
    raise SystemExit("[ERROR] Public signup is not disabled")

Path(directory).mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(directory, 0o700)

files = {
    "hirbod-runtime.env": {
        "SUPABASE_INTERNAL_URL": "http://127.0.0.1:8000",
        "SUPABASE_URL": "http://127.0.0.1:8000",
        "SUPABASE_PUBLISHABLE_KEY": values["SUPABASE_PUBLISHABLE_KEY"],
        "VITE_SUPABASE_PUBLISHABLE_KEY": values["SUPABASE_PUBLISHABLE_KEY"],
    },
    "hirbod-admin.env": {
        "SUPABASE_SERVICE_ROLE_KEY": values["SERVICE_ROLE_KEY"],
    },
}

for name, entries in files.items():
    path = Path(directory) / name
    fd, temp = tempfile.mkstemp(dir=directory, prefix=".hirbod-env-")
    try:
        with os.fdopen(fd, "w") as f:
            for key, value in entries.items():
                f.write(f"{key}={value}\n")
        os.chmod(temp, 0o600)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)

print("[PASS] Runtime environment created")
print("[PASS] Admin environment created")
print("[PASS] Secret file permissions restricted")
PY
