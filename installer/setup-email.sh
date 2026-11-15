#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

ROOT=/opt/hirbod
PROJECT="$ROOT/supabase-project"
APP="$ROOT/app"
ENV_FILE="$PROJECT/.env"
COMPOSE_FILE="$PROJECT/docker-compose.yml"
MAILER_ROOT=/opt/hirbod-mailer
MAILER_ENV=/etc/hirbod-mailer/secrets.env
MAILER_UNIT=/etc/systemd/system/hirbod-mailer.service
MAILER_DROPIN=/etc/systemd/system/hirbod-mailer.service.d/zz-hirbod-docker-gateway.conf
SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_ONLY=0
ASSUME_YES=0

die() { echo "[ERROR] $*" >&2; exit 1; }
pass() { echo "[PASS] $*"; }

while (($#)); do
  case "$1" in
    --check) CHECK_ONLY=1; shift ;;
    --yes) ASSUME_YES=1; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ $EUID -eq 0 ]] || die "Run as root"
[[ -s "$SOURCE_ROOT/scripts/hirbod-mailer.mjs" ]] || die "Mailer source is missing"
[[ -f "$ENV_FILE" && -f "$COMPOSE_FILE" ]] || die "Supabase installation is missing"
docker inspect supabase-auth >/dev/null 2>&1 || die "Supabase Auth container is not running"

read_env_value() {
  local file="$1" key="$2"
  [[ -f "$file" ]] || return 0
  awk -v key="$key" 'index($0, key "=") == 1 { value=substr($0, length(key)+2) } END { printf "%s", value }' "$file"
}

old_api_key="$(read_env_value "$MAILER_ENV" RESEND_API_KEY)"
old_from="$(read_env_value "$MAILER_ENV" HIRBOD_MAIL_FROM)"
old_secret="$(read_env_value "$ENV_FILE" SEND_EMAIL_HOOK_SECRET)"
[[ -n "$old_secret" ]] || old_secret="$(read_env_value "$MAILER_ENV" SEND_EMAIL_HOOK_SECRET)"

if (( CHECK_ONLY )); then
  [[ -n "$old_api_key" && "$old_api_key" == re_* ]] || die "Resend API key is not configured"
  [[ -n "$old_secret" ]] || die "Email hook secret is not configured"
  docker compose -f "$COMPOSE_FILE" config --quiet
  systemctl is-active --quiet hirbod-mailer.service || die "Email service is not active"
  docker exec supabase-auth wget -qO- -T 4 http://host.docker.internal:8787/health >/dev/null ||
    die "Supabase Auth cannot reach the email service"
  pass "Mailer configuration and Supabase Auth connectivity are healthy"
  exit 0
fi

api_key="$old_api_key"
from_address="${old_from:-Hirbod Khodro <no-reply@send.multiroxynet.ir>}"
hook_secret="$old_secret"

if (( ! ASSUME_YES )) && [[ -t 0 && -r /dev/tty ]]; then
  printf 'Resend API key (leave blank to keep current): ' >/dev/tty
  IFS= read -r -s entered_api_key </dev/tty
  printf '\n' >/dev/tty
  [[ -z "$entered_api_key" ]] || api_key="$entered_api_key"
  printf 'Sender identity [%s]: ' "$from_address" >/dev/tty
  IFS= read -r entered_from </dev/tty
  [[ -z "$entered_from" ]] || from_address="$entered_from"
elif [[ -z "$api_key" ]]; then
  die "No terminal is available and the Resend API key is not configured"
fi

