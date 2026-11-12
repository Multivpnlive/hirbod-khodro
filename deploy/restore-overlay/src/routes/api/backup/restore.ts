import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

const PENDING = "/var/lib/hirbod-backup/restore-pending";
const STATE_DIR = "/var/lib/hirbod-backup";
const RESTORE_LOCK = `${STATE_DIR}/restore-running.lock`;
const RESTORE_STATUS = `${STATE_DIR}/restore-status.json`;
const SCRIPT = "/opt/hirbod/app/scripts/telegram_backup.py";
const MAX_UPLOAD = 512 * 1024 * 1024;
const INSPECT_TIMEOUT = 5 * 60 * 1000;

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function isRestoreTargetReady(): Promise<boolean> {
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    return false;
  }

  async function safeDirectory(path: string) {
    const info = await lstat(path).catch(() => null);
    return Boolean(info?.isDirectory() && !info.isSymbolicLink());
  }

  async function safeFile(path: string) {
    const info = await lstat(path).catch(() => null);
    return Boolean(info?.isFile() && !info.isSymbolicLink());
  }

  const directories = await Promise.all([
    safeDirectory("/opt/hirbod/app"),
    safeDirectory("/opt/hirbod/supabase-project"),
    safeDirectory(STATE_DIR),
    safeDirectory(PENDING),
  ]);

  if (directories.some((ready) => !ready)) return false;

  if (!(await safeFile(SCRIPT)) || !(await safeFile("/usr/bin/systemd-run"))) {
    return false;
  }

  try {
    const volume = await execFile(
      "/usr/bin/docker",
      ["volume", "inspect", "--format", "{{.Name}}", "supabase_db-config"],
      { timeout: 15000, maxBuffer: 65536 },
    );

    if (String(volume.stdout || "").trim() !== "supabase_db-config") {
      return false;
    }

    await execFile(
      "/usr/bin/docker",
      ["compose", "version"],
      { timeout: 15000, maxBuffer: 65536 },
    );
  } catch {
    return false;
  }

  return true;
}

async function authorizeAdmin(request: Request) {
  const origin = request.headers.get("origin");
  const host =
    request.headers.get("x-forwarded-host") ||
    request.headers.get("host");

  if (!origin || !host) {
    throw new HttpError(403, "درخواست از مبدأ معتبر ارسال نشده است.");
  }

  let originUrl: URL;

  try {
    originUrl = new URL(origin);
  } catch {
    throw new HttpError(403, "مبدأ درخواست معتبر نیست.");
  }

  if (
    originUrl.protocol !== "https:" ||
    originUrl.host.toLowerCase() !== host.split(",")[0].trim().toLowerCase()
  ) {
    throw new HttpError(403, "درخواست باید از پنل اصلی هیربد ارسال شود.");
  }

  const authorization = request.headers.get("authorization") || "";
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);

  if (!match) {
    throw new HttpError(401, "نشست معتبر نیست؛ دوباره وارد شوید.");
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey) {
    throw new HttpError(500, "تنظیمات احراز هویت سرور ناقص است.");
  }

  const client = createClient(supabaseUrl, publishableKey, {
    global: {
      headers: {
        Authorization: authorization,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await client.auth.getClaims(match[1]);
  const userId = String((data as any)?.claims?.sub || "");

  if (error || !userId) {
    throw new HttpError(401, "نشست کاربری معتبر نیست.");
  }

  const { data: role, error: roleError } = await client
    .from("user_roles")
    .select("user_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (roleError || !role) {
    throw new HttpError(403, "فقط مدیر اصلی اجازه بازیابی بکاپ را دارد.");
  }
}

async function cleanupOldUploads() {
  const entries = await readdir(PENDING, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".hirbod")) continue;

    const path = `${PENDING}/${entry.name}`;

    try {
      const details = await stat(path);

      if (Date.now() - details.mtimeMs > 24 * 60 * 60 * 1000) {
        await unlink(path);
      }
    } catch {
      // A concurrently removed file is harmless.
    }
  }
}

async function inspectWithPython(path: string) {
  try {
    const result = await execFile(
      "/usr/bin/python3",
      [SCRIPT, "inspect", path],
      {
        timeout: INSPECT_TIMEOUT,
        maxBuffer: 1024 * 1024,
      },
    );

    const output = String(result.stdout || "").trim();
    const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1);

    if (!lastLine) {
      throw new Error("موتور اعتبارسنجی پاسخ خالی برگرداند.");
    }

    return JSON.parse(lastLine);
  } catch (error: any) {
    const output = String(error?.stdout || "").trim();
    const lastLine = output.split(/\r?\n/).filter(Boolean).at(-1);

    if (lastLine) {
      try {
        const parsed = JSON.parse(lastLine);
        if (parsed.error) throw new Error(parsed.error);
      } catch (parseError: any) {
        if (parseError.message !== "Unexpected end of JSON input") {
          if (parseError instanceof Error && parseError.message !== lastLine) {
            throw parseError;
          }
        }
      }
    }

    throw new HttpError(
      422,
      "اعتبارسنجی فایل بکاپ ناموفق بود. ساختار فایل را بررسی کنید.",
    );
  }
}



