import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { JalaliDateField } from "@/components/JalaliDateField";
import { usePerms } from "@/lib/data";
import { amountValue, errorText, faMoney, faNumber } from "@/lib/feature-utils";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/fund-transfers")({
  head: () => ({ meta: [{ title: "انتقال وجه امانی | هیربد خودرو" }] }),
  component: FundTransfersPage,
});

const db = supabase as any;
type Customer = { id: string; name: string };
type Transfer = { id: string; customer_id: string; amount: number; target: string; transfer_date: string; notes: string | null; is_demo: boolean };
type Txn = { customer_id: string | null; fund: string; type: string; amount: number; is_demo: boolean };

function FundTransfersPage() {
  const { isAdmin } = usePerms();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [c, f, t] = await Promise.all([
      db.from("customers").select("id,name").eq("is_demo", false).order("name"),
      db.from("fund_transfers").select("id,customer_id,amount,target,transfer_date,notes,is_demo").eq("is_demo", false).order("transfer_date", { ascending: false }),
      db.from("transactions").select("customer_id,fund,type,amount,is_demo").eq("fund", "custody").eq("is_demo", false),
    ]);
    if (c.error) toast.error(c.error.message); else setCustomers((c.data ?? []) as Customer[]);
    if (f.error) toast.error(`انتقال‌ها: ${f.error.message}`); else setTransfers((f.data ?? []) as Transfer[]);
    if (t.error) toast.error(`تراکنش‌های امانی: ${t.error.message}`); else setTxns((t.data ?? []) as Txn[]);
  }
  useEffect(() => { void load(); }, []);

  function custodyBalance(customerId: string) {
    const txnBalance = txns.filter((t) => t.customer_id === customerId).reduce((sum, t) => sum + (t.type === "receipt" ? Number(t.amount) : -Number(t.amount)), 0);
    const transferred = transfers.filter((t) => t.customer_id === customerId).reduce((sum, t) => sum + Number(t.amount), 0);
    return txnBalance - transferred;
  }

  async function createTransfer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!isAdmin) return;
    const form = e.currentTarget; const f = new FormData(form);
    const customerId = String(f.get("customer_id") ?? ""); const amount = amountValue(f.get("amount"));
    if (!customerId || amount <= 0) { toast.error("مشتری و مبلغ معتبر الزامی است"); return; }
    setBusy(true);
    const { error } = await db.from("fund_transfers").insert({
      customer_id: customerId, amount, target: String(f.get("target") || "business"),
      transfer_date: String(f.get("date") || todayIso()), notes: String(f.get("notes") ?? "").trim() || null, is_demo: false,
    });
    if (error) toast.error(errorText(error));
    else { toast.success("انتقال از امانی به وجوه کسب‌وکار ثبت شد؛ تراکنش نقدی تکراری ساخته نشد"); form.reset(); await load(); }
    setBusy(false);
  }

  if (!isAdmin) return <div className="space-y-3"><PageHeader title="انتقال وجه امانی" /><p className="rounded-lg border p-4">مشاهده و انتقال وجوه امانی فقط برای مدیر مجاز است.</p></div>;
  return <div className="space-y-5" dir="rtl">
    <PageHeader title="انتقال از امانی مشتری به کسب‌وکار" />
    <div className="rounded-xl border bg-card p-4 text-sm leading-7 text-muted-foreground">این عملیات پول جدیدی ایجاد نمی‌کند: مانده امانی مشتری را کاهش می‌دهد و همان مبلغ را به وجوه قابل‌استفاده کسب‌وکار تخصیص می‌دهد. از این مسیر برای واریز فیزیکی جدید استفاده نکن؛ واریز فیزیکی باید یک تراکنش `receipt` با `fund=custody` باشد.</div>
    <form onSubmit={createTransfer} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2 xl:grid-cols-3">
      <h2 className="font-semibold md:col-span-2 xl:col-span-3">ثبت انتقال</h2>
      <label className="grid gap-1 text-sm">مشتری<select name="customer_id" required className="rounded-md border bg-background px-3 py-2"><option value="">انتخاب مشتری</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name} · مانده {faMoney(custodyBalance(c.id))}</option>)}</select></label>
      <label className="grid gap-1 text-sm">مبلغ انتقال (تومان)<input name="amount" inputMode="numeric" required className="rounded-md border bg-background px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">هدف تخصیص<select name="target" className="rounded-md border bg-background px-3 py-2"><option value="business">وجوه عمومی کسب‌وکار</option><option value="business_commission">کارمزد واسطه‌گری</option><option value="business_expense">هزینه کسب‌وکار</option><option value="other">سایر</option></select></label>
      <label className="grid gap-1 text-sm">تاریخ<JalaliDateField name="date" defaultValue={todayIso()} /></label>
      <label className="grid gap-1 text-sm md:col-span-2">شرح<input name="notes" className="rounded-md border bg-background px-3 py-2" /></label>
      <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:col-span-2 xl:col-span-3">{busy ? "در حال ثبت…" : "ثبت انتقال امانی"}</button>
    </form>
    <section className="space-y-3"><h2 className="font-semibold">مانده امانی مشتریان</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{customers.map((c) => <article key={c.id} className="rounded-xl border bg-card p-4"><div className="font-semibold">{c.name}</div><div className="mt-2 text-xl font-bold">{faMoney(custodyBalance(c.id))}</div><div className="text-xs text-muted-foreground">مانده پس از کسر انتقال‌های قبلی</div></article>)}</div>
    </section>
    <section className="space-y-3"><h2 className="font-semibold">تاریخچه انتقال‌ها ({faNumber(transfers.length)})</h2>
      <div className="divide-y rounded-xl border bg-card">{transfers.map((t) => <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"><div><div className="font-medium">{customers.find((c) => c.id === t.customer_id)?.name ?? "مشتری"} · {t.target}</div><div className="text-xs text-muted-foreground">{t.transfer_date} · {t.notes || "بدون شرح"}</div></div><b>{faMoney(t.amount)}</b></div>)}{transfers.length === 0 && <p className="p-4 text-sm text-muted-foreground">هنوز انتقالی ثبت نشده است.</p>}</div>
    </section>
  </div>;
}
