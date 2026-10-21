import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "ورود | هیربد خودرو" },
      { name: "description", content: "ورود و ثبت‌نام در هیربد خودرو با ایمیل و رمز عبور." },
      { property: "og:title", content: "ورود به هیربد خودرو" },
      { property: "og:description", content: "ورود مدیر و شرکا به سامانه هیربد خودرو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const [mode, setMode] = useState<"in" | "up" | "forgot">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        const { data: u } = await supabase.auth.getUser();
        const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user!.id);
        navigate({ to: roles?.some((r) => r.role === "admin") ? "/dashboard" : "/my" });
      } else if (mode === "up") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth", data: { full_name: name } },
        });
        if (error) throw error;
        toast.success("لینک تأیید به ایمیل شما ارسال شد. پس از تأیید وارد شوید.");
        setMode("in");
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
          <div className="text-2xl font-black">هیربد خودرو</div>
          <div className="text-sm text-muted-foreground mt-1">
            {mode === "in" ? "ورود به حساب" : mode === "up" ? "ساخت حساب جدید" : "بازیابی رمز عبور"}
          </div>
        </div>
        {mode === "up" && (
          <div className="space-y-2">
            <Label>نام و نام خانوادگی</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
        )}
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
          {mode === "in" ? "ورود" : mode === "up" ? "ثبت‌نام" : "ارسال لینک"}
        </Button>
        <div className="flex justify-between text-sm">
          <button type="button" className="text-primary" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "حساب ندارید؟ ثبت‌نام" : "ورود"}
          </button>
          {mode === "in" && (
            <button type="button" className="text-muted-foreground" onClick={() => setMode("forgot")}>
              فراموشی رمز
            </button>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-6">
          شرکا با همان ایمیلی که مدیر برایشان ثبت کرده ثبت‌نام کنند تا حسابشان خودکار متصل شود.
        </p>
      </form>
    </div>
  );
}