async function startRestoreJob(uploadId: string) {
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new HttpError(500, "سرویس برنامه مجوز اجرای بازیابی را ندارد.");
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uploadId)) {
    throw new HttpError(400, "شناسه فایل بارگذاری‌شده معتبر نیست.");
  }

  if (!(await isRestoreTargetReady())) {
    throw new HttpError(
      409,
      "سرور برای بازیابی آماده نیست؛ نصب پایه، Docker و سرویس systemd را بررسی کنید.",
    );
  }

  const archivePath = `${PENDING}/${uploadId}.hirbod`;
  const fileInfo = await lstat(archivePath).catch(() => null);

  if (!fileInfo?.isFile() || fileInfo.isSymbolicLink()) {
    throw new HttpError(404, "فایل بارگذاری‌شده پیدا نشد یا منقضی شده است.");
  }

  const inspection = await inspectWithPython(archivePath);
  if (!inspection?.valid || inspection?.format_version !== 3) {
    throw new HttpError(422, "فقط فایل بکاپ معتبر نسخه ۳ قابل بازیابی است.");
  }

  const jobId = randomUUID();
  const token = randomBytes(32).toString("hex");
  const tokenPath = `${STATE_DIR}/restore-${jobId}.token`;
  const status = {
    job_id: jobId,
    state: "queued",
    step: "queued",
    progress: 0,
    message: "درخواست بازیابی ثبت شد.",
    updated_at: new Date().toISOString(),
  };

  await writeFile(
    tokenPath,
    createHash("sha256").update(token).digest("hex"),
    { mode: 0o600, flag: "wx" },
  );

  let lockAcquired = false;

  try {
    await writeFile(
      RESTORE_LOCK,
      JSON.stringify({ job_id: jobId, started_at: new Date().toISOString() }),
      { mode: 0o600, flag: "wx" },
    );
    lockAcquired = true;

    await writeFile(RESTORE_STATUS, JSON.stringify(status), {
      mode: 0o600,
    });

    await execFile(
      "/usr/bin/systemd-run",
      [
        "--quiet",
        `--unit=hirbod-restore-v3-${jobId}`,
        "--collect",
        "--property=Type=exec",
        "--no-block",
        "/usr/bin/python3",
        SCRIPT,
        "restore",
        archivePath,
        jobId,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024 },
    );
  } catch (error: any) {
    await unlink(tokenPath).catch(() => {});
    if (lockAcquired) {
      await unlink(RESTORE_LOCK).catch(() => {});
      await unlink(RESTORE_STATUS).catch(() => {});
    }

    if (error?.code === "EEXIST") {
      throw new HttpError(409, "یک عملیات بازیابی دیگر در حال اجراست.");
    }

    throw new HttpError(
      500,
      "شروع عملیات بازیابی ناموفق بود. سرویس systemd را بررسی کنید.",
    );
  }

  return {
    ok: true,
    job_id: jobId,
    status_token: token,
    state: "queued",
    message: "بازیابی کامل در پس‌زمینه آغاز شد.",
  };
}

