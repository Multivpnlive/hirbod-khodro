#!/usr/bin/env python3
import os
import sys
import json
import time
import uuid
import glob
import fcntl
import shutil
import tarfile
import hashlib
import tempfile
import subprocess
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlencode
import logging
import re

CONFIG = Path("/etc/hirbod/telegram-backup.json")
STATE_DIR = Path("/var/lib/hirbod-backup")
WORK_DIR = STATE_DIR / "work"
STATUS_FILE = STATE_DIR / "status.json"
HISTORY_FILE = STATE_DIR / "history.jsonl"
LOCK_FILE = STATE_DIR / "backup.lock"
LOG_FILE = Path("/var/log/hirbod-backup.log")

DB_CONTAINER = "supabase-db"
MAX_TELEGRAM_DOCUMENT_BYTES = 48_000_000

STATE_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)
os.chmod(STATE_DIR, 0o700)
os.chmod(WORK_DIR, 0o700)

logging.basicConfig(
    filename=str(LOG_FILE),
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s"
)

def now():
    return datetime.now(timezone.utc).isoformat()

def atomic_json(path, value):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)

def read_json(path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default
    except Exception:
        return default

def update_status(**values):
    status = read_json(STATUS_FILE, {}) or {}
    status.update(values)
    status["updated_at"] = now()
    atomic_json(STATUS_FILE, status)

def history(event):
    with HISTORY_FILE.open("a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    os.chmod(HISTORY_FILE, 0o600)

def load_config():
    if not CONFIG.is_file():
        raise RuntimeError("تنظیمات پشتیبان‌گیری ثبت نشده است.")

    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))

    for key in ("bot_token", "chat_id"):
        if not cfg.get(key):
            raise RuntimeError("تنظیمات ربات تلگرام ناقص است.")

    return cfg

def curl_quote(value):
    value = str(value)

    # curl config is line-oriented. Flatten Telegram messages/captions
    # so multiline text cannot break the request configuration.
    value = value.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")

    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'

def telegram_api(cfg, method, forms=None, document=None, query=None, timeout=180):
    token = cfg["bot_token"]
    url = f"https://api.telegram.org/bot{token}/{method}"
    if query:
        url += "?" + urlencode(query)

    lines = [
        f"url = {curl_quote(url)}",
        "silent",
        "show-error",
        "connect-timeout = 20",
        f"max-time = {int(timeout)}",
    ]

    proxy = cfg.get("proxy") or {}
    if proxy.get("mode") == "socks5":
        host = proxy.get("host", "")
        port = int(proxy.get("port", 0))
        lines.append(f"proxy = {curl_quote(f'socks5h://{host}:{port}')}")
        if proxy.get("username"):
            userpass = proxy["username"] + ":" + proxy.get("password", "")
            lines.append(f"proxy-user = {curl_quote(userpass)}")

    for key, value in (forms or {}).items():
        lines.append(f"form-string = {curl_quote(str(key) + '=' + str(value))}")

    if document:
        lines.append(f"form = {curl_quote('document=@' + str(document))}")

    config_text = "\n".join(lines) + "\n"

    last_error = "ارتباط با تلگرام برقرار نشد."
    for attempt in range(3):
        try:
            result = subprocess.run(
                ["curl", "--config", "-"],
                input=config_text,
                text=True,
                capture_output=True,
                timeout=timeout + 15
            )
            if result.returncode != 0:
                last_error = "خطای شبکه در اتصال به تلگرام یا پروکسی."
                time.sleep(2 + attempt * 3)
                continue

            data = json.loads(result.stdout)
            if data.get("ok"):
                return data["result"]

            description = str(data.get("description", "خطای نامشخص تلگرام"))
            params = data.get("parameters") or {}
            retry_after = params.get("retry_after")

            if retry_after and attempt < 2:
                time.sleep(min(int(retry_after), 30))
                continue

            if data.get("error_code", 0) >= 500 and attempt < 2:
                time.sleep(2 + attempt * 3)
                continue

            raise RuntimeError("تلگرام: " + description[:300])

        except RuntimeError:
            raise
        except Exception:
            last_error = "پاسخی معتبر از تلگرام دریافت نشد."
            time.sleep(2 + attempt * 3)

    raise RuntimeError(last_error)

def test_connection():
    cfg = load_config()
    me = telegram_api(cfg, "getMe")
    chat = telegram_api(cfg, "getChat", query={"chat_id": cfg["chat_id"]})

    msg = (
        "✅ اتصال پشتیبان‌گیری هیربد خودرو برقرار شد.\n"
        "ربات: @" + str(me.get("username", "unknown")) + "\n"
        "مقصد: " + str(chat.get("title") or chat.get("username") or cfg["chat_id"])
    )
    telegram_api(cfg, "sendMessage", forms={
        "chat_id": cfg["chat_id"],
        "text": msg
    })

    return {
        "ok": True,
        "bot_username": me.get("username"),
        "chat_title": chat.get("title") or chat.get("username") or cfg["chat_id"],
        "message": "اتصال ربات و مقصد تأیید شد و پیام آزمایشی ارسال گردید."
    }

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def send_document(cfg, path, caption):
    result = telegram_api(
        cfg,
        "sendDocument",
        forms={
            "chat_id": cfg["chat_id"],
            "caption": caption[:900]
        },
        document=path,
        timeout=240
    )
    return result.get("message_id")

def send_text(cfg, text):
    return telegram_api(
        cfg, "sendMessage",
        forms={"chat_id": cfg["chat_id"], "text": text[:3500]},
        timeout=45
    )


def create_database_dump(path):
    with path.open("wb") as output:
        subprocess.run(
            [
                "docker", "exec", "-u", "postgres", DB_CONTAINER,
                "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc"
            ],
            stdout=output,
            stderr=subprocess.PIPE,
            check=True,
            timeout=600
        )

    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("ساخت نسخه پشتیبان دیتابیس ناموفق بود.")

    with path.open("rb") as source:
        subprocess.run(
            [
                "docker", "exec", "-i", "-u", "postgres",
                DB_CONTAINER, "pg_restore", "-l"
            ],
            stdin=source,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            check=True,
            timeout=120
        )


