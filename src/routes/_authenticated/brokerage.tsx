import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { JalaliDateField } from "@/components/JalaliDateField";
import { usePerms } from "@/lib/data";
import { amountValue, errorText, faMoney, faNumber } from "@/lib/feature-utils";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/brokerage")({
  head: () => ({ meta: [{ title: "کارگزاری | هیربد خودرو" }] }),
  component: BrokeragePage,
});

const db = supabase as any;
type Customer = { id: string; name: string };
type Partner = { id: string; name: string };
type Hawala = { id: string; mode: string; status: string; face_amount: number };
type Deal = { id: string; customer_id: string | null; car_id: string | null; hawala_id: string | null; deal_value: number; commission: number; agreed_commission: number; deal_date: string; status: string; notes: string | null };
type Cost = { id: string; deal_id: string; amount: number; bearer: "business" | "customer"; description: string | null; cost_date: string };
type Split = { id?: string; deal_id: string; partner_id: string; pct: number };
type Car = { id: string; brand: string; model: string };

function BrokeragePage() {
  const { isAdmin } = usePerms();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [hawalas, setHawalas] = useState<Hawala[]>([]);
  const [cars, setCars] = useState<Car[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [splits, setSplits] = useState<Split[]>([]);
  const [splitId, setSplitId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [c, p, h, car, d, co, sp] = await Promise.all([
      db.from("customers").select("id,name").eq("is_demo", false).order("name"),
      db.from("partners").select("id,name").eq("is_demo", false).order("name"),
      db.from("hawalas").select("id,mode,status,face_amount").eq("is_demo", false),
      db.from("cars").select("id,brand,model").eq("is_demo", false),
      db.from("brokerage_deals").select("id,customer_id,car_id,hawala_id,deal_value,commission,agreed_commission,deal_date,status,notes").eq("is_demo", false).order("deal_date", { ascending: false }),
      db.from("brokerage_costs").select("id,deal_id,amount,bearer,description,cost_date").eq("is_demo", false),
      db.from("commission_splits").select("deal_id,partner_id,pct"),
    ]);
    if (c.error) toast.error(c.error.message); else setCustomers((c.data ?? []) as Customer[]);
    if (!p.error) setPartners((p.data ?? []) as Partner[]);
    if (!h.error) setHawalas((h.data ?? []) as Hawala[]);
    if (!car.error) setCars((car.data ?? []) as Car[]);
    if (d.error) toast.error(`معاملات کارگزاری: ${d.error.message}`); else setDeals((d.data ?? []) as Deal[]);
    if (!co.error) setCosts((co.data ?? []) as Cost[]);
    if (!sp.error) setSplits((sp.data ?? []) as Split[]);
  }
  useEffect(() => { void load(); }, []);

  async function createDeal(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!isAdmin) return;
    const form = e.currentTarget; const f = new FormData(form);
    const commission = amountValue(f.get("commission")); const dealValue = amountValue(f.get("deal_value"));
    const customerId = String(f.get("customer_id") ?? "");
    if (!customerId || commission < 0 || dealValue < 0) { toast.error("مشتری و مبالغ معتبر را وارد کن"); return; }
    setBusy(true);
    const { error } = await db.from("brokerage_deals").insert({
      customer_id: customerId, car_id: String(f.get("car_id") ?? "") || null,
      hawala_id: String(f.get("hawala_id") ?? "") || null,
      deal_value: dealValue, commission, agreed_commission: commission,
      deal_date: String(f.get("deal_date") || todayIso()), status: "open",
      notes: String(f.get("notes") ?? "").trim() || null, is_demo: false,
    });
    if (error) toast.error(errorText(error)); else { toast.success("توافق کارگزاری ثبت شد"); form.reset(); await load(); }
    setBusy(false);
  }

  async function addCost(e: FormEvent<HTMLFormElement>, deal: Deal) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const amount = amountValue(f.get("amount")); const bearer = String(f.get("bearer")) as "business" | "customer";
    if (amount <= 0) { toast.error("مبلغ هزینه باید بیشتر از صفر باشد"); return; }
    let txnId: string | null = null;
    if (bearer === "business") {
      const { data: tx, error: txError } = await db.from("transactions").insert({
        type: "expense", amount, txn_date: String(f.get("cost_date") || todayIso()), fund: "business",
        brokerage_deal_id: deal.id, purpose: "brokerage_cost", description: String(f.get("description") ?? "هزینه معامله کارگزاری"), is_demo: false,
      }).select("id").single();
      if (txError || !tx) { toast.error(errorText(txError)); return; }
      txnId = tx.id;
    }
    const { error } = await db.from("brokerage_costs").insert({ deal_id: deal.id, amount, bearer, cost_date: String(f.get("cost_date") || todayIso()), description: String(f.get("description") ?? "").trim() || null, is_demo: false });
    if (error) {
      if (txnId) await db.from("transactions").delete().eq("id", txnId);
      toast.error(errorText(error));
    } else { toast.success(bearer === "business" ? "هزینه ثبت شد؛ در جریان نقدی هم فقط یک بار ثبت شد" : "هزینه برعهده مشتری ثبت شد و از سود کم نشد"); form.reset(); await load(); }
  }

  async function addSplit(e: FormEvent<HTMLFormElement>, deal: Deal) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const partnerId = String(f.get("partner_id") ?? ""); const pct = Number(f.get("pct"));
    if (!partnerId || !Number.isFinite(pct) || pct <= 0 || pct > 100) { toast.error("شریک و درصد معتبر لازم است"); return; }
    const { error } = await db.from("commission_splits").upsert({ deal_id: deal.id, partner_id: partnerId, pct }, { onConflict: "deal_id,partner_id" });
    if (error) toast.error(errorText(error)); else { toast.success("سهم کمیسیون ثبت شد"); form.reset(); await load(); }
  }

  async function recordCommission(deal: Deal) {
    const already = await db.from("transactions").select("amount").eq("brokerage_deal_id", deal.id).eq("purpose", "brokerage_commission").eq("type", "receipt").eq("is_demo", false);
    if (already.error) { toast.error(already.error.message); return; }
    const received = (already.data ?? []).reduce((s: number, r: { amount: number }) => s + Number(r.amount), 0);
    const remaining = Number(deal.agreed_commission ?? deal.commission) - received;
    const raw = window.prompt(`ثبت دریافت کمیسیون (مانده: ${faMoney(remaining)})`);
    if (raw === null) return;
    const amount = amountValue(raw);
    if (amount <= 0 || amount > remaining) { toast.error("مبلغ باید مثبت و حداکثر برابر مانده کمیسیون باشد"); return; }
    const dealSplits = splits.filter((s) => s.deal_id === deal.id);
    const pctSum = dealSplits.reduce((s, x) => s + Number(x.pct), 0);
    if (dealSplits.length > 0 && Math.round(pctSum * 100) / 100 !== 100) { toast.error("جمع درصدهای تقسیم کمیسیون باید دقیقاً ۱۰۰٪ باشد یا فعلاً هیچ تقسیمی تعریف نشود"); return; }
    const { error } = await db.from("transactions").insert({
      type: "receipt", amount, txn_date: todayIso(), fund: "business", customer_id: deal.customer_id,
      brokerage_deal_id: deal.id, purpose: "brokerage_commission", description: "دریافت کمیسیون کارگزاری", is_demo: false,
    });
    if (error) toast.error(errorText(error)); else { toast.success("دریافت کمیسیون ثبت شد؛ درآمد فقط کمیسیون است، نه ارزش کل معامله"); await load(); }
  }

  return <div className="space-y-5" dir="rtl">
    <PageHeader title="کارگزاری و کمیسیون" />
    <div className="rounded-xl border bg-card p-4 text-sm leading-7 text-muted-foreground">ارزش کل معامله درآمد نیست. فقط کمیسیون توافق‌شده، پس از کسر هزینه‌های کسب‌وکار، درآمد کارگزاری است. وجه مشتری و هزینه‌های قابل‌بازپرداخت به سود اضافه نمی‌شوند؛ بدون توافق تقسیم، سهم هیچ شریکی خودکار تعیین نمی‌شود.</div>
    {isAdmin && <form onSubmit={createDeal} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2 xl:grid-cols-3">
      <h2 className="font-semibold md:col-span-2 xl:col-span-3">ثبت توافق کارگزاری</h2>
      <label className="grid gap-1 text-sm">مشتری<select name="customer_id" required className="rounded-md border bg-background px-3 py-2"><option value="">انتخاب مشتری</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm">حواله مرتبط (اختیاری)<select name="hawala_id" className="rounded-md border bg-background px-3 py-2"><option value="">بدون حواله</option>{hawalas.map((h) => <option key={h.id} value={h.id}>{h.id.slice(0, 8)} · {h.mode} · {h.status}</option>)}</select></label>
      <label className="grid gap-1 text-sm">خودرو مرتبط (اختیاری)<select name="car_id" className="rounded-md border bg-background px-3 py-2"><option value="">بدون خودرو</option>{cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model}</option>)}</select></label>
      <label className="grid gap-1 text-sm">ارزش کل معامله (تومان)<input name="deal_value" inputMode="numeric" defaultValue="0" required className="rounded-md border bg-background px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">کمیسیون توافق‌شده (تومان)<input name="commission" inputMode="numeric" required className="rounded-md border bg-background px-3 py-2" /></label>
      <label className="grid gap-1 text-sm">تاریخ توافق<JalaliDateField name="deal_date" defaultValue={todayIso()} /></label>
      <label className="grid gap-1 text-sm md:col-span-2 xl:col-span-3">شرح<input name="notes" className="rounded-md border bg-background px-3 py-2" /></label>
      <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:col-span-2 xl:col-span-3">{busy ? "در حال ثبت…" : "ثبت توافق"}</button>
    </form>}
    <section className="space-y-3"><h2 className="font-semibold">توافق‌های ثبت‌شده ({faNumber(deals.length)})</h2>
      {deals.map((d) => {
        const dealCosts = costs.filter((c) => c.deal_id === d.id);
        const businessCost = dealCosts.filter((c) => c.bearer === "business").reduce((s, c) => s + Number(c.amount), 0);
        const dealSplits = splits.filter((s) => s.deal_id === d.id);
        const splitSum = dealSplits.reduce((s, x) => s + Number(x.pct), 0);
        return <article key={d.id} className="space-y-3 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{customers.find((c) => c.id === d.customer_id)?.name ?? "مشتری"}</h3><p className="text-xs text-muted-foreground">{d.deal_date} · {d.notes || "بدون شرح"}</p></div><span className="rounded-full border px-3 py-1 text-xs">{d.status === "completed" ? "تکمیل‌شده" : d.status === "cancelled" ? "لغوشده" : "باز"}</span></div>
          <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4"><div><span className="text-muted-foreground">ارزش معامله (درآمد نیست)</span><p className="font-semibold">{faMoney(d.deal_value)}</p></div><div><span className="text-muted-foreground">کمیسیون توافقی</span><p className="font-semibold">{faMoney(d.agreed_commission ?? d.commission)}</p></div><div><span className="text-muted-foreground">هزینه کسب‌وکار</span><p className="font-semibold">{faMoney(businessCost)}</p></div><div><span className="text-muted-foreground">خالص کمیسیون</span><p className="font-semibold">{faMoney(Number(d.agreed_commission ?? d.commission) - businessCost)}</p></div></div>
          {isAdmin && <div className="flex flex-wrap gap-2 border-t pt-3"><button className="rounded-md border px-3 py-2 text-sm" onClick={() => setSplitId(splitId === d.id ? null : d.id)}>تقسیم کمیسیون</button><button className="rounded-md border px-3 py-2 text-sm" onClick={() => void recordCommission(d)}>ثبت دریافت کمیسیون</button></div>}
          {dealCosts.map((c) => <div key={c.id} className="flex justify-between gap-2 text-xs text-muted-foreground"><span>{c.bearer === "business" ? "هزینه کسب‌وکار" : "هزینه مشتری"} · {c.description || "بدون شرح"}</span><span>{faMoney(c.amount)}</span></div>)}
          {dealSplits.length > 0 && <div className="flex flex-wrap gap-2">{dealSplits.map((s) => <span key={s.partner_id} className="rounded-full border px-2 py-1 text-xs">{partners.find((p) => p.id === s.partner_id)?.name ?? "شریک"}: {faNumber(s.pct)}٪</span>)}<span className={`rounded-full border px-2 py-1 text-xs ${Math.round(splitSum * 100) / 100 === 100 ? "text-green-600" : "text-destructive"}`}>جمع: {faNumber(splitSum)}٪</span></div>}
          {isAdmin && splitId === d.id && <form onSubmit={(e) => void addSplit(e, d)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">شریک<select name="partner_id" required className="rounded-md border bg-background px-3 py-2"><option value="">انتخاب شریک</option>{partners.filter((p) => !dealSplits.some((s) => s.partner_id === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="grid gap-1 text-sm">درصد سهم<input name="pct" type="number" min="0.01" max="100" step="0.01" required className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">ثبت سهم</button></form>}
          {isAdmin && <form onSubmit={(e) => void addCost(e, d)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-4"><label className="grid gap-1 text-sm">مبلغ هزینه<input name="amount" inputMode="numeric" required className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">بر عهده<select name="bearer" className="rounded-md border bg-background px-3 py-2"><option value="business">کسب‌وکار</option><option value="customer">مشتری</option></select></label><label className="grid gap-1 text-sm">تاریخ<JalaliDateField name="cost_date" defaultValue={todayIso()} /></label><label className="grid gap-1 text-sm">شرح<input name="description" className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg border px-3 py-2 sm:col-span-4">ثبت هزینه مرتبط</button></form>}
        </article>;
      })}
      {deals.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">توافق کارگزاری در دسترس نیست؛ مشاهده کارگزاری و مشتری مرتبط باید از طرف مدیر مجاز شده باشد.</p>}
    </section>
  </div>;
}
