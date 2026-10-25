import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminOnly, PageHeader } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { carCost, carProfit } from "@/lib/finance";
import { faYear, toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DemoTag, Field, NativeSelect, StatusBadge, num } from "@/components/form-bits";
import { FundingEditor, type ExpRow, type InvRow } from "@/components/FundingEditor";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/cars/")({
  head: () => ({ meta: [{ title: "خودروها | هیربد خودرو" }] }),
  component: () => (
    <AdminOnly>
      <Cars />
    </AdminOnly>
  ),
});

function Cars() {
  const { cars, expenses, isLoading } = useAllData();
  const [q, setQ] = useState("");
  const list = cars.filter((c) => `${c.brand} ${c.model} ${c.plate ?? ""}`.includes(q));
  return (
    <div>
      <PageHeader title="خودروها" action={<AddCar />} />
      <Input placeholder="جستجو در برند، مدل یا پلاک…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-4 max-w-sm bg-card" />
      {isLoading && <div className="text-muted-foreground">در حال بارگذاری…</div>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((c) => {
          const p = carProfit(c, expenses);
          return (
            <Link key={c.id} to="/cars/$id" params={{ id: c.id }} className="card-elevated p-4 hover:border-primary transition-colors">
              <div className="flex justify-between items-start">
                <div className="font-bold">
                  {c.brand} {c.model} <DemoTag show={c.is_demo} />
                </div>
                <StatusBadge status={c.status} />
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {faYear(c.year)} · {c.color} · {c.plate}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">بهای تمام‌شده</div>
                  {toman(carCost(c, expenses))}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">سود / زیان</div>
                  {p === null ? <span className="text-muted-foreground">—</span> : <span className={p >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{toman(p)}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!isLoading && list.length === 0 && <div className="text-muted-foreground">خودرویی ثبت نشده است.</div>}
    </div>
  );
}

function AddCar() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { partners } = useAllData();
  const [invs, setInvs] = useState<InvRow[]>([]);
  const [exps, setExps] = useState<ExpRow[]>([]);
  const [purchase, setPurchase] = useState(0);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sale = num(f.get("sale_price"));
    const { data: newCar, error } = await supabase.from("cars").insert({
      brand: String(f.get("brand")),
      model: String(f.get("model")),
      year: num(f.get("year")) || null,
      color: String(f.get("color") || ""),
      plate: String(f.get("plate") || ""),
      purchase_price: num(f.get("purchase_price")),
      sale_price: sale || null,
      status: f.get("status") as "available" | "reserved" | "sold",
      purchase_date: String(f.get("purchase_date")),
      sale_date: (f.get("sale_date") as string) || null,
    }).select("id").single();
    if (error || !newCar) { toast.error(error?.message ?? "خطا"); return; }
    const invRows = invs.filter((r) => r.partner_id && num(r.amount) > 0)
      .map((r) => ({ car_id: newCar.id, partner_id: r.partner_id, amount: num(r.amount) }));
    const expRows = exps.filter((r) => r.title && num(r.amount) > 0)
      .map((r) => ({ car_id: newCar.id, title: r.title, amount: num(r.amount), expense_date: r.date, description: r.description || null }));
    const [a, b] = await Promise.all([
      invRows.length ? supabase.from("car_investments").insert(invRows) : { error: null },
      expRows.length ? supabase.from("car_expenses").insert(expRows) : { error: null },
    ]);
    if (a.error || b.error) toast.error((a.error || b.error)!.message);
    setInvs([]); setExps([]);
    toast.success("خودرو ثبت شد");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> خودروی جدید</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>ثبت خودرو</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="برند"><Input name="brand" required /></Field>
          <Field label="مدل"><Input name="model" required /></Field>
          <Field label="سال ساخت"><Input name="year" inputMode="numeric" /></Field>
          <Field label="رنگ"><Input name="color" /></Field>
          <div className="col-span-2"><Field label="شماره پلاک"><Input name="plate" /></Field></div>
          <Field label="قیمت خرید (تومان)"><Input name="purchase_price" inputMode="numeric" required onChange={(e) => setPurchase(num(e.target.value))} /></Field>
          <Field label="تاریخ خرید"><JalaliDateField name="purchase_date" defaultValue={todayIso()} /></Field>
          <Field label="قیمت فروش (تومان)"><Input name="sale_price" inputMode="numeric" /></Field>
          <Field label="تاریخ فروش"><JalaliDateField name="sale_date" /></Field>
          <div className="col-span-2">
            <Field label="وضعیت معامله">
              <NativeSelect name="status" defaultValue="available">
                <option value="available">موجود</option>
                <option value="reserved">رزرو</option>
                <option value="sold">فروخته‌شده</option>
              </NativeSelect>
            </Field>
          </div>
          <FundingEditor partners={partners.filter((p) => !p.is_demo)} invs={invs} setInvs={setInvs} exps={exps} setExps={setExps} purchase={purchase} />
          <Button className="col-span-2">ذخیره</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