def globals_roles_from_bytes(data):
    try:
        sql = data.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeError("فایل globals.sql دارای کدگذاری نامعتبر است.") from exc

    matches = re.findall(
        r'(?im)^\s*CREATE\s+ROLE\s+(?:"([^"]+)"|([^\s;]+))',
        sql
    )
    roles = sorted({quoted or plain for quoted, plain in matches})

    required_roles = {
        "anon",
        "authenticated",
        "authenticator",
        "service_role",
        "supabase_admin",
        "supabase_auth_admin",
        "supabase_storage_admin",
    }

    missing = sorted(required_roles - set(roles))
    if missing:
        raise RuntimeError(
            "فایل globals.sql ناقص است؛ نقش‌های ضروری PostgreSQL وجود ندارند."
        )

    return roles


def create_globals_dump(path):
    command = [
        "docker", "exec", "-u", "postgres", DB_CONTAINER,
        "sh", "-lc",
        'set +x; export PGPASSWORD="${POSTGRES_PASSWORD:?}"; '
        "exec pg_dumpall -h 127.0.0.1 -U supabase_admin --globals-only"
    ]

    try:
        with path.open("wb") as output:
            subprocess.run(
                command,
                stdout=output,
                stderr=subprocess.PIPE,
                check=True,
                timeout=180
            )
    except subprocess.CalledProcessError as exc:
        path.unlink(missing_ok=True)
        raise RuntimeError(
            "تهیه خروجی نقش‌ها و تنظیمات سراسری PostgreSQL ناموفق بود."
        ) from exc

    os.chmod(path, 0o600)

    if not path.is_file() or path.stat().st_size == 0:
        raise RuntimeError("فایل globals.sql خالی یا نامعتبر است.")

    if path.stat().st_size > 10 * 1024 * 1024:
        raise RuntimeError("حجم globals.sql بیش از حد مجاز است.")

    return globals_roles_from_bytes(path.read_bytes())


def validate_db_config_volume():
    volume = Path("/var/lib/docker/volumes/supabase_db-config/_data")
    key = volume / "pgsodium_root.key"

    if volume.is_symlink() or not volume.is_dir():
        raise RuntimeError("Volume تنظیمات دیتابیس Supabase پیدا نشد.")

    for root, dirs, files in os.walk(volume, followlinks=False):
        for name in dirs + files:
            item = Path(root) / name

            if item.is_symlink():
                raise RuntimeError(
                    "در Volume تنظیمات دیتابیس لینک غیرمجاز وجود دارد."
                )

            if not item.is_dir() and not item.is_file():
                raise RuntimeError(
                    "در Volume تنظیمات دیتابیس فایل غیرمجاز وجود دارد."
                )

    if key.is_symlink() or not key.is_file():
        raise RuntimeError("کلید pgsodium در Volume دیتابیس وجود ندارد.")

    key_size = key.stat().st_size
    if key_size != 64:
        raise RuntimeError("اندازه کلید pgsodium با مقدار مورد انتظار تطابق ندارد.")

    return key_size


def create_archive(work, backup_id):
    dump_path = work / "database.dump"
    globals_path = work / "globals.sql"

    create_database_dump(dump_path)
    globals_roles = create_globals_dump(globals_path)
    pgsodium_key_size = validate_db_config_volume()

    storage_path = Path(
        "/opt/hirbod/supabase-project/volumes/storage"
    )

    if storage_path.is_symlink() or not storage_path.is_dir():
        raise RuntimeError("مسیر Storage مربوط به Supabase پیدا نشد.")

    try:
        package = json.loads(
            Path("/opt/hirbod/app/package.json").read_text(encoding="utf-8")
        )
        app_version = package.get("version", "unknown")
    except Exception:
        app_version = "unknown"

    info = {
        "product": "Hirbod Khodro",
        "format": "hirbod-single-file-backup",
        "format_version": 3,
        "backup_id": backup_id,
        "created_at_utc": now(),
        "app_version": app_version,

        "database_dump": "database.dump",
        "database_size": dump_path.stat().st_size,
        "database_format": "PostgreSQL custom archive",

        "globals_dump": "globals.sql",
        "globals_size": globals_path.stat().st_size,
        "globals_format": "pg_dumpall --globals-only SQL",
        "globals_roles": globals_roles,

        "db_config_volume": "supabase_db-config",
        "pgsodium_key": "supabase_db-config/pgsodium_root.key",
        "pgsodium_key_size": pgsodium_key_size,

        "storage_included": True,
        "storage_path": "opt/hirbod/supabase-project/volumes/storage",

        "ownership_preserved": True,
        "encrypted": False
    }

    info_path = work / "backup-info.json"
    info_path.write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    os.chmod(info_path, 0o600)

    paths = [
        "opt/hirbod/app",
        "opt/hirbod/supabase-project",
    ]

    optional_paths = [
        "etc/hirbod/hirbod-runtime.env",
        "etc/hirbod/hirbod-admin.env",
        "etc/hirbod/telegram-backup.json",
        "etc/caddy/Caddyfile",
        "etc/systemd/system/hirbod-app.service",
        "etc/systemd/system/hirbod-app.service.d",
        "etc/systemd/system/hirbod-telegram-backup.service",
        "etc/systemd/system/hirbod-telegram-backup-scheduled.service",
        "etc/systemd/system/hirbod-telegram-backup.timer",
    ]

    for item in optional_paths:
        if Path("/" + item).exists():
            paths.append(item)

    archive = work / f"hirbod-{backup_id}.hirbod"
    db_config_parent = Path(
        "/var/lib/docker/volumes/supabase_db-config"
    )

    cmd = [
        "tar",
        "--numeric-owner",
        "--acls",
        "--xattrs",
        "--transform=s,^_data,supabase_db-config,",
        "-czf", str(archive),
        "--warning=no-file-changed",

        "--exclude=opt/hirbod/app/.git",
        "--exclude=opt/hirbod/app/node_modules",
        "--exclude=opt/hirbod/app/.output",
        "--exclude=opt/hirbod/app/.output.rollback-*",
        "--exclude=opt/hirbod/app/scripts/__pycache__",
        "--exclude=opt/hirbod/app/.env",
        "--exclude=opt/hirbod/supabase-project/volumes/db/data",

        "-C", str(work),
        "database.dump",
        "globals.sql",
        "backup-info.json",

        "-C", "/",
        *paths,

        "-C", str(db_config_parent),
        "_data",
    ]

    subprocess.run(cmd, check=True, timeout=1800)

    if not archive.is_file() or archive.stat().st_size == 0:
        raise RuntimeError("ساخت فایل بکاپ ناموفق بود.")

    required = {
        "database.dump",
        "globals.sql",
        "backup-info.json",
        "opt/hirbod/app/package.json",
        "opt/hirbod/supabase-project/docker-compose.yml",
        "supabase_db-config/pgsodium_root.key",
    }

    with tarfile.open(archive, "r:gz") as tar:
        members = tar.getmembers()
        names = {member.name for member in members}

        if not required.issubset(names):
            raise RuntimeError(
                "فایل بکاپ ناقص است؛ یک یا چند جزء ضروری پیدا نشدند."
            )

        storage_member = next(
            (
                member for member in members
                if member.name.rstrip("/")
                == "opt/hirbod/supabase-project/volumes/storage"
            ),
            None
        )

        if storage_member is None or not storage_member.isdir():
            raise RuntimeError("پوشه Storage داخل آرشیو پیدا نشد.")

        key_member = next(
            member for member in members
            if member.name == "supabase_db-config/pgsodium_root.key"
        )

        if not key_member.isfile() or key_member.size != pgsodium_key_size:
            raise RuntimeError("کلید pgsodium در آرشیو ناقص است.")

        globals_member = next(
            member for member in members
            if member.name == "globals.sql"
        )

        if globals_member.size != globals_path.stat().st_size:
            raise RuntimeError("فایل globals.sql داخل آرشیو ناقص است.")

        for member in members:
            name = member.name
            if name.startswith("/") or ".." in Path(name).parts:
                raise RuntimeError(
                    "مسیر غیرمجاز در فایل بکاپ شناسایی شد."
                )

    os.chmod(archive, 0o600)
    return archive


