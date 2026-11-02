#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
DB="$ROOT/supabase-project"
ENV="$DB/.env"

[[ "$EUID" -eq 0 ]] || { echo "[ERROR] Root required"; exit 1; }
[[ -f "$ROOT/.hirbod-install-in-progress" ]] || { echo "[ERROR] Fresh install marker missing"; exit 1; }
[[ -f "$ENV" ]] || { echo "[ERROR] Supabase .env missing"; exit 1; }

DOMAIN="${1:-}"
[[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$ ]] || {
  echo "[ERROR] Provide a valid domain, e.g. app.example.com"
  exit 2
}

python3 - "$ENV" "$DOMAIN" <<'PY'
import sys, os, tempfile

path, domain = sys.argv[1:]
values = {
    "SUPABASE_PUBLIC_URL": f"https://{domain}",
    "API_EXTERNAL_URL": f"https://{domain}/auth/v1",
    "SITE_URL": f"https://{domain}",
    "ADDITIONAL_REDIRECT_URLS": f"https://{domain}/**",
    "DISABLE_SIGNUP": "true",
    "API_GW_HTTP_PORT": "127.0.0.1:8000",
}

with open(path, encoding="utf-8") as f:
    lines = f.read().splitlines()

seen = set()
result = []
for line in lines:
    key = line.split("=", 1)[0].strip() if "=" in line else ""
    if key in values:
        if key not in seen:
            result.append(f"{key}={values[key]}")
            seen.add(key)
    else:
        result.append(line)

for key, value in values.items():
    if key not in seen:
        result.append(f"{key}={value}")

directory = os.path.dirname(path)
fd, temp = tempfile.mkstemp(dir=directory, prefix=".env.hirbod.")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write("\n".join(result) + "\n")
    os.chmod(temp, 0o600)
    os.replace(temp, path)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
PY

chmod 600 "$ENV"
echo "[PASS] Domain settings written"
echo "[PASS] Public signup disabled"
echo "[PASS] API gateway restricted to localhost"
