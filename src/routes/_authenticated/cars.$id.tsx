import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminOnly, Stat } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { carCost, carExpensesTotal, carPartnerLedger, carProfit } from "@/lib/finance";
import { faDate, pct, toman, txnLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DemoTag, Field, NativeSelect, StatusBadge, num } from "@/components/form-bits";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/cars/$id")({
  head: () => ({ meta: [{ title: "جزئیات خودرو | هیربد خودرو" }] }),
  component: () => (
    <AdminOnly>
      <CarDetail />
    </AdminOnly>
  ),
});

function CarDetail() {
  const { id } = Route.useParams();
  const d = useAllData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["all-data"] });
  const car = d.data?.cars.find((c) => c.id === id);
  if (d.isLoading) return <div className="text-muted-foreground">در حال بارگذاری…</div>;
  if (!car) return <div>خودرو پیدا نشد.</div>;

  const exps = d.data!.expenses.filter((e) => e.car_id === id);
  const invs = d.data!.investments.filter((i) => i.car_id === id);
  const profit = carProfit(car, exps);
  const carTxns = d.data!.txns.filter((t) => t.car_id === id);
  const ledger = carPartnerLedger(car, exps, invs, carTxns);
  const capitalTotal = invs.reduce((a, i) => a + Number(i.amount), 0);
  const pName = (pid: string) => d.data!.partners.find((p) => p.id === pid)?.name ?? "—";

  async function run(p: PromiseLike<{ error: { message: string } | null }>, ok: string) {
    const { error } = await p;
    if (error) { toast.error(error.message); return; }
    toast.success(ok);
    refresh();
  }

  async function saveDeal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const sale = num(f.get("sale_price"));
    await run(
      supabase.from("cars").update({
        status: f.get("status") as "available" | "reserved" | "sold",
        sale_price: sale || null,
        sale_date: (f.get("sale_date") as string) || null,
        purchase_price: num(f.get("purchase_price")),
      }).eq("id", id),
      "معامله به‌روزرسانی شد",
    );
  }

  async function addExpense(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(
      supabase.from("car_expenses").insert({ car_id: id, title: String(f.get("title")), amount: num(f.get("amount")), expense_date: String(f.get("date")), description: String(f.get("description") || "") || null, is_demo: car!.is_demo }),
      "هزینه ثبت شد",
    );
    form.reset();
  }

  async function addInvestment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(
      supabase.from("car_investments").upsert(
        { car_id: id, partner_id: String(f.get("partner")), amount: num(f.get("amount")), is_demo: car!.is_demo },
        { onConflict: "car_id,partner_id" },
      ),
      "سرمایه شریک ثبت شد",
    );
    form.reset();
  }

  async function addSettlement(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    await run(
      supabase.from("transactions").insert({
        type: f.get("type") as "settlement" | "payment",
        partner_id: String(f.get("partner")),
        car_id: id,
        amount: num(f.get("amount")),
        txn_date: String(f.get("date")),
        description: String(f.get("description") || "") || null,
        is_demo: car!.is_demo,
      }),
      "پرداخت ثبت شد",
    );
    form.reset();
  }

  function editExpense(ex: (typeof exps)[number]) {
    const title = prompt("عنوان هزینه", ex.title); if (title === null) return;
    const amount = prompt("مبلغ (تومان)", String(ex.amount)); if (amount === null) return;
    const description = prompt("توضیح", ex.description ?? ""); if (description === null) return;
    run(supabase.from("car_expenses").update({ title, amount: num(amount), description: description || null }).eq("id", ex.id), "هزینه ویرایش شد");
  }

  function editInvestment(invId: string, current: number) {
    const amount = prompt("مبلغ سرمایه (تومان)", String(current)); if (amount === null) return;
    run(supabase.from("car_investments").update({ amount: num(amount) }).eq("id", invId), "سرمایه ویرایش شد");
  }

  async function removeCar() {
    if (!confirm("این خودرو و همه هزینه‌ها و سرمایه‌های آن حذف شود؟")) return;
    const { error } = await supabase.from("cars").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    refresh();
    navigate({ to: "/cars" });
  }

  return (
    <div className="space-y-6">
      <Link to="/cars" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowRight className="size-4" /> خودروها</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{car.brand} {car.model} <DemoTag show={car.is_demo} /></h1>
          <div className="text-sm text-muted-foreground mt-1">{car.year} · {car.color} · {car.plate} · خرید {faDate(car.purchase_date)}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={car.status} />
          <Button variant="ghost" size="icon" onClick={removeCar} aria-label="حذف"><Trash2 className="size-4 text-destructive" /></Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="قیمت خرید" value={toman(car.purchase_price)} />
        <Stat label="هزینه‌های جانبی" value={toman(carExpensesTotal(id, exps))} />
        <Stat label="بهای تمام‌شده" value={toman(carCost(car, exps))} />
        <Stat label="سود / زیان" value={profit === null ? "فروخته نشده" : toman(profit)} tone={profit === null ? undefined : profit >= 0 ? "pos" : "neg"} />
      </div>

      <form onSubmit={saveDeal} className="card-elevated p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end" key={car.id + car.status + car.sale_price}>
        <Field label="وضعیت">
          <NativeSelect name="status" defaultValue={car.status}>
            <option value="available">موجود</option>
            <option value="reserved">رزرو</option>
            <option value="sold">فروخته‌شده</option>
          </NativeSelect>
        </Field>
        <Field label="قیمت خرید"><Input name="purchase_price" defaultValue={car.purchase_price} inputMode="numeric" /></Field>
        <Field label="قیمت فروش"><Input name="sale_price" defaultValue={car.sale_price ?? ""} inputMode="numeric" /></Field>
        <Field label="تاریخ فروش"><JalaliDateField name="sale_date" defaultValue={car.sale_date ?? ""} key={car.id + (car.sale_date ?? "")} /></Field>
        <Button>ذخیره معامله</Button>
      </form>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card-elevated p-4">
          <div className="font-bold mb-1">سرمایه و سهم سود شرکا</div>
          <div className="text-xs text-muted-foreground mb-3">مجموع سرمایه: {toman(capitalTotal)}</div>
          <div className="grid gap-3 sm:grid-cols-2">
            {ledger.map((s) => {
              const inv = invs.find((i) => i.partner_id === s.partner_id)!;
              const Row = ({ label, value, className }: { label: string; value: string; className?: string }) => (
                <div className="flex items-center justify-between gap-3 py-1">
                  <span className="text-xs text-muted-foreground shrink-0">{label}</span>
                  <span className={`whitespace-nowrap text-sm ${className ?? ""}`}>{value}</span>
                </div>
              );
              return (
                <div key={s.partner_id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2 border-b pb-2 mb-1">
                    <span className="font-bold truncate">{pName(s.partner_id)}</span>
                    <button aria-label="حذف شریک" className="shrink-0 p-1" onClick={() => run(supabase.from("car_investments").delete().eq("id", inv.id), "حذف شد")}>
                      <Trash2 className="size-4 text-muted-foreground" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-xs text-muted-foreground shrink-0">سرمایه</span>
                    <button className="whitespace-nowrap text-sm underline decoration-dotted" onClick={() => editInvestment(inv.id, s.capital)}>{toman(s.capital)}</button>
                  </div>
                  <Row label="درصد مشارکت" value={pct(s.sharePct)} />
                  <Row label="سهم سود/زیان" value={profit === null ? "—" : `${s.profit > 0 ? "+" : ""}${toman(s.profit)}`} className={s.profit >= 0 ? "text-success" : "text-destructive"} />
                  <Row label="تسویه‌شده" value={toman(s.settled)} />
                  <div className="flex items-center justify-between gap-3 border-t mt-1 pt-2">
                    <span className="text-xs font-bold shrink-0">مانده قابل پرداخت</span>
                    <span className="whitespace-nowrap font-extrabold">{profit === null ? "—" : toman(s.due)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {invs.length === 0 && <div className="text-sm text-muted-foreground py-2">هنوز سرمایه‌ای ثبت نشده.</div>}
          <form onSubmit={addInvestment} className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-4">
            <NativeSelect name="partner" required>
              <option value="">انتخاب شریک</option>
              {d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </NativeSelect>
            <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
            <Button size="sm">افزودن / ویرایش</Button>
          </form>
          <div className="text-[11px] text-muted-foreground mt-1">مانده = سرمایه + سهم سود یا زیان − تسویه‌های همین خودرو. برای ویرایش سرمایه روی مبلغ بزنید.</div>
        </div>

        <div className="card-elevated p-4">
          <div className="font-bold mb-1">هزینه‌های جانبی</div>
          <div className="text-xs text-muted-foreground mb-3">مجموع هزینه‌ها: {toman(carExpensesTotal(id, exps))}</div>
          <div className="divide-y">
            {exps.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                <button className="text-start" onClick={() => editExpense(e)}>{e.title} <span className="text-xs text-muted-foreground">{faDate(e.expense_date)}</span>{e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}</button>
                <span className="flex items-center gap-2">{toman(e.amount)}
                  <button onClick={() => run(supabase.from("car_expenses").delete().eq("id", e.id), "حذف شد")}><Trash2 className="size-3.5 text-muted-foreground" /></button>
                </span>
              </div>
            ))}
          </div>
          <form onSubmit={addExpense} className="grid grid-cols-2 gap-2 mt-4">
            <Input name="title" placeholder="عنوان هزینه" required />
            <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
            <JalaliDateField name="date" defaultValue={todayIso()} />
            <Input name="description" placeholder="توضیح" />
            <Button size="sm" className="col-span-2">افزودن هزینه</Button>
          </form>
        </div>
      </div>

      <div className="card-elevated p-4">
        <div className="font-bold mb-3">پرداخت‌ها و تسویه با شرکا (سابقه)</div>
        <div className="divide-y text-sm">
          {carTxns.map((t) => (
            <div key={t.id} className="flex justify-between py-2">
              <span>{txnLabel[t.type]} · {t.partner_id ? pName(t.partner_id) : "—"} <span className="text-xs text-muted-foreground">{faDate(t.txn_date)} {t.description}</span></span>
              <span>{toman(t.amount)}</span>
            </div>
          ))}
          {carTxns.length === 0 && <div className="text-muted-foreground py-2">هنوز پرداختی ثبت نشده.</div>}
        </div>
        <form onSubmit={addSettlement} className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4">
          <NativeSelect name="partner" required>
            <option value="">شریک</option>
            {invs.map((i) => <option key={i.partner_id} value={i.partner_id}>{pName(i.partner_id)}</option>)}
          </NativeSelect>
          <NativeSelect name="type" defaultValue="settlement">
            <option value="settlement">تسویه شریک</option>
            <option value="payment">پرداخت</option>
          </NativeSelect>
          <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
          <JalaliDateField name="date" defaultValue={todayIso()} />
          <Input name="description" placeholder="توضیح" />
          <Button size="sm">ثبت</Button>
        </form>
      </div>
    </div>
  );
}