def inspect_archive(archive_path):
    from pathlib import PurePosixPath

    archive_path = Path(archive_path).resolve(strict=True)

    if not archive_path.is_file():
        raise RuntimeError("فایل بکاپ معتبر نیست.")

    if archive_path.suffix.lower() != ".hirbod":
        raise RuntimeError("پسوند فایل باید hirbod باشد.")

    archive_size = archive_path.stat().st_size
    if archive_size < 1024:
        raise RuntimeError("فایل بکاپ بیش از حد کوچک یا ناقص است.")

    if archive_size > 8 * 1024 * 1024 * 1024:
        raise RuntimeError("حجم فایل از محدودیت اعتبارسنجی بیشتر است.")

    required = {
        "database.dump",
        "globals.sql",
        "backup-info.json",
        "opt/hirbod/app/package.json",
        "opt/hirbod/supabase-project/docker-compose.yml",
        "opt/hirbod/supabase-project/.env",
        "etc/hirbod/hirbod-runtime.env",
        "etc/hirbod/hirbod-admin.env",
        "supabase_db-config/pgsodium_root.key",
    }

    database_temp = None

    try:
        with tarfile.open(archive_path, "r:gz") as tar:
            members = tar.getmembers()

            if len(members) > 200000:
                raise RuntimeError("تعداد فایل‌های داخل آرشیو غیرعادی است.")

            names = set()
            total_unpacked = 0
            member_by_name = {}

            for member in members:
                name = member.name
                pure = PurePosixPath(name)

                if pure.is_absolute() or ".." in pure.parts:
                    raise RuntimeError(
                        "مسیر غیرمجاز داخل فایل بکاپ شناسایی شد."
                    )

                if name in names:
                    raise RuntimeError(
                        "نام تکراری داخل آرشیو شناسایی شد."
                    )
                names.add(name)

                if not (member.isfile() or member.isdir()):
                    raise RuntimeError(
                        "آرشیو دارای لینک یا فایل سیستمی غیرمجاز است."
                    )

                total_unpacked += max(0, member.size)
                if total_unpacked > 12 * 1024 * 1024 * 1024:
                    raise RuntimeError(
                        "حجم استخراج‌شده آرشیو بیش از حد مجاز است."
                    )

                member_by_name[name] = member

            missing = sorted(required - names)
            if missing:
                raise RuntimeError(
                    "اجزای ضروری بکاپ وجود ندارند: " + ", ".join(missing)
                )

            storage_member = next(
                (
                    member for member in members
                    if member.name.rstrip("/")
                    == "opt/hirbod/supabase-project/volumes/storage"
                ),
                None
            )

            if storage_member is None or not storage_member.isdir():
                raise RuntimeError("پوشه Storage داخل بکاپ وجود ندارد.")

            info_member = member_by_name["backup-info.json"]
            if info_member.size > 1024 * 1024:
                raise RuntimeError("فایل مشخصات بکاپ معتبر نیست.")

            info_file = tar.extractfile(info_member)
            if info_file is None:
                raise RuntimeError("خواندن مشخصات بکاپ ناموفق بود.")

            info = json.loads(info_file.read().decode("utf-8"))

            if info.get("product") != "Hirbod Khodro":
                raise RuntimeError("این فایل متعلق به هیربد خودرو نیست.")

            if info.get("format") != "hirbod-single-file-backup":
                raise RuntimeError("فرمت فایل بکاپ پشتیبانی نمی‌شود.")

            if info.get("format_version") != 3:
                raise RuntimeError("نسخه فرمت بکاپ پشتیبانی نمی‌شود.")

            if info.get("encrypted") is not False:
                raise RuntimeError(
                    "وضعیت رمزگذاری فایل قابل قبول نیست."
                )

            if info.get("storage_included") is not True:
                raise RuntimeError(
                    "مشخصات بکاپ، وجود Storage را تأیید نمی‌کند."
                )

            if info.get("storage_path") != (
                "opt/hirbod/supabase-project/volumes/storage"
            ):
                raise RuntimeError("مسیر Storage در مشخصات بکاپ معتبر نیست.")

            if info.get("db_config_volume") != "supabase_db-config":
                raise RuntimeError(
                    "مشخصات Volume تنظیمات دیتابیس معتبر نیست."
                )

            if info.get("pgsodium_key") != (
                "supabase_db-config/pgsodium_root.key"
            ):
                raise RuntimeError("مسیر کلید pgsodium معتبر نیست.")

            db_member = member_by_name["database.dump"]
            if db_member.size <= 0:
                raise RuntimeError("فایل دیتابیس خالی است.")

            if info.get("database_size") != db_member.size:
                raise RuntimeError(
                    "اندازه دیتابیس با مشخصات بکاپ تطابق ندارد."
                )

            if info.get("database_dump") != "database.dump":
                raise RuntimeError(
                    "مسیر فایل دیتابیس در مشخصات بکاپ معتبر نیست."
                )

            globals_member = member_by_name["globals.sql"]

            if globals_member.size <= 0:
                raise RuntimeError("فایل globals.sql خالی است.")

            if globals_member.size > 10 * 1024 * 1024:
                raise RuntimeError("حجم globals.sql بیش از حد مجاز است.")

            if info.get("globals_dump") != "globals.sql":
                raise RuntimeError(
                    "مسیر globals.sql در مشخصات بکاپ معتبر نیست."
                )

            if info.get("globals_size") != globals_member.size:
                raise RuntimeError(
                    "اندازه globals.sql با مشخصات بکاپ تطابق ندارد."
                )

            globals_stream = tar.extractfile(globals_member)
            if globals_stream is None:
                raise RuntimeError("خواندن globals.sql ناموفق بود.")

            globals_data = globals_stream.read(10 * 1024 * 1024 + 1)
            if len(globals_data) > 10 * 1024 * 1024:
                raise RuntimeError("حجم globals.sql بیش از حد مجاز است.")

            globals_roles = globals_roles_from_bytes(globals_data)

            manifest_roles = info.get("globals_roles")
            if not isinstance(manifest_roles, list):
                raise RuntimeError(
                    "فهرست نقش‌های PostgreSQL در مشخصات بکاپ معتبر نیست."
                )

            if sorted(set(manifest_roles)) != globals_roles:
                raise RuntimeError(
                    "فهرست نقش‌ها با محتوای globals.sql تطابق ندارد."
                )

            key_member = member_by_name[
                "supabase_db-config/pgsodium_root.key"
            ]

            if not key_member.isfile() or key_member.size != 64:
                raise RuntimeError("کلید pgsodium ناقص یا نامعتبر است.")

            if info.get("pgsodium_key_size") != key_member.size:
                raise RuntimeError(
                    "اندازه کلید pgsodium با مشخصات بکاپ تطابق ندارد."
                )

            db_stream = tar.extractfile(db_member)
            if db_stream is None:
                raise RuntimeError("خواندن فایل دیتابیس ناموفق بود.")

            fd, temp_name = tempfile.mkstemp(
                prefix="restore-inspect-",
                suffix=".dump",
                dir=str(WORK_DIR),
            )
            database_temp = Path(temp_name)
            os.chmod(database_temp, 0o600)

            with os.fdopen(fd, "wb") as output:
                shutil.copyfileobj(
                    db_stream,
                    output,
                    length=1024 * 1024
                )

        # فقط فهرست آرشیو PostgreSQL خوانده می‌شود؛ دیتابیس تغییر نمی‌کند.
        with database_temp.open("rb") as source:
            subprocess.run(
                [
                    "docker", "exec", "-i", "-u", "postgres",
                    DB_CONTAINER, "pg_restore", "-l",
                ],
                stdin=source,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                check=True,
                timeout=180,
            )

        return {
            "ok": True,
            "valid": True,
            "backup_id": info.get("backup_id"),
            "created_at_utc": info.get("created_at_utc"),
            "app_version": info.get("app_version"),
            "database_size": db_member.size,
            "globals_size": globals_member.size,
            "globals_roles_count": len(globals_roles),
            "pgsodium_key_size": key_member.size,
            "storage_included": True,
            "archive_size": archive_size,
            "encrypted": False,
            "format_version": 3,
            "message": "ساختار بکاپ نسخه ۳ و آرشیو دیتابیس معتبر است.",
        }

    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode(
            "utf-8", errors="replace"
        )[-800:]

        raise RuntimeError(
            "PostgreSQL نتوانست آرشیو دیتابیس را بخواند: " + detail
        )

    except (tarfile.TarError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise RuntimeError(
            "ساختار فایل بکاپ خراب یا غیرقابل‌خواندن است."
        ) from exc

    finally:
        if database_temp:
            database_temp.unlink(missing_ok=True)


def run_backup(force=False):
    cfg = load_config()

    if not force and not cfg.get("enabled"):
        return {"skipped": True, "message": "بکاپ خودکار غیرفعال است."}

    with LOCK_FILE.open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"skipped": True, "message": "یک عملیات بکاپ در حال اجراست."}

        backup_id = (
            datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            + "-" + uuid.uuid4().hex[:8]
        )

        work = Path(tempfile.mkdtemp(prefix=backup_id + "-", dir=WORK_DIR))
        os.chmod(work, 0o700)

        previous = read_json(STATUS_FILE, {}) or {}

        update_status(
            state="running",
            backup_id=backup_id,
            started_at=now(),
            finished_at=None,
            last_error=None,
            message="ساخت فایل بکاپ تک‌فایلی آغاز شد."
        )

        logging.info("Backup %s started", backup_id)

        try:
            archive = create_archive(work, backup_id)
            total_size = archive.stat().st_size
            archive_hash = sha256_file(archive)
            filename = archive.name

            if total_size > MAX_TELEGRAM_DOCUMENT_BYTES:
                outbox = STATE_DIR / "outbox"
                outbox.mkdir(parents=True, exist_ok=True)
                os.chmod(outbox, 0o700)

                retained = outbox / filename
                shutil.copy2(archive, retained)
                os.chmod(retained, 0o600)

                raise RuntimeError(
                    f"حجم بکاپ {total_size} بایت است و از سقف ارسال تلگرام "
                    f"بیشتر است. فایل کامل روی سرور نگهداری شد: {retained}"
                )

            caption = (
                f"Hirbod Khodro backup\n"
                f"ID: {backup_id}\n"
                f"Format: single .hirbod file\n"
                f"Size: {total_size} bytes"
            )

            message_id = send_document(cfg, archive, caption)

            send_text(
                cfg,
                "✅ بکاپ هیربد خودرو با موفقیت ارسال شد.\n"
                f"شناسه: {backup_id}\n"
                f"فایل: {filename}\n"
                f"حجم: {total_size} bytes"
            )

            finished = now()

            result = {
                "state": "success",
                "backup_id": backup_id,
                "started_at": read_json(STATUS_FILE, {}).get("started_at"),
                "finished_at": finished,
                "last_success_at": finished,
                "file_name": filename,
                "total_size": total_size,
                "total_parts": 1,
                "sent_parts": 1,
                "sha256": archive_hash,
                "telegram_message_id": message_id,
                "last_error": None,
                "message": "فایل بکاپ تک‌فایلی و بدون رمزگذاری به تلگرام ارسال شد."
            }

            update_status(**result)
            history(result)
            logging.info(
                "Backup %s completed as one file (%s bytes)",
                backup_id, total_size
            )

            return result

        except Exception as exc:
            message = str(exc)[:500]
            finished = now()

            failure = {
                "state": "failed",
                "backup_id": backup_id,
                "finished_at": finished,
                "last_success_at": previous.get("last_success_at"),
                "last_error": message,
                "message": "ساخت یا ارسال فایل بکاپ ناموفق بود."
            }

            update_status(**failure)
            history(failure)
            logging.exception("Backup %s failed", backup_id)

            try:
                send_text(
                    cfg,
                    "🔴 خطا در پشتیبان‌گیری هیربد خودرو\n"
                    f"شناسه: {backup_id}\n"
                    f"خطا: {message[:700]}"
                )
            except Exception:
                pass

            raise

        finally:
            shutil.rmtree(work, ignore_errors=True)






