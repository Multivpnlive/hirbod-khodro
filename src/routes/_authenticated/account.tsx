import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, ShieldCheck, UserRound, CalendarDays, Save, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { useMe } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({ meta: [{ title: "حساب کاربری | هیربد خودرو" }] }),
  component: AccountPage,
});

function AccountPage() {
  const meQuery = useMe();
  const me = meQuery.data;
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);

  useEffect(() => {
    const metadata = me?.user.user_metadata ?? {};
    setFullName(String(metadata.full_name ?? metadata.name ?? ""));
  }, [me?.user.id, me?.user.user_metadata?.full_name, me?.user.user_metadata?.name]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.user) return;
    const name = fullName.trim();
    if (name.length < 2) {
      toast.error("نام باید دست‌کم دو نویسه باشد.");
      return;
    }
    setProfileBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { ...me.user.user_metadata, full_name: name },
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("اطلاعات حساب ذخیره شد.");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setProfileBusy(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!me?.user.email) {
      toast.error("برای این حساب ایمیل معتبری ثبت نشده است.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("رمز جدید باید حداقل ۸ نویسه داشته باشد.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("رمز جدید و تکرار آن یکسان نیستند.");
      return;
    }
    if (newPassword === currentPassword) {
      toast.error("رمز جدید باید با رمز فعلی متفاوت باشد.");
      return;
    }

    setPasswordBusy(true);
    try {
      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: me.user.email,
        password: currentPassword,
      });
      if (verifyError) throw new Error("رمز عبور فعلی صحیح نیست.");

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast.success("رمز عبور با موفقیت تغییر کرد.");
    } catch (error) {
      toast.error(readableError(error));
    } finally {
      setPasswordBusy(false);
    }
  }

  if (meQuery.isLoading) return <div className="text-muted-foreground py-10">در حال بارگذاری حساب کاربری…</div>;
  if (!me?.user) return <div className="card-elevated p-6">برای مشاهده حساب کاربری، ابتدا وارد شوید.</div>;

  const user = me.user;
  const createdAt = user.created_at
    ? new Intl.DateTimeFormat("fa-IR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(user.created_at))
    : "—";

  return (
    <div dir="rtl" className="mx-auto max-w-4xl">
      <PageHeader title="حساب کاربری" />

      <section className="card-elevated overflow-hidden mb-5">
        <div className="bg-hero px-5 py-6 sm:px-7 flex items-center gap-4 text-white">
          <div className="size-14 shrink-0 rounded-2xl border border-white/25 bg-white/10 grid place-items-center">
            <UserRound className="size-7" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold truncate">{fullName.trim() || "کاربر هیربد خودرو"}</h2>
            <p className="mt-1 text-sm text-white/80" dir="ltr">{user.email}</p>
          </div>
          <span className="mr-auto inline-flex items-center gap-1 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold whitespace-nowrap">
            <ShieldCheck className="size-4" />{me.isAdmin ? "مدیر سامانه" : me.staffRole === "finance_manager" ? "مدیر مالی" : me.staffRole === "sales" ? "فروشنده" : me.staffRole === "limited" ? "کاربر محدود" : "حساب شریک"}
          </span>
        </div>
        <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
          <div className="flex items-center gap-3 rounded-xl border bg-background/70 p-3">
            <Mail className="size-5 text-primary shrink-0" />
            <div className="min-w-0"><p className="text-xs text-muted-foreground">ایمیل حساب</p><p className="mt-1 break-all text-sm font-semibold" dir="ltr">{user.email}</p></div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border bg-background/70 p-3">
            <CalendarDays className="size-5 text-primary shrink-0" />
            <div><p className="text-xs text-muted-foreground">تاریخ ایجاد حساب</p><p className="mt-1 text-sm font-semibold">{createdAt}</p></div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card-elevated p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><UserRound className="size-5" /></div><div><h2 className="font-bold">اطلاعات شخصی</h2><p className="text-sm text-muted-foreground mt-1">نام نمایشی حساب خود را ویرایش کنید.</p></div></div>
          <form className="space-y-4" onSubmit={saveProfile}>
            <div className="space-y-2"><Label htmlFor="account-name">نام و نام خانوادگی</Label><Input id="account-name" autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={120} required /></div>
            <div className="space-y-2"><Label htmlFor="account-email">ایمیل</Label><Input id="account-email" value={user.email ?? ""} readOnly dir="ltr" className="opacity-80" /><p className="text-xs leading-6 text-muted-foreground">ایمیل فعلاً از این صفحه قابل تغییر نیست.</p></div>
            <Button type="submit" className="w-full" disabled={profileBusy}><Save className="size-4" />{profileBusy ? "در حال ذخیره…" : "ذخیره اطلاعات"}</Button>
          </form>
        </section>

        <section className="card-elevated p-5 sm:p-6">
          <div className="mb-5 flex items-center gap-3"><div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground"><LockKeyhole className="size-5" /></div><div><h2 className="font-bold">امنیت و رمز عبور</h2><p className="text-sm text-muted-foreground mt-1">برای تغییر رمز، ابتدا رمز فعلی را تأیید کنید.</p></div></div>
          <form className="space-y-4" onSubmit={changePassword}>
            <div className="space-y-2"><Label htmlFor="current-password">رمز عبور فعلی</Label><Input id="current-password" type="password" autoComplete="current-password" dir="ltr" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="new-password">رمز عبور جدید</Label><Input id="new-password" type="password" autoComplete="new-password" dir="ltr" minLength={8} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /><p className="text-xs text-muted-foreground">حداقل ۸ نویسه انتخاب کنید.</p></div>
            <div className="space-y-2"><Label htmlFor="confirm-password">تکرار رمز جدید</Label><Input id="confirm-password" type="password" autoComplete="new-password" dir="ltr" minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></div>
            <Button type="submit" className="w-full" disabled={passwordBusy}><KeyRound className="size-4" />{passwordBusy ? "در حال تغییر…" : "تغییر رمز عبور"}</Button>
          </form>
        </section>
      </div>
    </div>
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "ذخیره تغییرات انجام نشد. دوباره تلاش کنید.";
}
