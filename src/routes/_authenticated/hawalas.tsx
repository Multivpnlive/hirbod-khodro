import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { JalaliDateField } from "@/components/JalaliDateField";
import { usePerms } from "@/lib/data";
import { amountValue, errorText, faMoney, faNumber } from "@/lib/feature-utils";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/hawalas")({
  head: () => ({ meta: [{ title: "حواله‌ها | هیربد خودرو" }] }),
  component: HawalasPage,
});

const db = supabase as any;
type Customer = { id: string; name: string };
type Partner = { id: string; name: string };
type Hawala = { id: string; mode: "own_hold" | "own_trade" | "client_brokerage"; face_amount: number; cost_basis: number; status: string; customer_id: string | null; hawala_date: string; notes: string | null; is_demo: boolean };
type HawalaSale = { hawala_id: string; sale_amount: number; sale_date: string; buyer_customer_id: string | null };
type Investment = { hawala_id: string; partner_id: string; amount: number };
type Receipt = { hawala_id: string | null; amount: number };
const MODE_LABEL: Record<string, string> = { own_hold: "خرید برای کسب‌وکار و تبدیل به خودرو", own_trade: "خریدوفروش حواله بدون تحویل خودرو", client_brokerage: "سفارش حواله برای مشتری با وجه امانی" };
const STATUS_LABEL: Record<string, string> = { held: "در اختیار", converted: "تبدیل‌شده به خودرو", sold: "فروخته‌شده", cancelled: "لغوشده" };