async function readRestoreStatus(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new HttpError(403, "درخواست وضعیت از مبدأ معتبر نیست.");
  }

  const url = new URL(request.url);
  const jobId = url.searchParams.get("job_id") || "";
  const token = request.headers.get("x-restore-token") || "";

  if (!/^[0-9a-f-]{36}$/i.test(jobId) || !/^[0-9a-f]{64}$/i.test(token)) {
    throw new HttpError(400, "شناسه یا مجوز پیگیری عملیات معتبر نیست.");
  }

  const tokenPath = `${STATE_DIR}/restore-${jobId}.token`;

  let savedHash: string;
  try {
    savedHash = (await readFile(tokenPath, "utf8")).trim();
  } catch {
    throw new HttpError(404, "مجوز پیگیری این عملیات پیدا نشد.");
  }

  const expected = Buffer.from(savedHash, "hex");
  const actual = createHash("sha256").update(token).digest();

  if (
    expected.length !== actual.length ||
    !timingSafeEqual(expected, actual)
  ) {
    throw new HttpError(403, "مجوز پیگیری عملیات معتبر نیست.");
  }

  let status: any;
  try {
    status = JSON.parse(await readFile(RESTORE_STATUS, "utf8"));
  } catch {
    throw new HttpError(404, "وضعیت عملیات هنوز ثبت نشده است.");
  }

  if (status?.job_id !== jobId) {
    throw new HttpError(404, "عملیات بازیابی پیدا نشد.");
  }

  return Response.json({ ok: true, status }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export const Route = createFileRoute("/api/backup/restore")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          return await readRestoreStatus(request);
        } catch (error: any) {
          const status = error instanceof HttpError ? error.status : 500;
          const message = error instanceof HttpError
            ? error.message
            : "دریافت وضعیت بازیابی ناموفق بود.";

          return Response.json({ ok: false, error: message }, { status });
        }
      },
      POST: async ({ request }) => {
        let savedPath: string | null = null;

        try {
          await authorizeAdmin(request);

          const contentType = request.headers.get("content-type") || "";
          if (contentType.toLowerCase().startsWith("application/json")) {
            const body = await request.json().catch(() => ({}));
            return Response.json(
              await startRestoreJob(String((body as any)?.upload_id || "")),
            );
          }

          if (typeof process.getuid === "function" && process.getuid() !== 0) {
            throw new HttpError(500, "سرویس برنامه مجوز ذخیره فایل بازیابی را ندارد.");
          }


          if (!contentType.toLowerCase().startsWith("application/octet-stream")) {
            throw new HttpError(415, "نوع درخواست برای فایل بکاپ معتبر نیست.");
          }

          const announcedLength = Number(request.headers.get("content-length") || 0);

          if (announcedLength > MAX_UPLOAD) {
            throw new HttpError(413, "حجم فایل از محدودیت بارگذاری بیشتر است.");
          }

          if (!request.body) {
            throw new HttpError(400, "فایل بکاپ دریافت نشد.");
          }

          await mkdir(PENDING, { recursive: true, mode: 0o700 });
          await cleanupOldUploads();

          await import("node:fs/promises").then(({ chmod }) =>
            chmod(PENDING, 0o700),
          );

          const uploadId = randomUUID();
          savedPath = `${PENDING}/${uploadId}.hirbod`;

          const handle = await open(savedPath, "wx", 0o600);
          const reader = request.body.getReader();
          const hash = createHash("sha256");

          let total = 0;
          let position = 0;
          let firstBytes = Buffer.alloc(0);

          try {
            while (true) {
              const { done, value } = await reader.read();

              if (done) break;

              const chunk = Buffer.from(value);
              total += chunk.length;

              if (total > MAX_UPLOAD) {
                await reader.cancel().catch(() => {});
                throw new HttpError(413, "حجم فایل از ۵۱۲ مگابایت بیشتر است.");
              }

              if (firstBytes.length < 2) {
                firstBytes = Buffer.concat([
                  firstBytes,
                  chunk.subarray(0, 2 - firstBytes.length),
                ]);
              }

              hash.update(chunk);

              let offset = 0;

              while (offset < chunk.length) {
                const written = await handle.write(
                  chunk,
                  offset,
                  chunk.length - offset,
                  position,
                );

                if (!written.bytesWritten) {
                  throw new Error("نوشتن فایل روی دیسک ناموفق بود.");
                }

                offset += written.bytesWritten;
                position += written.bytesWritten;
              }
            }

            await handle.sync();
          } finally {
            await handle.close();
          }

          if (total < 1024) {
            throw new HttpError(400, "فایل بکاپ خالی یا ناقص است.");
          }

          if (firstBytes.length < 2 || firstBytes[0] !== 0x1f || firstBytes[1] !== 0x8b) {
            throw new HttpError(422, "ساختار فشرده فایل بکاپ معتبر نیست.");
          }

          const inspection = await inspectWithPython(savedPath);

          if (!inspection?.ok || !inspection?.valid) {
            throw new HttpError(422, "فایل بکاپ اعتبار لازم را ندارد.");
          }

          return Response.json({
            ok: true,
            upload_id: uploadId,
            archive_size: total,
            sha256: hash.digest("hex"),
            backup_id: inspection.backup_id,
            created_at_utc: inspection.created_at_utc,
            app_version: inspection.app_version,
            database_size: inspection.database_size,
            encrypted: false,
            format_version: inspection.format_version,
            globals_size: inspection.globals_size,
            globals_roles_count: inspection.globals_roles_count,
            pgsodium_key_size: inspection.pgsodium_key_size,
            storage_included: inspection.storage_included,
            can_restore: await isRestoreTargetReady(),
            message: "فایل دریافت و اعتبارسنجی شد.",
          });
        } catch (error: any) {
          if (savedPath) {
            await unlink(savedPath).catch(() => {});
          }

          const status = error instanceof HttpError ? error.status : 500;
          const message =
            error instanceof HttpError
              ? error.message
              : "دریافت یا اعتبارسنجی فایل بازیابی ناموفق بود.";

          if (status === 500) {
            console.error("[restore-upload]", error);
          }

          return Response.json(
            { ok: false, error: message },
            { status },
          );
        }
      },
    },
  },
});