[[ "$api_key" =~ ^re_[A-Za-z0-9_-]+$ ]] || die "Invalid Resend API key format"
sender_email="${from_address##*<}"
sender_email="${sender_email%%>*}"
[[ "$sender_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] ||
  die "Sender must be a verified identity such as Hirbod Khodro <no-reply@example.com>"
[[ "$from_address" != *$'\n'* ]] || die "Sender identity contains a newline"
if [[ -z "$hook_secret" ]]; then
  command -v openssl >/dev/null || die "openssl is required to generate the hook secret"
  hook_secret="v1,whsec_$(openssl rand -base64 32 | tr -d '\n')"
fi
IFS='|' read -r -a secret_parts <<< "$hook_secret"
(("${#secret_parts[@]}" > 0)) || die "Invalid Supabase email hook secret"
for secret_part in "${secret_parts[@]}"; do
  [[ "$secret_part" =~ ^v1,whsec_[A-Za-z0-9+/=]+$ ]] || die "Invalid Supabase email hook secret format"
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/root/hirbod-backup/email-setup/$STAMP"
mkdir -m 700 -p "$BACKUP"
targets=("$ENV_FILE" "$COMPOSE_FILE" "$MAILER_ROOT/server.mjs" "$MAILER_ENV" "$MAILER_UNIT" "$MAILER_DROPIN")
for index in "${!targets[@]}"; do
  target="${targets[$index]}"
  mkdir -p "$BACKUP/$index"
  if [[ -e "$target" ]]; then
    cp -a "$target" "$BACKUP/$index/original"
    printf 'present\n' > "$BACKUP/$index/state"
  else
    printf 'absent\n' > "$BACKUP/$index/state"
  fi
done
systemctl is-active --quiet hirbod-mailer.service && mailer_was_active=1 || mailer_was_active=0
systemctl is-enabled --quiet hirbod-mailer.service && mailer_was_enabled=1 || mailer_was_enabled=0
printf '%s %s\n' "$mailer_was_active" "$mailer_was_enabled" > "$BACKUP/service-state"

rollback() {
  local rc=$?
  trap - EXIT
  if (( rc != 0 )); then
    echo "[ROLLBACK] Restoring previous mail configuration..." >&2
    for index in "${!targets[@]}"; do
      target="${targets[$index]}"
      if [[ "$(cat "$BACKUP/$index/state")" == present ]]; then
        rm -rf "$target"
        mkdir -p "$(dirname "$target")"
        cp -a "$BACKUP/$index/original" "$target"
      else
        rm -rf "$target"
      fi
    done
    systemctl daemon-reload >/dev/null 2>&1 || true
    docker compose -f "$COMPOSE_FILE" up -d auth >/dev/null 2>&1 || true
    read -r old_active old_enabled < "$BACKUP/service-state"
    if (( old_enabled )); then systemctl enable hirbod-mailer.service >/dev/null 2>&1 || true
    else systemctl disable hirbod-mailer.service >/dev/null 2>&1 || true; fi
    if (( old_active )); then systemctl restart hirbod-mailer.service >/dev/null 2>&1 || true
    else systemctl stop hirbod-mailer.service >/dev/null 2>&1 || true; fi
    echo "[ROLLBACK] Previous files are saved at $BACKUP" >&2
  fi
  exit "$rc"
}
trap rollback EXIT

install -d -o root -g root -m 0755 "$MAILER_ROOT" /etc/hirbod-mailer
getent group hirbod-mailer >/dev/null || groupadd --system hirbod-mailer
id hirbod-mailer >/dev/null 2>&1 || useradd --system --gid hirbod-mailer --home-dir "$MAILER_ROOT" --shell /usr/sbin/nologin hirbod-mailer
install -o root -g hirbod-mailer -m 0640 "$SOURCE_ROOT/scripts/hirbod-mailer.mjs" "$MAILER_ROOT/server.mjs"

tmp_env="$(mktemp /etc/hirbod-mailer/secrets.env.XXXXXX)"
printf 'RESEND_API_KEY=%s\nSEND_EMAIL_HOOK_SECRET=%s\nHIRBOD_MAIL_FROM=%s\nHIRBOD_MAILER_PORT=8787\n' \
  "$api_key" "$hook_secret" "$from_address" > "$tmp_env"
chown root:hirbod-mailer "$tmp_env"
chmod 0640 "$tmp_env"
mv "$tmp_env" "$MAILER_ENV"
install -o root -g root -m 0644 "$SOURCE_ROOT/installer/templates/hirbod-mailer.service" "$MAILER_UNIT"

export SETUP_MAIL_ENABLED=true
export SETUP_MAIL_URI=http://host.docker.internal:8787/hooks/send-email
export SETUP_MAIL_SECRET="$hook_secret"
python3 - "$ENV_FILE" <<'PYENV'
import os, pathlib, sys
path = pathlib.Path(sys.argv[1])
updates = {
    "GOTRUE_HOOK_SEND_EMAIL_ENABLED": os.environ["SETUP_MAIL_ENABLED"],
    "GOTRUE_HOOK_SEND_EMAIL_URI": os.environ["SETUP_MAIL_URI"],
    "SEND_EMAIL_HOOK_SECRET": os.environ["SETUP_MAIL_SECRET"],
}
lines = path.read_text(encoding="utf-8").splitlines()
seen = set(); result = []
for line in lines:
    key = line.split("=", 1)[0] if "=" in line else ""
    if key in updates:
        if key not in seen:
            result.append(f"{key}={updates[key]}"); seen.add(key)
    else:
        result.append(line)
for key, value in updates.items():
    if key not in seen:
        result.append(f"{key}={value}")
tmp = path.with_name(path.name + ".tmp")
tmp.write_text("\n".join(result) + "\n", encoding="utf-8")
tmp.chmod(0o600)
tmp.replace(path)
PYENV

python3 - "$COMPOSE_FILE" <<'PYCOMPOSE'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1]); lines = path.read_text(encoding="utf-8").splitlines()
try: start = next(i for i,line in enumerate(lines) if line == "  auth:")
except StopIteration: raise SystemExit("Supabase auth service was not found")
end = next((i for i in range(start+1,len(lines)) if re.match(r"^  [A-Za-z0-9_-]+:", lines[i])),len(lines))
block = lines[start:end]
host_line = next((i for i,line in enumerate(block) if "host.docker.internal:" in line),None)
if host_line is not None:
    block[host_line] = '      - "host.docker.internal:host-gateway"'
