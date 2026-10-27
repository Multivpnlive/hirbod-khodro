import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { usePerms } from "@/lib/data";
import { FeatureLinks } from "@/components/FeatureLinks";
import { errorText } from "@/lib/feature-utils";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "مشتریان | هیربد خودرو" }] }),
  component: CustomersPage,
});

const db = supabase as any;
type Customer = { id: string; name: string; phone: string | null; national_id: string | null; notes: string | null; is_demo: boolean };
type Partner = { id: string; name: string };
type Access = { id: string; customer_id: string; partner_id: string };

function CustomersPage() {
  const { isAdmin } = usePerms();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [access, setAccess] = useState<Access[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [c, p, a] = await Promise.all([
      db.from("customers").select("id,name,phone,national_id,notes,is_demo").eq("is_demo", false).order("created_at", { ascending: false }),
      db.from("partners").select("id,name").eq("is_demo", false).order("name"),
      db.from("customer_access").select("customer_id,partner_id"),
    ]);
    if (c.error) toast.error(`بارگذاری مشتریان: ${c.error.message}`);
    else setCustomers((c.data ?? []) as Customer[]);
    if (p.error) toast.error(`بارگذاری شرکا: ${p.error.message}`);
    else setPartners((p.data ?? []) as Partner[]);
    if (!a.error) setAccess((a.data ?? []) as Access[]);
  }
  useEffect(() => { void load(); }, []);

  async function createCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin) return;
    setBusy(true);
    const form = e.currentTarget;
    const f = new FormData(form);
    const payload = {
      name: String(f.get("name") ?? "").trim(),
      phone: String(f.get("phone") ?? "").trim() || null,
      national_id: String(f.get("national_id") ?? "").trim() || null,
      notes: String(f.get("notes") ?? "").trim() || null,
      is_demo: false,
    };
    if (!payload.name) { toast.error("نام مشتری الزامی است"); setBusy(false); return; }
    const { data, error } = await db.from("customers").insert(payload).select("id").single();
    if (error) { toast.error(errorText(error)); setBusy(false); return; }
    const partnerId = String(f.get("partner_id") ?? "");
    if (partnerId) {
      const grant = await db.from("customer_access").insert({ customer_id: data.id, partner_id: partnerId });
      if (grant.error) toast.error(`مشتری ثبت شد اما دسترسی شریک ثبت نشد: ${grant.error.message}`);
    }
    toast.success("مشتری ثبت شد");
    form.reset();
    await load();
    setBusy(false);
  }

  async function grantAccess(customerId: string, partnerId: string) {
    if (!partnerId) return;
    const { error } = await db.from("customer_access").upsert({ customer_id: customerId, partner_id: partnerId }, { onConflict: "customer_id,partner_id" });
    if (error) toast.error(error.message);
    else { toast.success("دسترسی ثبت شد"); await load(); }
  }

  async function revokeAccess(customerId: string, partnerId: string) {
    const { error } = await db.from("customer_access").delete().eq("customer_id", customerId).eq("partner_id", partnerId);
    if (error) toast.error(error.message);
    else { toast.success("دسترسی حذف شد"); await load(); }
  }

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader title="مشتریان" />
      <FeatureLinks />
      {isAdmin && <form onSubmit={createCustomer} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2">
        <h2 className="font-semibold md:col-span-2">ثبت مشتری جدید</h2>
        <label className="grid gap-1 text-sm">نام و نام خانوادگی<input name="name" required className="rounded-md border bg-background px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">تلفن<input name="phone" inputMode="tel" className="rounded-md border bg-background px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">کد ملی<input name="national_id" inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">اعطای دسترسی اولیه به شریک<select name="partner_id" className="rounded-md border bg-background px-3 py-2"><option value="">بدون دسترسی شریک</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm md:col-span-2">یادداشت<textarea name="notes" rows={2} className="rounded-md border bg-background px-3 py-2" /></label>
        <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:col-span-2">{busy ? "در حال ثبت…" : "ثبت مشتری"}</button>
      </form>}
      <section className="space-y-3">
        <h2 className="font-semibold">فهرست مشتریان ({customers.length.toLocaleString("fa-IR")})</h2>
        {customers.map((c) => {
          const grants = access.filter((a) => a.customer_id === c.id);
          return <article key={c.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{c.name}</h3><p className="text-sm text-muted-foreground">{c.phone || "تلفن ثبت نشده"} {c.national_id ? ` · کد ملی ${c.national_id}` : ""}</p>{c.notes && <p className="mt-1 text-sm">{c.notes}</p>}</div><span className="text-xs text-muted-foreground">{grants.length.toLocaleString("fa-IR")} دسترسی شریک</span></div>
            {isAdmin && <div className="flex flex-wrap items-center gap-2 border-t pt-3"><select id={`grant-${c.id}`} className="rounded-md border bg-background px-3 py-2 text-sm"><option value="">انتخاب شریک برای دسترسی</option>{partners.filter((p) => !grants.some((g) => g.partner_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="rounded-md border px-3 py-2 text-sm" onClick={() => { const el = document.getElementById(`grant-${c.id}`) as HTMLSelectElement | null; if (el) void grantAccess(c.id, el.value); }}>افزودن دسترسی</button>{grants.map((g) => <button key={g.partner_id} className="rounded-md border px-2 py-1 text-xs" onClick={() => void revokeAccess(c.id, g.partner_id)}>{partners.find((p) => p.id === g.partner_id)?.name ?? "شریک"} ×</button>)}</div>}
          </article>;
        })}
        {customers.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">{isAdmin ? "هنوز مشتری ثبت نشده است." : "مشتری مجازی برای این حساب در دسترس نیست؛ دسترسی باید به‌صورت صریح توسط مدیر داده شود."}</p>}
      </section>
    </div>
  );
}
