import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Database, Save, Send, RefreshCw, Upload, FileCheck } from "lucide-react";
import { PageHeader } from "@/components/AppShell";
import { useMe } from "@/lib/data";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getTelegramBackupStatus,
  saveTelegramBackupSettings,
  testTelegramBackupConnection,
  runTelegramBackupNow,
} from "@/lib/telegram-backup.functions";

export const Route = createFileRoute("/_authenticated/backup")({
  head: () => ({ meta: [{ title: "مدیریت پشتیبان‌گیری" }] }),
  component: TelegramBackupPage,
});

function dateText(value?: string | null) {
  if (!value) return "ثبت نشده";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function TelegramBackupPage() {
  const me = useMe();
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["telegram-backup-status"],
    queryFn: () => getTelegramBackupStatus(),
    refetchInterval: 5000,
  });

  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState("");
  const [scheduleHours, setScheduleHours] = useState("4");
  const [proxyMode, setProxyMode] = useState("direct");
  const [proxyHost, setProxyHost] = useState("");
  const [proxyPort, setProxyPort] = useState("1080");
  const [proxyUser, setProxyUser] = useState("");
  const [proxyPassword, setProxyPassword] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [hasProxyPassword, setHasProxyPassword] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreStartBusy, setRestoreStartBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<any>(null);
  const [restoreJob, setRestoreJob] = useState<{
    job_id: string;
    token: string;
  } | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<any>(null);

  useEffect(() => {
    const s = status.data?.settings;
    if (!s || loaded) return;
    setEnabled(s.enabled);
    setChatId(s.chatId || "");
    setScheduleHours(String(s.scheduleHours || 4));
    setProxyMode(s.proxyMode || "direct");
    setProxyHost(s.proxyHost || "");
    setProxyPort(String(s.proxyPort || 1080));
    setProxyUser(s.proxyUser || "");
    setHasToken(s.hasToken);
    setHasProxyPassword(s.hasProxyPassword);
    setLoaded(true);
  }, [status.data, loaded]);


  useEffect(() => {
    try {
      const saved = sessionStorage.getItem("hirbod-restore-job");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.job_id && parsed?.token) setRestoreJob(parsed);
      }
    } catch {
      sessionStorage.removeItem("hirbod-restore-job");
    }
  }, []);

  useEffect(() => {
    if (!restoreJob) return;

    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const poll = async () => {
      if (stopped) return;

      try {
        const response = await fetch(
          `/api/backup/restore?job_id=${encodeURIComponent(restoreJob.job_id)}`,
          {
            method: "GET",
            cache: "no-store",
            headers: { "X-Restore-Token": restoreJob.token },
          },
        );

        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) return;

        setRestoreStatus(result.status);

        if (["success", "failed", "rollback_failed"].includes(result.status?.state)) {
          stopped = true;
          if (timer) clearInterval(timer);
        }
      } catch {
        // Polling resumes automatically when the application is reachable.
      }
    };

    timer = setInterval(() => void poll(), 2000);
    void poll();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [restoreJob]);

  const saveMutation = useMutation({
    mutationFn: () => saveTelegramBackupSettings({
      data: {
        enabled,
        botToken,
        chatId,
        scheduleHours: Number(scheduleHours),
        proxyMode,
        proxyHost,
        proxyPort: Number(proxyPort),
        proxyUser,
        proxyPassword,
      },
    }),
    onSuccess: async () => {
      setBotToken("");
      setProxyPassword("");
      toast.success("تنظیمات پشتیبان‌گیری ذخیره شد.");
      await qc.invalidateQueries({ queryKey: ["telegram-backup-status"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "ذخیره تنظیمات ناموفق بود."),
  });

  const testMutation = useMutation({
    mutationFn: () => testTelegramBackupConnection(),
    onSuccess: (result) => {
      toast.success(result.message || "اتصال برقرار است.");
      void qc.invalidateQueries({ queryKey: ["telegram-backup-status"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "آزمایش اتصال ناموفق بود."),
  });

  const backupMutation = useMutation({
    mutationFn: () => runTelegramBackupNow(),
    onSuccess: (result) => {
      toast.success(result.message || "بکاپ آغاز شد.");
      void qc.invalidateQueries({ queryKey: ["telegram-backup-status"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "شروع بکاپ ناموفق بود."),
  });

  if (me.isLoading || status.isLoading) {
    return <div className="p-8 text-muted-foreground">در حال بارگذاری تنظیمات…</div>;
  }
  if (!me.data?.isAdmin) return <Navigate to="/dashboard" replace />;

  const runtime = status.data?.runtime;
  const configured = Boolean(status.data?.settings.configured);
  const running = runtime?.state === "running";
  const canSave = Boolean(
    (hasToken || botToken.trim()) &&
    chatId.trim()
  );

  async function inspectRestoreFile() {
    if (!restoreFile) {
      toast.error("ابتدا فایل بکاپ را انتخاب کنید.");
      return;
    }

    if (!restoreFile.name.toLowerCase().endsWith(".hirbod")) {
      toast.error("فایل انتخاب‌شده باید پسوند .hirbod داشته باشد.");
      return;
    }

    if (restoreFile.size > 512 * 1024 * 1024) {
      toast.error("حجم فایل از ۵۱۲ مگابایت بیشتر است.");
      return;
    }

    setRestoreBusy(true);
    setRestoreResult(null);

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session?.access_token) {
        throw new Error("نشست معتبر نیست؛ دوباره وارد حساب مدیر شوید.");
      }

      const response = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/octet-stream",
          "Authorization": `Bearer ${data.session.access_token}`,
        },
        body: restoreFile,
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "بارگذاری یا اعتبارسنجی فایل ناموفق بود.");
      }

      setRestoreResult(result);
      toast.success("فایل بکاپ با موفقیت بررسی شد؛ هنوز بازیابی انجام نشده است.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "بررسی فایل بکاپ ناموفق بود."
      );
    } finally {
      setRestoreBusy(false);
    }
  }


  async function startFullRestore() {
    if (!restoreResult?.upload_id || !restoreResult?.can_restore) {
      toast.error("بازیابی روی این نصب فعال نیست.");
      return;
    }

    const confirmed = window.confirm(
      "تمام اطلاعات و تنظیمات سرور با نسخه موجود در فایل بکاپ جایگزین می‌شود. ادامه می‌دهید؟"
    );

    if (!confirmed) return;

    setRestoreStartBusy(true);

    try {
      const { data, error } = await supabase.auth.getSession();

      if (error || !data.session?.access_token) {
        throw new Error("نشست مدیر معتبر نیست؛ دوباره وارد شوید.");
      }

      const response = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${data.session.access_token}`,
        },
        body: JSON.stringify({ upload_id: restoreResult.upload_id }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || "شروع بازیابی ناموفق بود.");
      }

      const job = {
        job_id: result.job_id,
        token: result.status_token,
      };

      sessionStorage.setItem("hirbod-restore-job", JSON.stringify(job));
      setRestoreJob(job);
      setRestoreStatus({
        state: "queued",
        progress: 0,
        message: result.message || "بازیابی در صف اجرا قرار گرفت.",
      });

      toast.success("عملیات بازیابی آغاز شد.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "شروع بازیابی ناموفق بود."
      );
    } finally {
      setRestoreStartBusy(false);
    }
  }

  function restoreBytesText(value?: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    if (value < 1024) return `${value} بایت`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} کیلوبایت`;
    if (value < 1024 * 1024 * 1024) {
      return `${(value / (1024 * 1024)).toFixed(2)} مگابایت`;
    }
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} گیگابایت`;
  }

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="مدیریت پشتیبان‌گیری" />

      <section className="card-elevated space-y-4 p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <Database className="size-6 text-primary" />
          <div>
            <h2 className="font-bold text-lg">پشتیبان‌گیری تلگرامی</h2>
            <p className="text-sm text-muted-foreground mt-1">
              یک فایل پشتیبان واحد و بدون رمزگذاری به گفت‌وگوی خصوصی تلگرام ارسال می‌شود.
            </p>
          </div>
        </div>

        <label className="flex items-center justify-between gap-3 rounded-xl border p-4">
          <span>
            <span className="block font-semibold">فعال‌سازی بکاپ خودکار</span>
            <span className="block text-xs text-muted-foreground mt-1">
              زمان‌بندی فقط پس از ذخیره تنظیمات فعال می‌شود.
            </span>
          </span>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="size-5 accent-primary"
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="backup-token">توکن ربات تلگرام</Label>
            <Input
              id="backup-token"
              type="password"
              dir="ltr"
              autoComplete="new-password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder={hasToken ? "برای حفظ توکن قبلی خالی بگذارید" : "توکن دریافتی از BotFather"}
            />
            <p className="text-xs text-muted-foreground">
              توکن فقط در سرور ذخیره می‌شود و دوباره به مرورگر برگردانده نمی‌شود.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="backup-chat">شناسه مقصد (Chat ID)</Label>
            <Input
              id="backup-chat"
              dir="ltr"
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              placeholder="-1001234567890"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="backup-schedule">فاصله زمانی پشتیبان‌گیری</Label>
            <select
              id="backup-schedule"
              value={scheduleHours}
              onChange={(e) => setScheduleHours(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            >
              <option value="4">هر ۴ ساعت</option>
              <option value="6">هر ۶ ساعت</option>
              <option value="12">هر ۱۲ ساعت</option>
              <option value="24">هر ۲۴ ساعت</option>
              <option value="48">هر ۲ روز</option>
              <option value="72">هر ۳ روز</option>
              <option value="168">هر ۷ روز</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card-elevated space-y-4 p-5 sm:p-7">
        <div>
          <h2 className="font-bold text-lg">روش اتصال</h2>
          <p className="text-sm text-muted-foreground mt-1">
            در صورت دسترسی مستقیم سرور به تلگرام، پروکسی را خاموش نگه دارید.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <label className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
            <input type="radio" checked={proxyMode === "direct"} onChange={() => setProxyMode("direct")} />
            اتصال مستقیم
          </label>
          <label className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm">
            <input type="radio" checked={proxyMode === "socks5"} onChange={() => setProxyMode("socks5")} />
            پروکسی SOCKS5
          </label>
        </div>

        {proxyMode === "socks5" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="proxy-host">آدرس پروکسی</Label>
              <Input id="proxy-host" dir="ltr" value={proxyHost}
                onChange={(e) => setProxyHost(e.target.value)} placeholder="proxy.example.com" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-port">پورت</Label>
              <Input id="proxy-port" dir="ltr" inputMode="numeric" value={proxyPort}
                onChange={(e) => setProxyPort(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-user">نام کاربری (اختیاری)</Label>
              <Input id="proxy-user" dir="ltr" value={proxyUser}
                onChange={(e) => setProxyUser(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="proxy-password">رمز پروکسی</Label>
              <Input id="proxy-password" type="password" dir="ltr" autoComplete="new-password"
                value={proxyPassword} onChange={(e) => setProxyPassword(e.target.value)}
                placeholder={hasProxyPassword ? "برای حفظ رمز قبلی خالی بگذارید" : "در صورت نیاز"} />
            </div>
          </div>
        )}
      </section>


      <section className="card-elevated space-y-4 p-5 sm:p-7">
        <div className="flex items-center gap-3">
          <FileCheck className="size-6 text-primary" />
          <div>
            <h2 className="font-bold text-lg">بررسی و آماده‌سازی بازیابی</h2>
            <p className="text-sm text-muted-foreground mt-1">
              فایل بکاپ قبلی را انتخاب کنید تا ساختار آن بررسی شود.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="restore-backup-file">فایل پشتیبان هیربد (.hirbod)</Label>
          <Input
            id="restore-backup-file"
            type="file"
            accept=".hirbod,application/gzip"
            disabled={restoreBusy}
            onChange={(event) => {
              const file = event.target.files?.[0] || null;
              setRestoreFile(file);
              setRestoreResult(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            حداکثر حجم قابل بارگذاری در این مرحله ۵۱۲ مگابایت است.
          </p>
        </div>

        {restoreFile && (
          <div className="rounded-lg border p-3 text-sm space-y-1">
            <div className="font-semibold break-all">{restoreFile.name}</div>
            <div className="text-muted-foreground">
              حجم فایل: {restoreBytesText(restoreFile.size)}
            </div>
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={inspectRestoreFile}
          disabled={!restoreFile || restoreBusy}
        >
          <Upload className="size-4" />
          {restoreBusy ? "در حال بارگذاری و بررسی…" : "بارگذاری و بررسی فایل"}
        </Button>

        {restoreResult && (
          <div className="rounded-xl border border-green-600/30 bg-green-600/5 p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-green-700 dark:text-green-400">
              <FileCheck className="size-5" />
              فایل بکاپ معتبر است
            </div>

            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <div className="text-muted-foreground">شناسه بکاپ</div>
                <div dir="ltr" className="font-semibold break-all">
                  {restoreResult.backup_id || "—"}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">زمان ایجاد بکاپ</div>
                <div className="font-semibold">
                  {dateText(restoreResult.created_at_utc)}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">نسخه برنامه</div>
                <div className="font-semibold">
                  {restoreResult.app_version || "نامشخص"}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">حجم فایل بکاپ</div>
                <div className="font-semibold">
                  {restoreBytesText(restoreResult.archive_size)}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">حجم دیتابیس</div>
                <div className="font-semibold">
                  {restoreBytesText(restoreResult.database_size)}
                </div>
              </div>

              <div>
                <div className="text-muted-foreground">وضعیت رمزگذاری</div>
                <div className="font-semibold">بدون رمزگذاری</div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground break-all" dir="ltr">
              SHA-256: {restoreResult.sha256 || "—"}
            </div>

            <p className="text-sm leading-7">
              فایل معتبر است. شروع بازیابی، اطلاعات فعلی سرور را جایگزین می‌کند.
            </p>

            <Button
              type="button"
              variant="destructive"
              onClick={startFullRestore}
              disabled={!restoreResult.can_restore || restoreStartBusy || restoreBusy}
            >
              {restoreStartBusy ? "در حال آغاز بازیابی…" : "شروع بازیابی کامل"}
            </Button>

            {!restoreResult.can_restore && (
              <p className="text-xs text-muted-foreground">
                بازیابی روی سرور نصب‌شده و آماده نیز قابل اجراست.
              </p>
            )}
          </div>
        )}


        {restoreStatus && (
          <div className="rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">وضعیت بازیابی</span>
              <span className="text-sm">
                {restoreStatus.state === "success" ? "موفق" :
                  restoreStatus.state === "failed" ? "ناموفق؛ بازگشت انجام شد" :
                  restoreStatus.state === "rollback_failed" ? "نیازمند بررسی مدیر" :
                  restoreStatus.state === "rolling_back" ? "در حال بازگشت وضعیت قبلی" :
                  "در حال اجرا"}
              </span>
            </div>

            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{
                  width: `${Math.max(0, Math.min(100, Number(restoreStatus.progress || 0)))}%`
                }}
              />
            </div>

            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{restoreStatus.message || "در حال انجام عملیات…"}</span>
              <span dir="ltr">{Number(restoreStatus.progress || 0)}%</span>
            </div>

            {restoreStatus.error && (
              <p className="text-sm text-destructive break-words">
                {restoreStatus.error}
              </p>
            )}

            {restoreStatus.state === "success" && (
              <p className="text-sm text-green-700 dark:text-green-400">
                بازیابی کامل شد. برای ورود به حساب قبلی، دوباره وارد سایت شوید.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="card-elevated space-y-4 p-5 sm:p-7">
        <div>
          <h2 className="font-bold text-lg">وضعیت عملیات</h2>
          <p className="text-sm text-muted-foreground mt-1">
            وضعیت به‌صورت خودکار به‌روزرسانی می‌شود.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">وضعیت آخرین عملیات</div>
            <div className="mt-2 font-bold">
              {runtime?.state === "running" ? "در حال اجرا" :
                runtime?.state === "success" ? "موفق" :
                runtime?.state === "failed" ? "ناموفق" : "هنوز اجرا نشده"}
            </div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">آخرین بکاپ موفق</div>
            <div className="mt-2 font-bold">{dateText(runtime?.last_success_at)}</div>
          </div>
        </div>

        {runtime?.message && <p className="text-sm">{runtime.message}</p>}
        {runtime?.last_error && (
          <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {runtime.last_error}
          </p>
        )}
        {runtime?.backup_id && (
          <p className="text-xs text-muted-foreground" dir="ltr">
            Backup ID: {runtime.backup_id}
          </p>
        )}

        <div className="flex flex-wrap gap-2 border-t pt-4">
          <Button type="button" onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !canSave}>
            <Save className="size-4" />
            {saveMutation.isPending ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </Button>
          <Button type="button" variant="outline" onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending || !configured || !hasToken}>
            <Send className="size-4" />
            آزمایش اتصال
          </Button>
          <Button type="button" variant="secondary" onClick={() => backupMutation.mutate()}
            disabled={backupMutation.isPending || running || !configured}>
            <Database className="size-4" />
            {backupMutation.isPending ? "در حال شروع…" : "ارسال بکاپ دستی"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => status.refetch()}>
            <RefreshCw className="size-4" />
            تازه‌سازی
          </Button>
        </div>
      </section>

    </div>
  );
}