elif not any(re.match(r"^    extra_hosts:",line) for line in block):
    restart = next((i for i,line in enumerate(block) if re.match(r"^    restart:",line)),None)
    if restart is None: raise SystemExit("Cannot safely place the Docker host mapping")
    block[restart+1:restart+1] = ["    extra_hosts:", '      - "host.docker.internal:host-gateway"']
else:
    hosts = next(i for i,line in enumerate(block) if re.match(r"^    extra_hosts:",line))
    block.insert(hosts+1, '      - "host.docker.internal:host-gateway"')
keys = {
 "GOTRUE_HOOK_SEND_EMAIL_ENABLED": "${GOTRUE_HOOK_SEND_EMAIL_ENABLED:-false}",
 "GOTRUE_HOOK_SEND_EMAIL_URI": "${GOTRUE_HOOK_SEND_EMAIL_URI:-http://host.docker.internal:8787/hooks/send-email}",
 "GOTRUE_HOOK_SEND_EMAIL_SECRETS": "${SEND_EMAIL_HOOK_SECRET:-}",
}
env_start = next((i for i,line in enumerate(block) if line == "    environment:"),None)
if env_start is None: raise SystemExit("Supabase auth environment block was not found")
env_end = next((i for i in range(env_start+1,len(block)) if block[i] and not block[i].startswith("      ") and not block[i].lstrip().startswith("#")),len(block))
present=set()
for i in range(env_start+1,env_end):
    for key,value in keys.items():
        if re.match(r"^      "+re.escape(key)+r":",block[i]):
            block[i]="      "+key+": "+value
            present.add(key)
block[env_end:env_end]=["      "+key+": "+value for key,value in keys.items() if key not in present]
lines[start:end]=block
tmp=path.with_name(path.name+".tmp")
tmp.write_text("\n".join(lines)+"\n",encoding="utf-8")
tmp.chmod(path.stat().st_mode & 0o777)
tmp.replace(path)
PYCOMPOSE

docker compose -f "$COMPOSE_FILE" config --quiet
systemctl daemon-reload
docker compose -f "$COMPOSE_FILE" up -d auth

auth_healthy=0
for attempt in $(seq 1 60); do
  if [[ "$(docker inspect supabase-auth --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]]; then
    auth_healthy=1
    break
  fi
  sleep 1
done
(( auth_healthy )) || die "Supabase Auth did not become healthy after configuration"

gateway="$(docker exec supabase-auth awk '$2 == "host.docker.internal" {print $1; exit}' /etc/hosts | head -n1)"
python3 - "$gateway" <<'PYIP'
import ipaddress,sys
try: ipaddress.IPv4Address(sys.argv[1])
except Exception: raise SystemExit("Docker host-gateway could not be detected")
PYIP
install -d -o root -g root -m 0755 "$(dirname "$MAILER_DROPIN")"
tmp_dropin="$(mktemp "$(dirname "$MAILER_DROPIN")/.gateway.XXXXXX")"
printf '[Service]\nEnvironment=HIRBOD_MAILER_HOST=%s\n' "$gateway" > "$tmp_dropin"
chmod 0644 "$tmp_dropin"
mv "$tmp_dropin" "$MAILER_DROPIN"
systemctl daemon-reload
systemctl enable --now hirbod-mailer.service
systemctl restart hirbod-mailer.service

for attempt in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://$gateway:8787/health" >/dev/null; then break; fi
  sleep 1
done
curl -fsS --max-time 3 "http://$gateway:8787/health" >/dev/null || die "Mailer health check failed"
docker exec supabase-auth wget -qO- -T 4 http://host.docker.internal:8787/health >/dev/null ||
  die "Supabase Auth cannot reach the email service"
systemctl is-active --quiet hirbod-app.service || die "Application service is not active"
docker inspect supabase-auth --format '{{.State.Health.Status}}' | rg -q '^healthy$' ||
  die "Supabase Auth did not return to healthy state"

trap - EXIT
pass "Password-reset email gateway installed and reachable from Supabase Auth"
echo "Previous settings saved at: $BACKUP"
