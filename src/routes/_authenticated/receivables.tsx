import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { FeatureLinks } from "@/components/FeatureLinks";
import { usePerms } from "@/lib/data";
import { amountValue, errorText, faMoney, faNumber } from "@/lib/feature-utils";

export const Route = createFileRoute("/_authenticated/receivables")({
  head: () => ({ meta: [{ title: "مطالبات فروش | هیربد خودرو" }] }),
  component: ReceivablesPage,
});

const db = supabase as any;
type Car = { id: string; brand: string; model: string; plate: string | null; sale_price: number | null; sale_date: string | null; purchase_price: number; status: string };
type Receivable = { car_id: string; sale_price: number; received: number; adjusted: number; outstanding: number };
type Adjustment = { id: string; car_id: string; kind: string; amount: number; note: string | null; created_at: string };

function ReceivablesPage() {
  const { isAdmin } = usePerms();
  const [cars, setCars] = useState<Car[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  async function load() {
    const [c, r, a] = await Promise.all([
      db.from("cars").select("id,brand,model,plate,sale_price,sale_date,purchase_price,status").eq("status", "sold").eq("is_demo", false).order("sale_date", { ascending: false }),
      db.from("car_receivables").select("car_id,sale_price,received,adjusted,outstanding"),
      db.from("sale_adjustments").select("id,car_id,kind,amount,note,created_at").order("created_at", { ascending: false }),
    ]);
    if (c.error) toast.error(c.error.message); else setCars((c.data ?? []) as Car[]);
    if (r.error) toast.error(`مانده مطالبات: ${r.error.message}`); else setReceivables((r.data ?? []) as Receivable[]);
    if (!a.error) setAdjustments((a.data ?? []) as Adjustment[]);
  }
  useEffect(() => { void load(); }, []);

  async function addAdjustment(e: FormEvent<HTMLFormElement>, carId: string) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const amount = amountValue(f.get("amount"));
    if (amount <= 0) { toast.error("مبلغ باید بیشتر از صفر باشد"); return; }
    const { error } = await db.from("sale_adjustments").insert({ car_id: carId, kind: String(f.get("kind")), amount, note: String(f.get("note") ?? "").trim() || null });
    if (error) toast.error(errorText(error)); else { toast.success("تعدیل مانده فروش ثبت شد"); form.reset(); setAdjustId(null); await load(); }
  }

  const totalOutstanding = receivables.reduce((s, r) => s + Number(r.outstanding), 0);
  return <div className="space-y-5" dir="rtl">
    <PageHeader title="مطالبات فروش خودرو" />
    <FeatureLinks />
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">خودروهای فروخته‌شده</div><div className="mt-1 text-2xl font-bold">{faNumber(cars.length)}</div></div><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">جمع دریافت‌های تخصیص‌یافته</div><div className="mt-1 text-2xl font-bold">{faMoney(receivables.reduce((s, r) => s + Number(r.received), 0))}</div></div><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">مانده مطالبات</div><div className="mt-1 text-2xl font-bold">{faMoney(totalOutstanding)}</div></div></div>
    <p className="rounded-lg border bg-card p-3 text-sm leading-7 text-muted-foreground">برای ثبت وصول، به بخش تراکنش‌ها برو و یک «دریافت» با همان خودرو و صندوق کسب‌وکار ثبت کن. تریگر دیتابیس آن را به فروش تخصیص می‌دهد؛ این صفحه فقط مانده را از دریافت‌ها و تعدیلات محاسبه می‌کند و دریافت تکراری نمی‌سازد.</p>
    <section className="space-y-3"><h2 className="font-semibold">وضعیت هر فروش</h2>
      {cars.map((car) => {
        const r = receivables.find((x) => x.car_id === car.id);
        const carAdjustments = adjustments.filter((a) => a.car_id === car.id);
        return <article key={car.id} className="space-y-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{car.brand} {car.model} {car.plate || ""}</h3><p className="text-xs text-muted-foreground">تاریخ فروش: {car.sale_date || "ثبت نشده"}</p></div><b className={Number(r?.outstanding ?? 0) > 0 ? "text-destructive" : "text-green-600"}>مانده: {faMoney(r?.outstanding ?? 0)}</b></div>
          <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">قیمت قرارداد</span><div>{faMoney(r?.sale_price ?? car.sale_price ?? 0)}</div></div><div><span className="text-muted-foreground">وصول‌شده</span><div>{faMoney(r?.received ?? 0)}</div></div><div><span className="text-muted-foreground">تخفیف/سوخت مطالبات</span><div>{faMoney(r?.adjusted ?? 0)}</div></div></div>
          {isAdmin && <div className="flex flex-wrap gap-2 border-t pt-3"><button className="rounded-md border px-3 py-2 text-sm" onClick={() => setAdjustId(adjustId === car.id ? null : car.id)}>ثبت تخفیف/مطالبه سوخت‌شده</button></div>}
          {isAdmin && adjustId === car.id && <form onSubmit={(e) => void addAdjustment(e, car.id)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">نوع<select name="kind" className="rounded-md border bg-background px-3 py-2"><option value="discount">تخفیف</option><option value="write_off">سوخت‌شدن مطالبه</option></select></label><label className="grid gap-1 text-sm">مبلغ<input name="amount" required inputMode="numeric" className="rounded-md border bg-background px-3 py-2" /></label><label className="grid gap-1 text-sm">دلیل<input name="note" className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground sm:col-span-3">ثبت تعدیل</button></form>}
          {carAdjustments.length > 0 && <div className="flex flex-wrap gap-2">{carAdjustments.map((a) => <span key={a.id} className="rounded-full border px-2 py-1 text-xs">{a.kind === "discount" ? "تخفیف" : "مطالبه سوخت‌شده"}: {faMoney(a.amount)}</span>)}</div>}
        </article>;
      })}
      {cars.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">خودروی فروخته‌شده‌ای در محدوده مجاز این حساب وجود ندارد.</p>}
    </section>
  </div>;
}
