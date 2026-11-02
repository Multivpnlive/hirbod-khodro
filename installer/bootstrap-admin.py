#!/usr/bin/env python3
import os
import re
import sys
import json
import getpass
import fcntl
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path("/opt/hirbod")
DB = ROOT / "supabase-project"
MARKER = ROOT / ".hirbod-install-in-progress"
STATE = ROOT / "installer-state"
MIGRATIONS = STATE / "migrations"
DONE = STATE / "admin-bootstrap.done"

def stop(message):
    print("[ERROR]", message, file=sys.stderr)
    sys.exit(1)

def read_env(path):
    result = {}
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            result[key.strip()] = value.strip().strip('"').strip("'")
    return result

if os.geteuid() != 0:
    stop("Must run as root")

if not MARKER.is_file():
    stop("Fresh installation marker missing")

if DONE.exists():
    stop("Administrator bootstrap already completed")

for n in range(10):
    if not (MIGRATIONS / f"{n:04d}.done").is_file():
        stop(f"Migration {n:04d} has not completed")

env_path = DB / ".env"
if not env_path.is_file():
    stop("Supabase environment file missing")

env = read_env(env_path)

if env.get("API_GW_HTTP_PORT") != "127.0.0.1:8000":
    stop("API gateway must be bound to 127.0.0.1:8000")

if env.get("DISABLE_SIGNUP", "").lower() != "true":
    stop("Public signup must be disabled before admin bootstrap")

service_key = env.get("SERVICE_ROLE_KEY", "")
if len(service_key) < 100 or service_key.count(".") != 2:
    stop("Legacy Supabase service role JWT is missing or invalid")

STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
lock_path = STATE / "admin-bootstrap.lock"

with lock_path.open("w") as lock:
    os.chmod(lock_path, 0o600)
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stop("Another admin bootstrap process is running")

    query = (
        "SELECT count(*) FROM public.user_roles "
        "WHERE role::text = 'admin';"
    )

    check = subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-X", "-Atq", "-U", "postgres",
         "-d", "postgres", "-c", query],
        cwd=DB, capture_output=True, text=True
    )

    if check.returncode != 0:
        stop("Could not verify database administrator state")

    if check.stdout.strip() != "0":
        stop("An admin already exists; refusing to create another bootstrap user")

    email = input("Initial administrator email: ").strip()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        stop("Invalid email address")

    password = getpass.getpass("Initial administrator password (hidden): ")
    confirm = getpass.getpass("Repeat password (hidden): ")

    if password != confirm:
        stop("Passwords do not match")
    if len(password) < 12:
        stop("Use a password with at least 12 characters")

    payload = json.dumps({
        "email": email,
        "password": password,
        "email_confirm": True
    }).encode()

    request = urllib.request.Request(
        "http://127.0.0.1:8000/auth/v1/admin/users",
        data=payload,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "apikey": service_key,
            "Authorization": "Bearer " + service_key
        }
    )

    del password, confirm, service_key, env

    try:
        with urllib.request.urlopen(request, timeout=25) as response:
            result = json.loads(response.read())
            if response.status not in (200, 201) or not result.get("id"):
                stop("Supabase did not confirm administrator creation")
    except urllib.error.HTTPError as exc:
        stop(f"Supabase admin API returned HTTP {exc.code}")
    except Exception:
        stop("Could not complete administrator creation request")

    verify = subprocess.run(
        ["docker", "compose", "exec", "-T", "db",
         "psql", "-X", "-Atq", "-U", "postgres",
         "-d", "postgres", "-c", query],
        cwd=DB, capture_output=True, text=True
    )

    if verify.returncode != 0 or verify.stdout.strip() != "1":
        stop("User was submitted, but exactly one admin role was not verified")

    temp = DONE.with_suffix(".tmp")
    temp.write_text("completed\n")
    os.chmod(temp, 0o600)
    temp.replace(DONE)

print("[PASS] Initial administrator created")
print("[PASS] Admin role verified in database")
