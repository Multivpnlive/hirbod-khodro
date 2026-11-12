#!/usr/bin/env python3
import os
import re
import sys
import json
import getpass
import subprocess
import tempfile
import ipaddress
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path("/opt/hirbod")
CONFIG = Path("/etc/hirbod/telegram-backup.json")
SCRIPT = ROOT / "app/scripts/telegram_backup.py"

def stop(message):
    print("[ERROR]", message, file=sys.stderr)
    sys.exit(1)

def ask_yes(prompt, default=False):
    suffix = "Y/n" if default else "y/N"
    value = input(f"{prompt} [{suffix}]: ").strip().lower()
    return value in ("y", "yes") if value else default

if os.geteuid() != 0:
    stop("Run as root")

if not (ROOT / ".hirbod-install-in-progress").is_file():
    stop("Fresh-install marker missing")

if not SCRIPT.is_file():
    stop("Telegram backup program is missing")

if CONFIG.exists():
    stop("Telegram configuration already exists; refusing overwrite")

if not ask_yes("Configure Telegram backups now?", False):
    print("[INFO] Telegram backup setup skipped")
    sys.exit(0)

token = getpass.getpass("Telegram bot token (hidden): ").strip()
if not re.fullmatch(r"[0-9]{6,12}:[A-Za-z0-9_-]{20,100}", token):
    stop("Telegram bot token format is invalid")

chat_id = input("Telegram chat ID or @channel username: ").strip()
if not re.fullmatch(r"-?[0-9]{1,25}|@[A-Za-z0-9_]{5,32}", chat_id):
    stop("Telegram chat ID format is invalid")

enabled = ask_yes("Enable automatic Telegram backups?", True)

hours = 4
if enabled:
    raw = input("Backup interval in hours [4]: ").strip()
    if raw:
        try:
            hours = int(raw)
        except ValueError:
            stop("Backup interval must be an integer")
    if not 1 <= hours <= 168:
        stop("Backup interval must be between 1 and 168 hours")

proxy = {"mode": "none"}
if ask_yes("Use a SOCKS5 proxy?", False):
    host = input("SOCKS5 proxy host: ").strip()
    port_raw = input("SOCKS5 proxy port: ").strip()

    try:
        ip = ipaddress.ip_address(host.strip("[]"))
        host = f"[{ip}]" if ip.version == 6 else str(ip)
    except ValueError:
        if not re.fullmatch(r"(?=.{1,253}$)[A-Za-z0-9.-]+", host):
            stop("Invalid SOCKS5 host")

    try:
        port = int(port_raw)
    except ValueError:
        stop("Invalid SOCKS5 port")

    if not 1 <= port <= 65535:
        stop("SOCKS5 port must be between 1 and 65535")

    proxy = {"mode": "socks5", "host": host, "port": port}

    auth = ask_yes("Does the proxy require username/password?", False)
    if auth:
        username = input("Proxy username: ")
        password = getpass.getpass("Proxy password (hidden): ")

        if not username or ":" in username or any(c in username for c in "\r\n"):
            stop("Invalid proxy username")
        if any(c in password for c in "\r\n"):
            stop("Invalid proxy password")

        proxy["username"] = username
        proxy["password"] = password

config = {
    "bot_token": token,
    "chat_id": chat_id,
    "enabled": enabled,
    "schedule_hours": hours,
    "proxy": proxy,
    "updated_at": datetime.now(timezone.utc).isoformat(),
}

del token
if "password" in proxy:
    pass

CONFIG.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(CONFIG.parent, 0o700)

fd, temp = tempfile.mkstemp(prefix=".telegram-backup.", dir=CONFIG.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
        f.write("\n")
    os.chmod(temp, 0o600)
    os.replace(temp, CONFIG)
except Exception:
    try:
        os.unlink(temp)
    except OSError:
        pass
    raise

del config, proxy

result = subprocess.run(
    [sys.executable, str(SCRIPT), "test"],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    timeout=150,
)

if result.returncode != 0:
    CONFIG.unlink(missing_ok=True)
    stop("Telegram connection test failed; configuration was removed")

print("[PASS] Telegram bot and destination verified")
print("[PASS] Configuration stored with restricted permissions")
print("[PASS] Automatic backup enabled" if enabled else
      "[INFO] Automatic backup disabled")