function HawalasPage() {
  const { isAdmin } = usePerms();
  const [rows, setRows] = useState<Hawala[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [sales, setSales] = useState<HawalaSale[]>([]);
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [busy, setBusy] = useState(false);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [investId, setInvestId] = useState<string | null>(null);
  const [saleId, setSaleId] = useState<string | null>(null);

  async function load() {
    const [h, c, p, s, i, r] = await Promise.all([
      db.from("hawalas").select("id,mode,face_amount,cost_basis,status,customer_id,hawala_date,notes,is_demo").eq("is_demo", false).order("created_at", { ascending: false }),
      db.from("customers").select("id,name").eq("is_demo", false).order("name"),
      db.from("partners").select("id,name").eq("is_demo", false).eq("is_active", true).order("name"),
      db.from("hawala_sales").select("hawala_id,sale_amount,sale_date,buyer_customer_id"),
      db.from("hawala_investments").select("hawala_id,partner_id,amount").eq("is_demo", false),
      db.from("transactions").select("hawala_id,amount").eq("purpose", "hawala_sale").eq("type", "receipt").eq("is_demo", false),
    ]);
    if (h.error) toast.error(`بارگذاری حواله‌ها: ${h.error.message}`); else setRows((h.data ?? []) as Hawala[]);
    if (c.error) toast.error(`بارگذاری مشتریان: ${c.error.message}`); else setCustomers((c.data ?? []) as Customer[]);
    if (!p.error) setPartners((p.data ?? []) as Partner[]);
    if (!s.error) setSales((s.data ?? []) as HawalaSale[]);
    if (!i.error) setInvestments((i.data ?? []) as Investment[]);
    if (!r.error) setReceipts((r.data ?? []) as Receipt[]);
  }
  useEffect(() => { void load(); }, []);

  async function createHawala(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isAdmin) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const mode = String(f.get("mode")) as Hawala["mode"];
    const amount = amountValue(f.get("purchase_amount"));
    const face = amountValue(f.get("face_amount"));
    const customerId = String(f.get("customer_id") ?? "") || null;
    if (face <= 0 || amount <= 0) { toast.error("قیمت حواله و مبلغ خرید باید بیشتر از صفر باشند"); return; }
    if (mode === "client_brokerage" && !customerId) { toast.error("برای حواله مشتری، انتخاب مشتری الزامی است"); return; }
    setBusy(true);
    const { data: hawala, error } = await db.from("hawalas").insert({
      mode, face_amount: face, cost_basis: 0, status: "held", customer_id: customerId,
      hawala_date: String(f.get("date") || todayIso()), notes: String(f.get("notes") ?? "").trim() || null,
      is_demo: false,
    }).select("id").single();
    if (error || !hawala) { toast.error(errorText(error)); setBusy(false); return; }
    const fund = mode === "client_brokerage" ? "custody" : "business";
    const txn = await db.from("transactions").insert({
      type: "payment", amount, txn_date: String(f.get("date") || todayIso()), fund,
      customer_id: fund === "custody" ? customerId : null,
      hawala_id: hawala.id, purpose: "hawala_purchase", description: `خرید حواله ${mode === "client_brokerage" ? "برای مشتری" : "کسب‌وکار"}`,
      is_demo: false,
    });
    if (txn.error) {
      await db.from("hawalas").delete().eq("id", hawala.id);
      toast.error(`حواله ثبت نشد: ${txn.error.message}`);
      setBusy(false);
      return;
    }
    toast.success("حواله و خروج وجه آن ثبت شد");
    form.reset();
    await load();
    setBusy(false);
  }

  async function addInvestment(e: FormEvent<HTMLFormElement>, hawalaId: string) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const partnerId = String(f.get("partner_id") ?? ""); const amount = amountValue(f.get("amount"));
    if (!partnerId || amount <= 0) { toast.error("شریک و مبلغ سرمایه را مشخص کن"); return; }
    const { error } = await db.from("hawala_investments").upsert({ hawala_id: hawalaId, partner_id: partnerId, amount, is_demo: false }, { onConflict: "hawala_id,partner_id" });
    if (error) toast.error(error.message); else { toast.success("سرمایه شریک در حواله ثبت شد"); form.reset(); await load(); }
  }

  async function convertHawala(e: FormEvent<HTMLFormElement>, h: Hawala) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    if (h.mode !== "own_hold" || h.status !== "held") { toast.error("فقط حواله در اختیار کسب‌وکار قابل تبدیل است"); return; }
    const extra = amountValue(f.get("extra_cash"));
    const purchaseDate = String(f.get("purchase_date") || todayIso());
    let extraTxnId: string | null = null;
    if (extra > 0) {
      const { data: txn, error: txnErr } = await db.from("transactions").insert({
        type: "payment", amount: extra, txn_date: purchaseDate, fund: "business", hawala_id: h.id,
        purpose: "hawala_conversion_extra", description: "وجه نقد اضافه هنگام تبدیل حواله به خودرو", is_demo: false,
      }).select("id").single();
      if (txnErr || !txn) { toast.error(errorText(txnErr)); return; }
      extraTxnId = txn.id;
    }
    const { data: car, error } = await db.from("cars").insert({
      brand: String(f.get("brand") ?? "").trim(), model: String(f.get("model") ?? "").trim(),
      year: amountValue(f.get("year")) || null, color: String(f.get("color") ?? "").trim() || null,
      plate: String(f.get("plate") ?? "").trim() || null,
      purchase_price: Number(h.cost_basis) + extra, purchase_date: purchaseDate,
      status: "available", notes: `تبدیل از حواله ${h.id.slice(0, 8)}`, source_hawala_id: h.id, is_demo: false,
    }).select("id").single();
    if (error || !car) {
      if (extraTxnId) await db.from("transactions").delete().eq("id", extraTxnId);
      toast.error(`تبدیل انجام نشد: ${errorText(error)}`);
      return;
    }
    toast.success("حواله به خودرو تبدیل شد؛ پرداخت تکراری برای بهای حواله ثبت نشد");
    setConvertId(null); await load();
  }

  async function registerSale(e: FormEvent<HTMLFormElement>, h: Hawala) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const amount = amountValue(f.get("sale_amount"));
    if (amount <= 0) { toast.error("قیمت فروش باید بیشتر از صفر باشد"); return; }
    const { error } = await db.from("hawala_sales").insert({
      hawala_id: h.id, sale_amount: amount, sale_date: String(f.get("sale_date") || todayIso()),
      buyer_customer_id: String(f.get("buyer_customer_id") ?? "") || null, notes: String(f.get("notes") ?? "").trim() || null, is_demo: false,
    });
    if (error) toast.error(error.message); else { toast.success("فروش قراردادی حواله ثبت شد؛ دریافت وجه جداگانه ثبت می‌شود"); setSaleId(null); await load(); }
  }

  async function recordReceipt(h: Hawala) {
    const sale = sales.find((s) => s.hawala_id === h.id);
    if (!sale) return;
    const input = window.prompt(`مبلغ دریافتی از فروش حواله (مانده قرارداد: ${faMoney(Number(sale.sale_amount) - receiptSum(h.id))})`);
    if (input === null) return;
    const amount = amountValue(input);
    if (amount <= 0) { toast.error("مبلغ معتبر نیست"); return; }
    const { error } = await db.from("transactions").insert({
      type: "receipt", amount, txn_date: todayIso(), fund: "business", customer_id: sale.buyer_customer_id,
      hawala_id: h.id, purpose: "hawala_sale", description: "وصول فروش حواله", is_demo: false,
    });
    if (error) toast.error(error.message); else { toast.success("دریافت حواله ثبت شد"); await load(); }
  }

  function receiptSum(hawalaId: string) {
    return receipts.filter((r) => r.hawala_id === hawalaId).reduce((sum, r) => sum + Number(r.amount), 0);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader title="حواله‌ها" />
      <div className="rounded-xl border bg-card p-4 text-sm leading-7 text-muted-foreground">سه مدل پشتیبانی می‌شود: خرید برای تبدیل به خودرو، خریدوفروش حواله بدون تحویل خودرو، و سفارش مشتری با وجه امانی. تبدیل حواله به خودرو تراکنش خرید دوم نمی‌سازد.</div>
      {isAdmin && <form onSubmit={createHawala} className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2 xl:grid-cols-3">
        <h2 className="font-semibold md:col-span-2 xl:col-span-3">ثبت حواله جدید</h2>
        <label className="grid gap-1 text-sm">نوع حواله<select name="mode" className="rounded-md border bg-background px-3 py-2"><option value="own_hold">خرید برای کسب‌وکار و تبدیل به خودرو</option><option value="own_trade">خریدوفروش حواله بدون تحویل خودرو</option><option value="client_brokerage">سفارش حواله برای مشتری با وجه امانی</option></select></label>
        <label className="grid gap-1 text-sm">مشتری (برای مدل امانی الزامی)<select name="customer_id" className="rounded-md border bg-background px-3 py-2"><option value="">بدون انتخاب</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm">مبلغ اسمی/توافقی حواله (تومان)<input name="face_amount" required inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">مبلغ واقعی خرید/پرداخت (تومان)<input name="purchase_amount" required inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label>
        <label className="grid gap-1 text-sm">تاریخ خرید<JalaliDateField name="date" defaultValue={todayIso()} /></label>
        <label className="grid gap-1 text-sm">شرح<input name="notes" className="rounded-md border bg-background px-3 py-2" /></label>
        <button disabled={busy} className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:col-span-2 xl:col-span-3">{busy ? "در حال ثبت…" : "ثبت حواله و ثبت یک‌باره خروج وجه"}</button>
      </form>}
      <section className="space-y-3"><h2 className="font-semibold">فهرست حواله‌ها ({faNumber(rows.length)})</h2>
        {rows.map((h) => {
          const customer = customers.find((c) => c.id === h.customer_id);
          const sale = sales.find((s) => s.hawala_id === h.id);
          const invs = investments.filter((i) => i.hawala_id === h.id);
          return <article key={h.id} className="space-y-3 rounded-xl border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="font-semibold">{MODE_LABEL[h.mode] ?? h.mode}</div><p className="mt-1 text-sm text-muted-foreground">{h.hawala_date} · {customer ? `مشتری: ${customer.name}` : "مشتری ندارد"} · {h.notes || "بدون شرح"}</p></div><span className="rounded-full border px-3 py-1 text-xs">{STATUS_LABEL[h.status] ?? h.status}</span></div>
            <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">مبلغ توافقی</span><p className="font-semibold">{faMoney(h.face_amount)}</p></div><div><span className="text-muted-foreground">بهای واقعی حواله</span><p className="font-semibold">{faMoney(h.cost_basis)}</p></div><div><span className="text-muted-foreground">سرمایه ثبت‌شده شرکا</span><p className="font-semibold">{faMoney(invs.reduce((s, i) => s + Number(i.amount), 0))}</p></div></div>
            {sale && <div className="rounded-lg bg-muted p-3 text-sm">قرارداد فروش: {faMoney(sale.sale_amount)} · تاریخ {sale.sale_date}{h.mode === "own_trade" ? ` · سود/زیان توافقی: ${faMoney(Number(sale.sale_amount) - Number(h.cost_basis))}` : ""}</div>}
            {invs.length > 0 && <div className="flex flex-wrap gap-2">{invs.map((i) => <span key={i.partner_id} className="rounded-full border px-2 py-1 text-xs">{partners.find((p) => p.id === i.partner_id)?.name ?? "شریک"}: {faMoney(i.amount)}</span>)}</div>}
            {isAdmin && <div className="flex flex-wrap gap-2 border-t pt-3">
              {h.status === "held" && h.mode !== "client_brokerage" && <button className="rounded-md border px-3 py-2 text-sm" onClick={() => { setInvestId(investId === h.id ? null : h.id); setConvertId(null); setSaleId(null); }}>ثبت سرمایه شریک</button>}
              {h.status === "held" && h.mode === "own_hold" && <button className="rounded-md border px-3 py-2 text-sm" onClick={() => { setConvertId(convertId === h.id ? null : h.id); setInvestId(null); setSaleId(null); }}>تبدیل به خودرو</button>}
              {h.status === "held" && h.mode === "own_trade" && <button className="rounded-md border px-3 py-2 text-sm" onClick={() => { setSaleId(saleId === h.id ? null : h.id); setInvestId(null); setConvertId(null); }}>ثبت قرارداد فروش حواله</button>}
              {h.status === "sold" && h.mode === "own_trade" && <button className="rounded-md border px-3 py-2 text-sm" onClick={() => void recordReceipt(h)}>ثبت وصول فروش حواله</button>}
            </div>}
            {isAdmin && investId === h.id && <form onSubmit={(e) => void addInvestment(e, h.id)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">شریک<select name="partner_id" required className="rounded-md border bg-background px-3 py-2"><option value="">انتخاب شریک</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label className="grid gap-1 text-sm">مبلغ سرمایه<input name="amount" inputMode="numeric" required className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground">ذخیره سرمایه</button></form>}
            {isAdmin && convertId === h.id && <form onSubmit={(e) => void convertHawala(e, h)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">برند<input name="brand" required className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">مدل<input name="model" required className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">پلاک<input name="plate" className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">سال<input name="year" inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">رنگ<input name="color" className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">وجه نقد اضافه هنگام تحویل (تومان)<input name="extra_cash" defaultValue="0" inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">تاریخ تحویل<JalaliDateField name="purchase_date" defaultValue={todayIso()} /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground sm:col-span-3">تبدیل؛ بدون ثبت دوباره بهای حواله</button></form>}
            {isAdmin && saleId === h.id && <form onSubmit={(e) => void registerSale(e, h)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">قیمت توافقی فروش<input name="sale_amount" inputMode="numeric" required className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">تاریخ فروش<JalaliDateField name="sale_date" defaultValue={todayIso()} /></label><label className="grid gap-1 text-sm">خریدار<select name="buyer_customer_id" className="rounded-md border bg-background px-3 py-2"><option value="">نامشخص</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label className="grid gap-1 text-sm sm:col-span-3">شرح<input name="notes" className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground sm:col-span-3">ثبت قرارداد فروش</button></form>}
          </article>;
        })}
        {rows.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">حواله‌ای در دسترس نیست؛ برای شریک، مشاهده حواله‌ها و مشتری مربوط باید به‌صورت صریح مجاز شده باشد.</p>}
      </section>
    </div>
  );
}