def restore_archive_v3(archive_path, job_id):
    """
    Restore a verified v3 archive on an existing or freshly installed VPS.
    The recovery window is enabled only by install.sh.
    """
    if os.geteuid() != 0:
        raise RuntimeError("بازیابی باید با دسترسی مدیر سیستم اجرا شود.")

    if not re.fullmatch(r"[0-9a-f-]{36}", job_id):
        raise RuntimeError("شناسه عملیات بازیابی معتبر نیست.")

    restore_lock = STATE_DIR / "restore-running.lock"
    lock_info = read_json(restore_lock, {}) or {}
    if lock_info.get("job_id") != job_id:
        raise RuntimeError("مجوز اجرای این عملیات بازیابی معتبر نیست.")

    pending = Path("/var/lib/hirbod-backup/restore-pending")
    archive_path = Path(archive_path).resolve(strict=True)

    if archive_path.parent != pending.resolve():
        raise RuntimeError("مسیر فایل بازیابی مجاز نیست.")

    inspection = inspect_archive(archive_path)
    if not inspection.get("valid") or inspection.get("format_version") != 3:
        raise RuntimeError("فایل بکاپ نسخه ۳ معتبر نیست.")

    app_dir = Path("/opt/hirbod/app")
    project_dir = Path("/opt/hirbod/supabase-project")
    status_file = STATE_DIR / "restore-status.json"
    log_file = STATE_DIR / ("restore-" + job_id + ".log")

    snapshot_root = Path("/root/hirbod-backup/restore-snapshots")
    snapshot = snapshot_root / job_id
    stage = WORK_DIR / ("restore-" + job_id)

    volume_name = "supabase_db-config"
    volume_mount = None
    old_app = snapshot / "old-app"
    old_project = snapshot / "old-supabase-project"
    old_volume = snapshot / "old-db-config"

    moved_app = False
    moved_project = False
    replaced_volume = False
    switched_configs = False

    def progress(state, step, percent, message, error=None):
        atomic_json(status_file, {
            "job_id": job_id,
            "state": state,
            "step": step,
            "progress": percent,
            "message": message,
            "error": error,
            "updated_at": now(),
        })

    def run_logged(command, cwd=None, timeout=1800, stdin=None):
        with log_file.open("ab") as output:
            subprocess.run(
                command,
                cwd=str(cwd) if cwd else None,
                stdin=stdin,
                stdout=output,
                stderr=output,
                check=True,
                timeout=timeout,
            )

    def copy_tree_preserving_owner(source, target):
        source = Path(source)
        target = Path(target)

        shutil.copytree(
            source,
            target,
            dirs_exist_ok=True,
            copy_function=shutil.copy2,
            symlinks=False,
        )

        for root, dirs, files in os.walk(source):
            for name in dirs + files:
                src_item = Path(root) / name
                dst_item = target / src_item.relative_to(source)
                st = src_item.stat()
                os.chown(dst_item, st.st_uid, st.st_gid)

    def replace_tree(source, target):
        source = Path(source)
        target = Path(target)

        if target.exists():
            if target.is_dir():
                shutil.rmtree(target)
            else:
                target.unlink()

        shutil.move(str(source), str(target))

    def restore_config_file(source, target):
        source = Path(source)
        target = Path(target)

        if not source.exists():
            return

        target.parent.mkdir(parents=True, exist_ok=True)

        if source.is_dir():
            replace_tree(source, target)
        else:
            shutil.copy2(source, target)

    def compose(action):
        run_logged(
            ["docker", "compose", action, "-d", "--pull", "never"]
            if action == "up"
            else ["docker", "compose", action, "--remove-orphans"],
            cwd=project_dir,
            timeout=900,
        )

    def restore_backup_timer_state():
        state_path = snapshot / "backup-timer-state.json"
        state = read_json(state_path, {}) or {}
        timer = "hirbod-telegram-backup.timer"

        if not state:
            return

        subprocess.run(
            ["systemctl", "stop", timer],
            capture_output=True,
            timeout=60,
            check=True,
        )

        enabled = state.get("enabled")
        if enabled == "enabled":
            run_logged(["systemctl", "enable", timer], timeout=60)
        elif enabled == "disabled":
            subprocess.run(
                ["systemctl", "disable", timer],
                capture_output=True,
                timeout=60,
                check=True,
            )

        if state.get("active"):
            run_logged(["systemctl", "start", timer], timeout=60)
        else:
            subprocess.run(
                ["systemctl", "stop", timer],
                capture_output=True,
                timeout=60,
                check=True,
            )

    progress("running", "precheck", 3, "کنترل اولیه سرور و فایل بکاپ")

    if not app_dir.is_dir() or not project_dir.is_dir():
        raise RuntimeError("برنامه پایه یا پروژه Supabase نصب نشده است.")

    snapshot.mkdir(parents=True, mode=0o700)
    stage.mkdir(parents=True, mode=0o700)

    try:
        progress("running", "snapshot", 8, "ذخیره وضعیت اضطراری سرور مقصد")

        if volume_name not in subprocess.run(
            ["docker", "volume", "ls", "--format", "{{.Name}}"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.splitlines():
            raise RuntimeError("Volume تنظیمات دیتابیس مقصد پیدا نشد.")

        volume_mount = subprocess.run(
            [
                "docker", "volume", "inspect",
                "--format", "{{.Mountpoint}}",
                volume_name,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

        if not volume_mount or not Path(volume_mount).is_dir():
            raise RuntimeError("مسیر Volume دیتابیس معتبر نیست.")

        copy_tree_preserving_owner(volume_mount, old_volume)

        if Path("/etc/hirbod").is_dir():
            shutil.copytree(
                "/etc/hirbod",
                snapshot / "etc-hirbod",
                dirs_exist_ok=True,
                symlinks=False,
            )

        for config in (
            "/etc/caddy/Caddyfile",
            "/etc/systemd/system/hirbod-app.service",
            "/etc/systemd/system/hirbod-telegram-backup.service",
            "/etc/systemd/system/hirbod-telegram-backup-scheduled.service",
            "/etc/systemd/system/hirbod-telegram-backup.timer",
        ):
            path = Path(config)
            if path.is_file():
                destination = snapshot / "config" / path.relative_to("/")
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, destination)

        dropin = Path("/etc/systemd/system/hirbod-app.service.d")
        if dropin.is_dir():
            shutil.copytree(
                dropin,
                snapshot / "config/etc/systemd/system/hirbod-app.service.d",
                dirs_exist_ok=True,
                symlinks=False,
            )

        progress("running", "extract", 15, "استخراج و کنترل فایل‌های بکاپ")

        run_logged(
            [
                "tar",
                "--extract",
                "--gzip",
                "--file", str(archive_path),
                "--directory", str(stage),
                "--numeric-owner",
                "--same-owner",
                "--acls",
                "--xattrs",
            ],
            timeout=1800,
        )

        staged_app = stage / "opt/hirbod/app"
        staged_project = stage / "opt/hirbod/supabase-project"
        staged_key_volume = stage / "supabase_db-config"

        for required in (
            staged_app / "package.json",
            staged_app / "package-lock.json",
            staged_project / "docker-compose.yml",
            staged_project / ".env",
            staged_project / "volumes/storage",
            staged_key_volume / "pgsodium_root.key",
            stage / "database.dump",
            stage / "globals.sql",
        ):
            if not required.exists():
                raise RuntimeError(
                    "جزء ضروری برای بازیابی وجود ندارد: " + str(required.name)
                )

        progress("running", "stop", 22, "توقف موقت برنامه و Supabase")

        backup_timer = "hirbod-telegram-backup.timer"
        timer_active = subprocess.run(
            ["systemctl", "is-active", "--quiet", backup_timer],
            check=False,
        ).returncode == 0

        timer_enabled_result = subprocess.run(
            ["systemctl", "is-enabled", backup_timer],
            capture_output=True,
            text=True,
            check=False,
        )

        atomic_json(snapshot / "backup-timer-state.json", {
            "active": timer_active,
            "enabled": timer_enabled_result.stdout.strip(),
        })

        if timer_active:
            run_logged(["systemctl", "stop", backup_timer], timeout=60)

        # Wait for an already-started backup job to finish before stopping PostgreSQL.
        backup_jobs = (
            "hirbod-telegram-backup.service",
            "hirbod-telegram-backup-scheduled.service",
        )
        while True:
            active_jobs = [
                unit for unit in backup_jobs
                if subprocess.run(
                    ["systemctl", "is-active", "--quiet", unit],
                    check=False,
                ).returncode == 0
            ]
            if not active_jobs:
                break
            time.sleep(2)

        subprocess.run(
            ["systemctl", "stop", "hirbod-app.service"],
            check=False,
            timeout=60,
        )

        run_logged(
            ["docker", "compose", "down", "--remove-orphans"],
            cwd=project_dir,
            timeout=900,
        )

        progress("running", "replace-files", 30, "جایگزینی برنامه و تنظیمات Supabase")

        shutil.move(str(app_dir), str(old_app))
        moved_app = True

        shutil.move(str(project_dir), str(old_project))
        moved_project = True

        shutil.move(str(staged_app), str(app_dir))
        shutil.move(str(staged_project), str(project_dir))

        # Prefer the server-persistent overlay; on a replacement VPS,
        # use the verified overlay carried inside the uploaded archive.
        overlay_candidates = (
            Path("/usr/local/lib/hirbod-restore/overlay"),
            app_dir / "deploy/restore-overlay",
        )
        overlay_root = None

        for candidate in overlay_candidates:
            candidate_manifest = candidate / "manifest.json"
            if candidate.is_symlink() or not candidate.is_dir():
                continue
            if candidate_manifest.is_symlink() or not candidate_manifest.is_file():
                continue
            overlay_root = candidate
            break

        if overlay_root is None:
            raise RuntimeError("فهرست فایل‌های دائمی بازیابی پیدا نشد.")

        overlay_manifest = overlay_root / "manifest.json"
        manifest = json.loads(overlay_manifest.read_text(encoding="utf-8"))
        expected_overlay = (
            "src/routes/api/backup/restore.ts",
            "src/routes/_authenticated/backup.tsx",
            "src/lib/telegram-backup.functions.ts",
            "scripts/telegram_backup.py",
            "scripts/build.mjs",
        )
        entries = manifest.get("files", {})

        if not isinstance(entries, dict) or set(entries) != set(expected_overlay):
            raise RuntimeError("فهرست فایل‌های بازیابی معتبر نیست.")

        import hashlib

        for relative in expected_overlay:
            source_file = overlay_root / relative
            if source_file.is_symlink() or not source_file.is_file():
                raise RuntimeError("فایل دائمی بازیابی پیدا نشد: " + relative)

            digest = hashlib.sha256(source_file.read_bytes()).hexdigest()
            if entries.get(relative) != digest:
                raise RuntimeError("کنترل صحت فایل بازیابی ناموفق بود: " + relative)

            destination = app_dir / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_file, destination)
            os.chmod(destination, 0o644)

        (project_dir / "volumes/db/data").mkdir(
            parents=True,
            exist_ok=True,
            mode=0o700,
        )

        progress("running", "restore-config", 40, "بازگردانی تنظیمات و کلیدهای سرور")

        # Keep host-specific Caddy and systemd units from the destination.
        # Restore application secrets and Telegram configuration only.
        config_items = (
            ("etc/hirbod/hirbod-runtime.env", "/etc/hirbod/hirbod-runtime.env"),
            ("etc/hirbod/hirbod-admin.env", "/etc/hirbod/hirbod-admin.env"),
            ("etc/hirbod/telegram-backup.json", "/etc/hirbod/telegram-backup.json"),
        )

        for source, target in config_items:
            restore_config_file(stage / source, target)

        # Restore the pgsodium named-volume content while Docker is stopped.
        # Mark before deletion so partial failures trigger rollback.
        replaced_volume = True
        for item in Path(volume_mount).iterdir():
            if item.is_dir() and not item.is_symlink():
                shutil.rmtree(item)
            else:
                item.unlink()

        copy_tree_preserving_owner(staged_key_volume, volume_mount)
        switched_configs = True

        # Older archives may still specify "vite build" directly.
        # Ensure every restored version uses the environment-aware builder.
        package_json_path = app_dir / "package.json"
        package_data = json.loads(package_json_path.read_text(encoding="utf-8"))
        package_scripts = package_data.setdefault("scripts", {})
        if not isinstance(package_scripts, dict):
            raise RuntimeError("ساختار scripts در package.json معتبر نیست.")
        package_scripts["build"] = "node scripts/build.mjs"
        package_json_path.write_text(
            json.dumps(package_data, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

        progress("running", "build", 48, "نصب وابستگی‌ها و ساخت برنامه")

        run_logged(
            ["npm", "ci"],
            cwd=app_dir,
            timeout=2400,
        )

        run_logged(
            ["npm", "run", "build"],
            cwd=app_dir,
            timeout=2400,
        )

        progress("running", "database-start", 60, "راه‌اندازی دیتابیس Supabase")

        run_logged(
            ["docker", "compose", "up", "-d", "--pull", "never", "db"],
            cwd=project_dir,
            timeout=900,
        )

        healthy = False
        for _ in range(120):
            state = subprocess.run(
                [
                    "docker", "inspect",
                    "--format",
                    "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}",
                    DB_CONTAINER,
                ],
                capture_output=True,
                text=True,
            ).stdout.strip()

            if state == "running healthy":
                healthy = True
                break

            if state.startswith("exited") or state.startswith("dead"):
                break

            time.sleep(3)

        if not healthy:
            raise RuntimeError("دیتابیس Supabase پس از راه‌اندازی سالم نشد.")

        progress("running", "globals", 68, "بازیابی نقش‌ها و دسترسی‌های PostgreSQL")

        globals_path = stage / "globals.sql"
        globals_sql = globals_path.read_text(encoding="utf-8")

        roles_result = subprocess.run(
            [
                "docker", "exec", "-u", "postgres", DB_CONTAINER,
                "psql", "-X", "-U", "supabase_admin",
                "-d", "postgres", "-Atc",
                "SELECT rolname FROM pg_roles",
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=120,
        )

        existing_roles = set(roles_result.stdout.splitlines())

        role_pattern = re.compile(
            r'(?im)^\s*CREATE\s+ROLE\s+(?:"([^"]+)"|([^\s;]+))\s*;\s*$'
        )

        def keep_missing_create(match):
            role_name = match.group(1) or match.group(2)
            return "" if role_name in existing_roles else match.group(0)

        globals_sql = role_pattern.sub(keep_missing_create, globals_sql)

        globals_import = stage / "globals-import.sql"
        globals_import.write_text(globals_sql, encoding="utf-8")
        os.chmod(globals_import, 0o600)

        with globals_import.open("rb") as source:
            run_logged(
                [
                    "docker", "exec", "-i", "-u", "postgres",
                    DB_CONTAINER,
                    "psql", "-X", "-v", "ON_ERROR_STOP=1",
                    "-U", "supabase_admin", "-d", "postgres",
                ],
                stdin=source,
                timeout=600,
            )

        progress("running", "database-restore", 75, "بازیابی کامل اطلاعات دیتابیس")

        with (stage / "database.dump").open("rb") as source:
            run_logged(
                [
                    "docker", "exec", "-i", "-u", "postgres",
                    DB_CONTAINER,
                    "pg_restore",
                    "--username=supabase_admin",
                    "--dbname=postgres",
                    "--clean",
                    "--if-exists",
                    "--single-transaction",
                    "--exit-on-error",
                ],
                stdin=source,
                timeout=2400,
            )

        progress("running", "services-start", 87, "راه‌اندازی سرویس‌های Supabase")

        compose_command = [
            "docker", "compose", "up", "-d", "--pull", "never"
        ]

        for attempt in range(1, 4):
            try:
                run_logged(
                    compose_command,
                    cwd=project_dir,
                    timeout=1800,
                )
                break
            except subprocess.CalledProcessError:
                if attempt == 3:
                    raise

                with log_file.open("ab") as output:
                    output.write(
                        f"\nCompose startup attempt {attempt} failed; "
                        f"retrying after {15 * attempt} seconds.\n".encode()
                    )

                time.sleep(15 * attempt)

        progress("running", "systemd", 92, "فعال‌سازی سرویس‌های برنامه و وب")

        run_logged(["systemctl", "daemon-reload"], timeout=60)
        run_logged(["systemctl", "enable", "docker", "caddy", "hirbod-app.service"], timeout=60)
        run_logged(["systemctl", "restart", "caddy"], timeout=120)
        run_logged(["systemctl", "restart", "hirbod-app.service"], timeout=120)

        backup_config = Path("/etc/hirbod/telegram-backup.json")
        if backup_config.is_file():
            try:
                cfg = json.loads(backup_config.read_text(encoding="utf-8"))
                if cfg.get("enabled"):
                    run_logged(
                        ["systemctl", "enable", "--now", "hirbod-telegram-backup.timer"],
                        timeout=60,
                    )
                else:
                    subprocess.run(
                        ["systemctl", "disable", "--now", "hirbod-telegram-backup.timer"],
                        capture_output=True,
                        timeout=60,
                    )
            except Exception:
                restore_backup_timer_state()
        else:
            restore_backup_timer_state()

        progress("running", "health", 97, "بررسی سلامت نهایی سایت")

        app_ok = False
        for _ in range(60):
            probe = subprocess.run(
                [
                    "curl", "-sS", "-o", "/dev/null",
                    "-w", "%{http_code}",
                    "http://127.0.0.1:3000/",
                ],
                capture_output=True,
                text=True,
                timeout=15,
            )

            if probe.returncode == 0 and probe.stdout.strip()[:1] in ("2", "3", "4"):
                app_ok = True
                break

            time.sleep(3)

        if not app_ok:
            raise RuntimeError("برنامه پس از بازیابی پاسخ سالم نداد.")

        archive_path.unlink(missing_ok=True)

        progress("success", "complete", 100, "بازیابی کامل با موفقیت انجام شد.")
        restore_lock.unlink(missing_ok=True)

        shutil.rmtree(stage, ignore_errors=True)

        return {
            "ok": True,
            "valid": True,
            "job_id": job_id,
            "state": "success",
            "message": "بازیابی کامل سامانه با موفقیت انجام شد.",
        }

    except Exception as exc:
        progress("rolling_back", "rollback", 0, "بازیابی ناموفق بود؛ بازگرداندن وضعیت اضطراری")

        try:
            subprocess.run(
                ["systemctl", "stop", "hirbod-app.service"],
                capture_output=True,
                timeout=60,
            )

            if project_dir.is_dir():
                subprocess.run(
                    ["docker", "compose", "down", "--remove-orphans"],
                    cwd=project_dir,
                    capture_output=True,
                    timeout=900,
                )

            failed_app = snapshot / "failed-app"
            failed_project = snapshot / "failed-supabase-project"

            if moved_app:
                if app_dir.exists():
                    shutil.move(str(app_dir), str(failed_app))
                if old_app.exists():
                    shutil.move(str(old_app), str(app_dir))

            if moved_project:
                if project_dir.exists():
                    shutil.move(str(project_dir), str(failed_project))
                if old_project.exists():
                    shutil.move(str(old_project), str(project_dir))

            if replaced_volume and old_volume.exists() and volume_mount:
                for item in Path(volume_mount).iterdir():
                    if item.is_dir() and not item.is_symlink():
                        shutil.rmtree(item)
                    else:
                        item.unlink()
                copy_tree_preserving_owner(old_volume, volume_mount)

            if (snapshot / "etc-hirbod").is_dir():
                shutil.rmtree("/etc/hirbod", ignore_errors=True)
                shutil.copytree(snapshot / "etc-hirbod", "/etc/hirbod")

            saved_configs = snapshot / "config"
            if saved_configs.is_dir():
                for root, dirs, files in os.walk(saved_configs):
                    relative = Path(root).relative_to(saved_configs)
                    destination = Path("/") / relative

                    destination.mkdir(parents=True, exist_ok=True)

                    for name in files:
                        shutil.copy2(Path(root) / name, destination / name)

            subprocess.run(
                ["systemctl", "daemon-reload"],
                capture_output=True,
                timeout=60,
            )

            subprocess.run(
                ["docker", "compose", "up", "-d"],
                cwd=project_dir,
                capture_output=True,
                timeout=1200,
            )

            subprocess.run(
                ["systemctl", "restart", "caddy", "hirbod-app.service"],
                capture_output=True,
                timeout=120,
            )

            restore_backup_timer_state()

        except Exception as rollback_error:
            progress(
                "rollback_failed",
                "manual_recovery",
                0,
                "بازیابی و بازگشت خودکار کامل نشد؛ نسخه اضطراری حفظ شده است.",
                str(rollback_error)[:500],
            )
            raise RuntimeError(
                "بازیابی ناموفق بود و بازگشت خودکار هم کامل نشد. "
                "نسخه اضطراری در " + str(snapshot) + " حفظ شده است."
            ) from exc

        progress(
            "failed",
            "rolled_back",
            0,
            "بازیابی ناموفق بود و وضعیت قبلی مقصد بازگردانده شد.",
            str(exc)[:500],
        )
        restore_lock.unlink(missing_ok=True)

        raise RuntimeError(
            "بازیابی ناموفق بود؛ وضعیت قبلی مقصد بازگردانده شد. "
            "گزارش: " + str(log_file)
        ) from exc

def scheduled():
    cfg = load_config()
    if not cfg.get("enabled"):
        return {"skipped": True, "message": "بکاپ خودکار غیرفعال است."}

    hours = int(cfg.get("schedule_hours", 4))
    status = read_json(STATUS_FILE, {}) or {}
    last = status.get("last_success_at")

    if last:
        try:
            previous = datetime.fromisoformat(last.replace("Z", "+00:00"))
            elapsed = (datetime.now(timezone.utc) - previous).total_seconds()
            if elapsed < hours * 3600:
                return {"skipped": True, "message": "زمان بکاپ بعدی هنوز نرسیده است."}
        except Exception:
            pass

    return run_backup(force=False)

def main():
    if len(sys.argv) < 2:
        print("Usage: telegram_backup.py test|backup|scheduled|inspect <file.hirbod>|restore <file.hirbod> <job-id>")
        return 2

    action = sys.argv[1]
    try:
        if action == "test":
            print(json.dumps(test_connection(), ensure_ascii=False))
        elif action == "backup":
            print(json.dumps(run_backup(force=True), ensure_ascii=False))
        elif action == "scheduled":
            print(json.dumps(scheduled(), ensure_ascii=False))
        elif action == "inspect":
            if len(sys.argv) != 3:
                raise RuntimeError("مسیر فایل hirbod را مشخص کنید.")
            print(json.dumps(inspect_archive(sys.argv[2]), ensure_ascii=False))
        elif action == "restore":
            if len(sys.argv) != 4:
                raise RuntimeError("مسیر فایل و شناسه عملیات بازیابی لازم است.")
            print(json.dumps(
                restore_archive_v3(sys.argv[2], sys.argv[3]),
                ensure_ascii=False
            ))
        else:
            print("Unknown action")
            return 2
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:500]}, ensure_ascii=False))
        return 1

if __name__ == "__main__":
    sys.exit(main())
