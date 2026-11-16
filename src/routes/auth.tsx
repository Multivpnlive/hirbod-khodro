import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBranding } from "@/lib/branding";
import { ThemeToggle } from "@/components/ThemeToggle";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "ورود | هیربد خودرو" },
      { name: "description", content: "ورود کاربران مجاز به سامانه مدیریت هیربد خودرو." },
      { property: "og:title", content: "ورود به هیربد خودرو" },
      { property: "og:description", content: "ورود کاربران مجاز به سامانه مدیریت هیربد خودرو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const { branding } = useBranding();
  useEffect(() => {
    document.title = `ورود | ${branding.app_name}`;
  }, [branding.app_name]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const normalizedEmail = email.trim();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: u } = await supabase.auth.getUser();
        const [
          { data: roles, error: rolesError },
          { data: staff, error: staffError },
          { data: permissions, error: permissionsError },
        ] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", u.user!.id),
          (supabase as any).from("staff_access").select("is_active").eq("user_id", u.user!.id).maybeSingle(),
          (supabase as any).from("staff_permissions")
            .select("can_view,can_create,can_edit,can_delete")
            .eq("user_id", u.user!.id),
        ]);

        const isAdmin = !rolesError && !!roles?.some((r) => r.role === "admin");
        const hasPermission =
          !staffError &&
          !permissionsError &&
          staff?.is_active === true &&
          !!permissions?.some((p: any) =>
            p.can_view === true ||
            p.can_create === true ||
            p.can_edit === true ||
            p.can_delete === true
          );

        if (!isAdmin && !hasPermission) {
          await supabase.auth.signOut();
          toast.error("این حساب مجوز ورود به سامانه را ندارد.");
          return;
        }

        navigate({ to: "/dashboard" });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        toast.success("کد شش‌رقمی بازیابی به ایمیل شما ارسال شد.");
        window.location.assign(
          window.location.origin + "/reset-password?email=" + encodeURIComponent(normalizedEmail)
        );
        return;
      }
    } catch (err) {
      toast.error((err as Error).message === "Invalid login credentials" ? "ایمیل یا رمز عبور اشتباه است" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-scene relative z-[1] min-h-screen grid place-items-center p-4">
      <div className="auth-theme-control"><ThemeToggle /></div>
      <form onSubmit={submit} className="auth-card card-elevated w-full max-w-md p-6 sm:p-8 space-y-5">
        <div>
          <div className="flex items-center gap-3">
            <img src={branding.logo_url || "/hirbod-favicon.svg"} alt={branding.company_name} className="size-14 rounded-2xl border border-border bg-card object-contain p-1.5" />
            <div>
              <div className="text-xl font-black sm:text-2xl">{branding.app_name}</div>
              <div className="text-xs text-muted-foreground mt-1">{branding.company_name}</div>
            </div>
          </div>
          <div className="mt-6">
            <div className="text-lg font-bold">{mode === "in" ? "خوش آمدید" : "بازیابی رمز عبور"}</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {mode === "in" ? "برای ادامه، وارد حساب کاربری خود شوید." : "نشانی ایمیل حساب خود را وارد کنید."}
            </div>
          </div>
        </div>
        <div className="space-y-2">
          <Label>ایمیل</Label>
          <Input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {mode !== "forgot" && (
          <div className="space-y-2">
            <Label>رمز عبور</Label>
            <Input type="password" dir="ltr" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
        )}
        <Button className="auth-submit w-full" disabled={busy}>
          {busy ? "لطفاً صبر کنید…" : mode === "in" ? "ورود" : "ارسال کد بازیابی"}
        </Button>
        <div className="flex justify-end text-sm">
          {mode === "in" ? (
            <button type="button" className="text-muted-foreground" onClick={() => setMode("forgot")}>
              فراموشی رمز
            </button>
          ) : (
            <button type="button" className="text-primary" onClick={() => setMode("in")}>
              بازگشت به ورود
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
