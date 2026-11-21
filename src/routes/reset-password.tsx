import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBranding } from "@/lib/branding";

type ResetState = "checking" | "otp" | "ready" | "invalid";
type ResetFlow = "invite" | "recovery";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "تعیین رمز عبور | هیربد خودرو" }] }),
  component: Reset,
});

function Reset() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<ResetState>("checking");
  const [flow, setFlow] = useState<ResetFlow>("recovery");
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { branding } = useBranding();

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const fragment = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(fragment);
      const tokenHash = hashParams.get("token_hash");
      const inviteType = hashParams.get("type");

      // ورود مستقیم به صفحه برای واردکردن کد شش‌رقمی
      if (!tokenHash && !inviteType) {
        const query = new URLSearchParams(window.location.search);
        if (mounted) {
          setEmail(query.get("email") ?? "");
          setFlow("recovery");
          setState("otp");
        }
        return;
      }

      // حفظ روند قبلی لینک دعوت و لینک بازیابی
      window.history.replaceState(
        null,
        document.title,
        window.location.pathname + window.location.search
      );
      await supabase.auth.signOut({ scope: "local" });

      if (!tokenHash || (inviteType !== "invite" && inviteType !== "recovery")) {
        if (mounted) setState("invalid");
        return;
      }

      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: inviteType as "invite" | "recovery",
      });

      if (error || !data.user || !data.session) {
        await supabase.auth.signOut({ scope: "local" });
        if (mounted) setState("invalid");
        return;
      }

      if (mounted) {
        setFlow(inviteType);
        setVerifiedUserId(data.user.id);
        setState("ready");
      }
    }

    initialize().catch(async () => {
      await supabase.auth.signOut({ scope: "local" });
      if (mounted) setState("invalid");
    });

    return () => {
      mounted = false;
    };
  }, []);

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim();
    const normalizedCode = code.trim();

    if (!normalizedEmail) {
      toast.error("ایمیل حساب را وارد کنید.");
      return;
    }
    if (!/^\d{6}$/.test(normalizedCode)) {
      toast.error("کد بازیابی باید دقیقاً 6 رقم باشد.");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email: normalizedEmail,
        token: normalizedCode,
        type: "recovery",
      });
      if (error) throw error;
      if (!data.user || !data.session) {
        throw new Error("کد بازیابی معتبر نیست یا زمان آن به پایان رسیده است.");
      }

      setVerifiedUserId(data.user.id);
      setFlow("recovery");
      setState("ready");
      toast.success("کد تأیید شد؛ رمز عبور جدید را وارد کنید.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "تأیید کد بازیابی انجام نشد."
      );
    } finally {
      setBusy(false);
    }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state !== "ready" || !verifiedUserId) {
      toast.error("ابتدا کد یا لینک بازیابی را تأیید کنید.");
      return;
    }
    if (password.length < 8) {
      toast.error("رمز عبور باید حداقل 8 نویسه داشته باشد.");
      return;
    }

    setBusy(true);
    try {
      const { data: current, error: currentError } =
        await supabase.auth.getUser();
      if (currentError || current.user?.id !== verifiedUserId) {
        throw new Error("نشست تأییدشده معتبر نیست؛ کد یا لینک را دوباره تأیید کنید.");
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success(
        flow === "invite"
          ? "رمز عبور حساب دعوت‌شده با موفقیت تعیین شد."
          : "رمز عبور با موفقیت تغییر کرد."
      );
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "ذخیره رمز عبور انجام نشد."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="auth-scene relative z-[1] min-h-screen grid place-items-center p-4">
      <div className="auth-theme-control"><ThemeToggle /></div>
      <div className="auth-card card-elevated w-full max-w-md p-6 sm:p-8 space-y-5">
        <div>
          <div className="mb-5 flex items-center gap-3">
            <img src={branding.logo_url || "/hirbod-favicon.svg"} alt="" className="size-12 rounded-xl border border-border bg-card object-contain p-1" />
            <div><div className="text-sm font-bold">{branding.app_name}</div><div className="mt-1 text-xs text-muted-foreground">{branding.company_name}</div></div>
          </div>
          <div className="text-xl font-bold">
            {state === "otp" ? "تأیید کد بازیابی" : "تعیین رمز عبور"}
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {state === "otp"
              ? "کد شش‌رقمی ارسال‌شده به ایمیل را وارد کنید تا بتوانید رمز عبور تازه‌ای انتخاب کنید."
              : flow === "invite"
                ? "پس از اعتبارسنجی لینک اختصاصی دعوت، برای حساب خود رمز عبور انتخاب کنید."
                : "پس از تأیید درخواست بازیابی، رمز عبور جدید خود را انتخاب کنید."}
          </p>
        </div>

        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">در حال اعتبارسنجی لینک…</p>
        ) : state === "invalid" ? (
          <div className="space-y-3">
            <p className="text-sm leading-7 text-destructive">
              لینک یا کد بازیابی نامعتبر، منقضی یا قبلاً استفاده شده است. دوباره درخواست بازیابی بدهید.
            </p>
            <Button className="w-full" onClick={() => navigate({ to: "/auth" })}>
              بازگشت به ورود
            </Button>
          </div>
        ) : state === "otp" ? (
          <form onSubmit={verifyCode} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="recovery-email" className="text-sm font-medium">
                ایمیل حساب
              </label>
              <Input
                id="recovery-email"
                type="email"
                autoComplete="email"
                dir="ltr"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="recovery-code" className="text-sm font-medium">
                کد شش‌رقمی بازیابی
              </label>
              <Input
                id="recovery-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                pattern="[0-9]{6}"
                value={code}
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, "").slice(0, 6))
                }
                placeholder="123456"
                required
              />
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "در حال بررسی…" : "تأیید کد"}
            </Button>
            <Button
              className="w-full"
              type="button"
              variant="outline"
              onClick={() => navigate({ to: "/auth" })}
            >
              بازگشت به ورود
            </Button>
          </form>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="new-staff-password" className="text-sm font-medium">
                رمز عبور جدید
              </label>
              <PasswordInput
                id="new-staff-password"
                autoComplete="new-password"
                dir="ltr"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                حداقل 8 نویسه انتخاب کنید.
              </p>
            </div>
            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "در حال ذخیره…" : "ذخیره رمز عبور جدید"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
