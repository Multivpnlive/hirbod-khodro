import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "تعیین رمز عبور | هیربد خودرو" }] }),
  component: Reset,
});

type InviteState = "checking" | "ready" | "invalid";

function Reset() {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<InviteState>("checking");
  const [verifiedUserId, setVerifiedUserId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    async function verifyInvite() {
      const fragment = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;

      const params = new URLSearchParams(fragment);
      const tokenHash = params.get("token_hash");
      const inviteType = params.get("type");

      // Remove the one-time token from the visible URL/history.
      window.history.replaceState(
        null,
        document.title,
        window.location.pathname + window.location.search
      );

      // Do not mistake an existing administrator session for an invitation.
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
        setVerifiedUserId(data.user.id);
        setState("ready");
      }
    }

    verifyInvite().catch(async () => {
      await supabase.auth.signOut({ scope: "local" });
      if (mounted) setState("invalid");
    });

    return () => {
      mounted = false;
    };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (state !== "ready" || !verifiedUserId) {
      toast.error("لینک دعوت معتبر نیست؛ از مدیر سامانه لینک تازه بخواهید.");
      return;
    }

    if (password.length < 8) {
      toast.error("رمز عبور باید حداقل ۸ نویسه داشته باشد.");
      return;
    }

    setBusy(true);

    try {
      const { data: current, error: currentError } =
        await supabase.auth.getUser();

      if (currentError || current.user?.id !== verifiedUserId) {
        throw new Error(
          "نشست دعوت معتبر نیست؛ لطفاً لینک دعوت را دوباره باز کنید."
        );
      }

      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success("رمز عبور حساب دعوت‌شده با موفقیت تعیین شد.");
      navigate({ to: "/dashboard", replace: true });

    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "تعیین رمز عبور انجام نشد."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div dir="rtl" className="min-h-screen grid place-items-center bg-hero p-4">
      <div className="card-elevated w-full max-w-sm p-6 space-y-4">
        <div>
          <div className="text-xl font-bold">تعیین رمز عبور</div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            پس از اعتبارسنجی لینک اختصاصی دعوت، برای حساب خود رمز عبور انتخاب کنید.
          </p>
        </div>

        {state === "checking" ? (
          <p className="text-sm text-muted-foreground">
            در حال اعتبارسنجی لینک دعوت…
          </p>
        ) : state === "invalid" ? (
          <div className="space-y-3">
            <p className="text-sm leading-7 text-destructive">
              لینک دعوت نامعتبر، منقضی یا قبلاً استفاده شده است.
              از مدیر سامانه بخواهید لینک تازه‌ای بسازد.
            </p>
            <Button className="w-full" onClick={() => navigate({ to: "/auth" })}>
              بازگشت به ورود
            </Button>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="new-staff-password" className="text-sm font-medium">
                رمز عبور جدید
              </label>
              <Input
                id="new-staff-password"
                type="password"
                autoComplete="new-password"
                dir="ltr"
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <p className="text-xs text-muted-foreground">
                حداقل ۸ نویسه انتخاب کنید.
              </p>
            </div>

            <Button className="w-full" type="submit" disabled={busy}>
              {busy ? "در حال ذخیره…" : "فعال‌سازی حساب و ذخیره رمز"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
