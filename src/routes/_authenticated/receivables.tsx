import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { usePerms } from "@/lib/data";
import { amountValue, errorText, faMoney, faNumber } from "@/lib/feature-utils";
import { faDate } from "@/lib/format";
import { AmountInput } from "@/components/AmountInput";

export const Route = createFileRoute("/_authenticated/receivables")({
  head: () => ({ meta: [{ title: "مطالبات فروش | هیربد خودرو" }] }),
  component: ReceivablesPage,
});

const db = supabase as any;
type Car = { id: string; brand: string; model: string; plate: string | null; sale_price: number | null; sale_date: string | null; purchase_price: number; status: string };
type Receivable = { car_id: string; sale_price: number; received: number; adjusted: number; outstanding: number };
type Adjustment = { id: string; car_id: string; kind: string; amount: number; note: string | null; created_at: string };

function ReceivablesPage() {
  const { isAdmin, can } = usePerms();
  const [cars, setCars] = useState<Car[]>([]);
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [adjustId, setAdjustId] = useState<string | null>(null);
  const [editingAdjustment, setEditingAdjustment] = useState<Adjustment | null>(null);
  const canCreate = isAdmin || can("receivables", "create");
  const canEdit = isAdmin || can("receivables", "edit");
  const canDelete = isAdmin || can("receivables", "delete");
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

  async function saveAdjustment(e: FormEvent<HTMLFormElement>, carId: string) {
    e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
    const amount = amountValue(f.get("amount"));
    if (amount <= 0) { toast.error("مبلغ باید بیشتر از صفر باشد"); return; }
    const payload = { car_id: carId, kind: String(f.get("kind")), amount, note: String(f.get("note") ?? "").trim() || null };
    const query = editingAdjustment
      ? db.from("sale_adjustments").update(payload).eq("id", editingAdjustment.id)
      : db.from("sale_adjustments").insert(payload);
    const { error } = await query;
    if (error) toast.error(errorText(error)); else { toast.success(editingAdjustment ? "تعدیل ویرایش شد" : "تعدیل مانده فروش ثبت شد"); form.reset(); setAdjustId(null); setEditingAdjustment(null); await load(); }
  }

  async function deleteAdjustment(id: string) {
    if (!window.confirm("این تعدیل از مطالبات حذف شود؟")) return;
    const { error } = await db.from("sale_adjustments").delete().eq("id", id);
    if (error) toast.error(errorText(error)); else { toast.success("تعدیل حذف شد"); await load(); }
  }

  const visibleReceivables = cars.map((car) => {
    const row = receivables.find((r) => r.car_id === car.id);
    const carAdjustments = adjustments.filter((a) => a.car_id === car.id);
    const adjusted = Number(row?.adjusted ?? carAdjustments.reduce((sum, a) => sum + Number(a.amount), 0));
    const received = Number(row?.received ?? 0);
    return {
      car,
      salePrice: Number(row?.sale_price ?? car.sale_price ?? 0),
      received,
      adjusted,
      outstanding: Number(row?.outstanding ?? Math.max(0, Number(car.sale_price ?? 0) - received - adjusted)),
    };
  });
  const totalOutstanding = visibleReceivables.reduce((s, r) => s + r.outstanding, 0);
  const totalReceived = visibleReceivables.reduce((s, r) => s + r.received, 0);
  return <div className="space-y-5" dir="rtl">
    <PageHeader title="مطالبات فروش خودرو" />
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">خودروهای فروخته‌شده</div><div className="mt-1 text-2xl font-bold">{faNumber(cars.length)}</div></div><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">جمع دریافت‌های تخصیص‌یافته</div><div className="mt-1 text-2xl font-bold">{faMoney(totalReceived)}</div></div><div className="rounded-xl border bg-card p-4"><div className="text-sm text-muted-foreground">مانده مطالبات</div><div className="mt-1 text-2xl font-bold">{faMoney(totalOutstanding)}</div></div></div>
    <p className="rounded-lg border bg-card p-3 text-sm leading-7 text-muted-foreground">دریافت مرتبط با فروش را در «تراکنش‌ها» ثبت و همان خودرو را انتخاب کن. دریافت از صندوق کسب‌وکار یا امانی مشتری در وصول همان فروش حساب می‌شود. تخفیف یا بخشودگی را از همین صفحه ثبت کن.</p>
    <section className="space-y-3"><h2 className="font-semibold">وضعیت هر فروش</h2>
      {visibleReceivables.map(({ car, salePrice, received, adjusted, outstanding }) => {
        const carAdjustments = adjustments.filter((a) => a.car_id === car.id);
        return <article key={car.id} className="space-y-3 rounded-xl border bg-card p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{car.brand} {car.model} {car.plate || ""}</h3><p className="text-xs text-muted-foreground">وضعیت: فروخته‌شده · تاریخ فروش: {faDate(car.sale_date)}</p></div><b className={outstanding > 0 ? "text-destructive" : "text-green-600"}>مانده: {faMoney(outstanding)}</b></div>
          <div className="grid gap-3 text-sm sm:grid-cols-3"><div><span className="text-muted-foreground">قیمت قرارداد</span><div>{faMoney(salePrice)}</div></div><div><span className="text-muted-foreground">وصول‌شده</span><div>{faMoney(received)}</div></div><div><span className="text-muted-foreground">تخفیف/سوخت مطالبات</span><div>{faMoney(adjusted)}</div></div></div>
          {(canCreate || isAdmin || can("cars", "edit")) && <div className="flex flex-wrap gap-2 border-t pt-3">{(isAdmin || can("cars", "edit")) && <Link to="/cars/$id" params={{ id: car.id }} className="rounded-md border px-3 py-2 text-sm">ویرایش اطلاعات فروش</Link>}{canCreate && <button className="rounded-md border px-3 py-2 text-sm" onClick={() => { setEditingAdjustment(null); setAdjustId(adjustId === car.id ? null : car.id); }}>ثبت تخفیف/مطالبه سوخت‌شده</button>}</div>}
          {(canCreate || canEdit) && adjustId === car.id && <form key={editingAdjustment?.id ?? `new:${car.id}`} onSubmit={(e) => void saveAdjustment(e, car.id)} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"><label className="grid gap-1 text-sm">نوع<select name="kind" defaultValue={editingAdjustment?.kind ?? "discount"} className="rounded-md border bg-background px-3 py-2"><option value="discount">تخفیف</option><option value="write_off">سوخت‌شدن مطالبه</option></select></label><label className="grid gap-1 text-sm">مبلغ<AmountInput name="amount" defaultValue={editingAdjustment?.amount ?? ""} required /></label><label className="grid gap-1 text-sm">دلیل<input name="note" defaultValue={editingAdjustment?.note ?? ""} className="rounded-md border bg-background px-3 py-2" /></label><button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground sm:col-span-3">{editingAdjustment ? "ذخیره ویرایش" : "ثبت تعدیل"}</button></form>}
          {carAdjustments.length > 0 && <div className="space-y-2">{carAdjustments.map((a) => <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"><span>{a.kind === "discount" ? "تخفیف" : "مطالبه سوخت‌شده"}: {faMoney(a.amount)}{a.note ? ` · ${a.note}` : ""}</span><span className="flex items-center gap-3">{canEdit && <button aria-label="ویرایش تعدیل" title="ویرایش" onClick={() => { setEditingAdjustment(a); setAdjustId(car.id); }}><Pencil className="size-4" /></button>}{canDelete && <button aria-label="حذف تعدیل" title="حذف" onClick={() => void deleteAdjustment(a.id)}><Trash2 className="size-4 text-destructive" /></button>}</span></div>)}</div>}
        </article>;
      })}
      {cars.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">خودروی فروخته‌شده‌ای در محدوده مجاز این حساب وجود ندارد.</p>}
    </section>
  </div>;
}
