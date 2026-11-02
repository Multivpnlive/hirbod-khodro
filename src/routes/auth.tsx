import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBranding } from "@/lib/branding";

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
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: u } = await supabase.auth.getUser();
        const [{ data: roles }, { data: staff }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", u.user!.id),
          (supabase as any).from("staff_access").select("is_active").eq("user_id", u.user!.id).maybeSingle(),
        ]);
        navigate({ to: roles?.some((r) => r.role === "admin") || staff?.is_active ? "/dashboard" : "/my" });
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        toast.success("لینک بازیابی رمز ارسال شد.");
      }
    } catch (err) {
      toast.error((err as Error).message === "Invalid login credentials" ? "ایمیل یا رمز عبور اشتباه است" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-hero p-4">
      <form onSubmit={submit} className="card-elevated w-full max-w-sm p-6 space-y-4">
        <div>
          <div className="flex items-center gap-3">
            {branding.logo_url && <img src={branding.logo_url} alt={branding.company_name} className="size-12 rounded-lg border bg-white object-contain p-1" />}
            <div>
              <div className="text-2xl font-black">{branding.app_name}</div>
              <div className="text-xs text-muted-foreground mt-1">{branding.company_name}</div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground mt-1">
            {mode === "in" ? "ورود به حساب" : "بازیابی رمز عبور"}
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
        <Button className="w-full" disabled={busy}>
          {mode === "in" ? "ورود" : "ارسال لینک"}
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
        <p className="text-xs text-muted-foreground leading-6">
          ایجاد حساب کاربری فقط با تأیید مدیر مجموعه انجام می‌شود. ثبت شریک در بخش شرکا نیازی به حساب ورود ندارد.
        </p>
      </form>
    </div>
  );
}
