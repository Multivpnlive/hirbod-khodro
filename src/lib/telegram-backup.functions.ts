import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CONFIG = "/etc/hirbod/telegram-backup.json";
const STATUS = "/var/lib/hirbod-backup/status.json";
const SCRIPT = "/opt/hirbod/app/scripts/telegram_backup.py";

async function requireAdmin(context: unknown) {
  const auth = context as any;
  if (!auth?.userId || !auth?.supabase) {
    throw new Error("نشست معتبر نیست؛ دوباره وارد شوید.");
  }

  const { data, error } = await auth.supabase
    .from("user_roles")
    .select("user_id")
    .eq("user_id", auth.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw new Error("فقط مدیر اصلی اجازه مدیریت پشتیبان‌گیری را دارد.");
  }

  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    throw new Error("سرویس برنامه مجوز مدیریت تنظیمات سیستم را ندارد.");
  }
  return auth;
}

async function readConfig() {
  const fs = await import("node:fs/promises");
  try {
    return JSON.parse(await fs.readFile(CONFIG, "utf8"));
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw new Error("خواندن تنظیمات پشتیبان‌گیری ناموفق بود.");
  }
}

async function runPython(action: string) {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const exec = promisify(execFile);

  const result = await exec(
    "/usr/bin/python3",
    [SCRIPT, action],
    { timeout: 30 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 }
  );

  const output = String(result.stdout || "").trim();
  try {
    return JSON.parse(output.split("\n").filter(Boolean).at(-1) || "{}");
  } catch {
    throw new Error("پاسخ موتور پشتیبان‌گیری قابل خواندن نیست.");
  }
}

export const getTelegramBackupStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);

    const fs = await import("node:fs/promises");
    const config = await readConfig();

    let runtime: any = null;
    try {
      runtime = JSON.parse(await fs.readFile(STATUS, "utf8"));
    } catch {}

    return {
      settings: config ? {
        configured: true,
        enabled: Boolean(config.enabled),
        hasToken: Boolean(config.bot_token),
        chatId: config.chat_id || "",
        scheduleHours: Number(config.schedule_hours || 4),
        proxyMode: config.proxy?.mode || "direct",
        proxyHost: config.proxy?.host || "",
        proxyPort: config.proxy?.port || 1080,
        proxyUser: config.proxy?.username || "",
        hasProxyPassword: Boolean(config.proxy?.password),
      } : {
        configured: false,
        enabled: false,
        hasToken: false,
        chatId: "",
        scheduleHours: 4,
        proxyMode: "direct",
        proxyHost: "",
        proxyPort: 1080,
        proxyUser: "",
        hasProxyPassword: false,
      },
      runtime,
    };
  });

export const saveTelegramBackupSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => {
    const v = input as Record<string, unknown>;
    const botToken = typeof v.botToken === "string" ? v.botToken.trim() : "";
    const chatId = typeof v.chatId === "string" ? v.chatId.trim() : "";
    const proxyMode = v.proxyMode === "socks5" ? "socks5" : "direct";
    const proxyHost = typeof v.proxyHost === "string" ? v.proxyHost.trim() : "";
    const proxyPort = Number(v.proxyPort || 1080);
    const proxyUser = typeof v.proxyUser === "string" ? v.proxyUser.trim() : "";
    const proxyPassword = typeof v.proxyPassword === "string" ? v.proxyPassword : "";
    const scheduleHours = Number(v.scheduleHours || 4);
    const enabled = v.enabled === true;

    if (botToken && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(botToken)) {
      throw new Error("توکن ربات معتبر نیست.");
    }
    if (chatId && !/^(?:-?\d{1,20}|@[A-Za-z0-9_]{5,})$/.test(chatId)) {
      throw new Error("شناسه مقصد تلگرام معتبر نیست.");
    }
    if (![4, 6, 12, 24, 48, 72, 168].includes(scheduleHours)) {
      throw new Error("فاصله زمانی بکاپ معتبر نیست.");
    }
    if (proxyMode === "socks5") {
      if (!/^[A-Za-z0-9.-]{1,253}$/.test(proxyHost)) {
        throw new Error("آدرس پروکسی معتبر نیست.");
      }
      if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) {
        throw new Error("پورت پروکسی معتبر نیست.");
      }
      if (proxyUser.length > 128 || proxyPassword.length > 256 ||
          /[\r\n]/.test(proxyUser + proxyPassword)) {
        throw new Error("اطلاعات احراز هویت پروکسی معتبر نیست.");
      }
    }

    return {
      botToken, chatId, proxyMode, proxyHost, proxyPort,
      proxyUser, proxyPassword, scheduleHours, enabled
    };
  })
  .handler(async ({ context, data }) => {
    await requireAdmin(context);
    const fs = await import("node:fs/promises");
    const old = await readConfig() || {};

    const botToken = data.botToken || old.bot_token || "";
    const chatId = data.chatId || old.chat_id || "";

    if (data.enabled && (!botToken || !chatId)) {
      throw new Error("برای فعال‌سازی، توکن ربات و Chat ID لازم است.");
    }

    let proxy: any = { mode: "direct" };
    if (data.proxyMode === "socks5") {
      const sameProxy =
        old.proxy?.mode === "socks5" &&
        old.proxy?.host === data.proxyHost &&
        Number(old.proxy?.port) === data.proxyPort &&
        old.proxy?.username === data.proxyUser;

      proxy = {
        mode: "socks5",
        host: data.proxyHost,
        port: data.proxyPort,
        username: data.proxyUser,
        password: data.proxyPassword || (sameProxy ? old.proxy?.password || "" : ""),
      };
    }

    const config = {
      version: 1,
      bot_token: botToken,
      chat_id: chatId,
      proxy,
      schedule_hours: data.scheduleHours,
      enabled: data.enabled,
      updated_at: new Date().toISOString(),
    };

    await fs.mkdir("/etc/hirbod", { recursive: true, mode: 0o700 });
    await fs.chmod("/etc/hirbod", 0o700);

    const temp = `${CONFIG}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(config, null, 2), { mode: 0o600 });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, CONFIG);
    await fs.chmod(CONFIG, 0o600);

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);

    if (data.enabled) {
      await exec("systemctl", ["enable", "--now", "hirbod-telegram-backup.timer"], { timeout: 30000 });
    } else {
      await exec("systemctl", ["disable", "--now", "hirbod-telegram-backup.timer"], { timeout: 30000 }).catch(() => {});
    }

    return {
      success: true,
      enabled: data.enabled,
      message: "تنظیمات پشتیبان‌گیری ذخیره شد."
    };
  });

export const testTelegramBackupConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const config = await readConfig();
    if (!config?.bot_token || !config?.chat_id) {
      throw new Error("ابتدا توکن ربات و Chat ID را ذخیره کنید.");
    }
    const result = await runPython("test");
    if (!result?.ok) throw new Error(result?.error || "آزمایش اتصال ناموفق بود.");
    return result;
  });

export const runTelegramBackupNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const config = await readConfig();
    if (!config?.bot_token || !config?.chat_id) {
      throw new Error("ابتدا تنظیمات ربات و Chat ID را ذخیره کنید.");
    }

    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const exec = promisify(execFile);
    await exec("systemctl", ["start", "--no-block", "hirbod-telegram-backup.service"], { timeout: 15000 });

    return { success: true, message: "عملیات پشتیبان‌گیری آغاز شد." };
  });
