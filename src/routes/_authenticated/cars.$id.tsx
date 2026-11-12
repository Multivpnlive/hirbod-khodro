import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Trash2, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Stat } from "@/components/AppShell";
import { useAllData, usePerms } from "@/lib/data";
import { carCost, carExpensesTotal, carPartnerLedger, carProfit } from "@/lib/finance";
import { faDate, faYear, pct, toman, txnLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, StatusBadge, num } from "@/components/form-bits";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/cars/$id")({
  head: () => ({ meta: [{ title: "جزئیات خودرو | هیربد خودرو" }] }),
  component: CarDetail,
});

function CarDetail() {
  const { id } = Route.useParams();
  const d = useAllData();
  const { isAdmin, perms, can } = usePerms();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const mayViewCustomers = isAdmin || can("customers", "view");
  const mayCreateCustomers = isAdmin || can("customers", "create");
  const [customers, setCustomers] = useState<Array<{ id: string; name: string; national_id: string | null }>>([]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["all-data"] });

  useEffect(() => {
    if (!mayViewCustomers) return;
    let active = true;
    void supabase.from("customers").select("id,name,national_id")
      .eq("is_demo", false).order("name")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) toast.error(`فهرست مشتریان: ${error.message}`);
        else setCustomers(data ?? []);
      });
    return () => { active = false; };
  }, [mayViewCustomers]);

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
    const status = f.get("status") as "available" | "reserved" | "sold";
    let buyerId = String(f.get("buyer_customer_id") || "") || null;
    const newName = String(f.get("new_customer_name") || "").trim();

    if (status === "sold" && !buyerId && newName) {
      if (!mayCreateCustomers) {
        toast.error("مجوز افزودن مشتری را ندارید");
        return;
      }
      const nationalId = String(f.get("new_customer_national_id") || "").trim() || null;
      if (nationalId) {
        const { data, error } = await supabase.from("customers").select("id")
          .eq("national_id", nationalId).eq("is_demo", false).limit(1).maybeSingle();
        if (error) { toast.error(error.message); return; }
        buyerId = data?.id ?? null;
      }
      if (!buyerId) {
        const { data, error } = await supabase.from("customers").insert({
          name: newName,
          phone: String(f.get("new_customer_phone") || "").trim() || null,
          national_id: nationalId,
          notes: null,
          is_demo: false,
        }).select("id,name,national_id").single();
        if (error) { toast.error(error.message); return; }
        buyerId = data.id;
        setCustomers((current) => [...current, data]);
      }
    }

    const changes: any = {
      status,
      sale_price: sale || null,
      sale_date: (f.get("sale_date") as string) || null,
      purchase_price: num(f.get("purchase_price")),
    };
    if (mayViewCustomers) changes.buyer_customer_id = status === "sold" ? buyerId : null;

    await run(
      supabase.from("cars").update(changes).eq("id", id),
      "معامله به‌روزرسانی شد",
    );
  }

  async function deliverHawala(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (car!.asset_type !== "hawala") return;

    const f = new FormData(e.currentTarget);
    const { data, error } = await supabase.from("cars").update({
      asset_type: "car",
      delivery_date: String(f.get("delivery_date") || todayIso()),
      year: num(f.get("year")) || car!.year,
      color: String(f.get("color") || "").trim() || car!.color,
      plate: String(f.get("plate") || "").trim() || null,
    }).eq("id", id).eq("asset_type", "hawala").select("id").maybeSingle();

    if (error || !data) {
      toast.error(error?.message ?? "تبدیل انجام نشد؛ وضعیت دارایی را دوباره بررسی کنید.");
      return;
    }

    toast.success("همان پرونده از حواله به خودروی آماده تبدیل شد.");
    refresh();
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
    if (!f.get("partner")) { toast.error("لطفاً شریک را انتخاب کنید"); return; }
    if (num(f.get("amount")) <= 0) { toast.error("مبلغ سرمایه معتبر نیست"); return; }
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
    if (!f.get("partner")) { toast.error("لطفاً شریک را انتخاب کنید"); return; }
    if (num(f.get("amount")) <= 0) { toast.error("مبلغ پرداخت معتبر نیست"); return; }
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

  return (
    <div className="space-y-6">
      <Link to="/cars" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowRight className="size-4" /> دارایی‌ها</Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">{car.brand} {car.model}</h1>
          <div className="text-sm text-muted-foreground mt-1">{faYear(car.year)} · {car.color} · {car.plate} · خرید {faDate(car.purchase_date)}</div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={car.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <span>نوع دارایی: {car.asset_type === "hawala" ? "حواله" : "خودروی آماده"}</span>
        <span>·</span>
        <span>نوع مالکیت: {car.ownership_type === "shared" ? "شراکتی" : "شخصی"}</span>
        {car.delivery_date && <><span>·</span><span>تاریخ تحویل: {faDate(car.delivery_date)}</span></>}
      </div>

      {car.factory_price > 0 && (
        <div className="rounded-lg border bg-card p-3 text-sm">
          قیمت کارخانه: {toman(car.factory_price)}
          <span className="mx-2">+</span>
          مبلغ امتیاز: {toman(car.premium_price)}
          <span className="mx-2">=</span>
          بهای خرید حواله: <strong>{toman(car.factory_price + car.premium_price)}</strong>
        </div>
      )}

      {car.asset_type === "hawala" && perms.edit_car && (
        <form onSubmit={deliverHawala} className="card-elevated grid grid-cols-2 md:grid-cols-5 gap-3 p-4 items-end">
          <div className="col-span-2 md:col-span-5 font-bold">ثبت تحویل و تبدیل حواله به خودرو</div>
          <Field label="سال ساخت">
            <Input name="year" defaultValue={car.year ?? ""} inputMode="numeric" />
          </Field>
          <Field label="رنگ">
            <Input name="color" defaultValue={car.color ?? ""} />
          </Field>
          <Field label="شماره پلاک">
            <Input name="plate" />
          </Field>
          <Field label="تاریخ تحویل">
            <JalaliDateField name="delivery_date" defaultValue={todayIso()} />
          </Field>
          <Button>تبدیل همین پرونده به خودرو</Button>
        </form>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="قیمت خرید" value={toman(car.purchase_price)} />
        <Stat label="هزینه‌های جانبی" value={toman(carExpensesTotal(id, exps))} />
        <Stat label="بهای تمام‌شده" value={toman(carCost(car, exps))} />
        <Stat label="سود / زیان" value={profit === null ? "فروخته نشده" : toman(profit)} tone={profit === null ? undefined : profit >= 0 ? "pos" : "neg"} />
      </div>

      {perms.edit_car && car.asset_type === "car" && (
      <form onSubmit={saveDeal} className="card-elevated p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end" key={car.id + car.status + car.sale_price + car.buyer_customer_id}>
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
        {mayViewCustomers && <div className="col-span-2 md:col-span-5 space-y-2">
          <Field label="مشتری خریدار">
            <NativeSelect name="buyer_customer_id" defaultValue={car.buyer_customer_id ?? ""}>
              <option value="">انتخاب مشتری (اختیاری)</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </NativeSelect>
          </Field>
          {mayCreateCustomers && <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm">افزودن مشتری جدید</summary>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <Field label="نام مشتری"><Input name="new_customer_name" /></Field>
              <Field label="تلفن"><Input name="new_customer_phone" inputMode="tel" /></Field>
              <Field label="کد ملی"><Input name="new_customer_national_id" inputMode="numeric" /></Field>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">در صورت واردکردن کد ملی تکراری، مشتری موجود انتخاب می‌شود.</p>
          </details>}
        </div>}
      </form>
      )}

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
                    {perms.edit_car && (
                      <button aria-label="حذف شریک" className="shrink-0 p-1" onClick={() => run(supabase.from("car_investments").delete().eq("id", inv.id), "حذف شد")}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1">
                    <span className="text-xs text-muted-foreground shrink-0">سرمایه</span>
                    {perms.edit_car ? (
                      <button className="whitespace-nowrap text-sm underline decoration-dotted" onClick={() => editInvestment(inv.id, s.capital)}>{toman(s.capital)}</button>
                    ) : (
                      <span className="whitespace-nowrap text-sm">{toman(s.capital)}</span>
                    )}
                  </div>
                  <Row label="درصد مشارکت" value={pct(s.sharePct)} />
                  <Row label="سهم سود/زیان" value={profit === null ? "—" : `${s.profit > 0 ? "+" : ""}${toman(s.profit)}`} className={s.profit >= 0 ? "text-success" : "text-destructive"} />
                  <Row label="تسویه‌شده" value={toman(s.settled)} />
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 border-t mt-1 pt-2">
                    <span className="text-xs font-bold">مانده قابل پرداخت</span>
                    <span className="whitespace-nowrap font-extrabold">{profit === null ? "—" : toman(s.due)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {invs.length > 0 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground mt-3 border-t pt-2">
              <span>مجموع سرمایه: <b className="text-foreground whitespace-nowrap">{toman(capitalTotal)}</b></span>
              <span>مجموع سود/زیان: <b className="text-foreground whitespace-nowrap">{profit === null ? "—" : toman(profit)}</b></span>
              <span>مجموع تسویه‌شده: <b className="text-foreground whitespace-nowrap">{toman(ledger.reduce((a, s) => a + s.settled, 0))}</b></span>
              <span>مجموع مانده‌ها: <b className="text-foreground whitespace-nowrap">{profit === null ? "—" : toman(ledger.reduce((a, s) => a + s.due, 0))}</b></span>
            </div>
          )}
          {invs.length === 0 && <div className="text-sm text-muted-foreground py-2">هنوز سرمایه‌ای ثبت نشده.</div>}
          {perms.edit_car && car.ownership_type === "shared" && (
            <>
              <form onSubmit={addInvestment} className="grid grid-cols-[1fr_1fr_auto] gap-2 mt-4">
                <NativeSelect name="partner" required>
                  <option value="">انتخاب شریک</option>
                  {d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </NativeSelect>
                <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
                <Button size="sm">افزودن / ویرایش</Button>
              </form>
              <div className="text-[11px] text-muted-foreground mt-1">مانده = سرمایه + سهم سود یا زیان − تسویه‌های همین خودرو. برای ویرایش سرمایه روی مبلغ بزنید.</div>
            </>
          )}
        </div>

        <div className="card-elevated p-4">
          <div className="font-bold mb-1">هزینه‌های جانبی</div>
          <div className="text-xs text-muted-foreground mb-3">مجموع هزینه‌ها: {toman(carExpensesTotal(id, exps))}</div>
          <div className="divide-y">
            {exps.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                {perms.add_expense ? (
                  <button className="text-start" onClick={() => editExpense(e)}>{e.title} <span className="text-xs text-muted-foreground">{faDate(e.expense_date)}</span>{e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}</button>
                ) : (
                  <span className="text-start">{e.title} <span className="text-xs text-muted-foreground">{faDate(e.expense_date)}</span>{e.description && <div className="text-xs text-muted-foreground">{e.description}</div>}</span>
                )}
                <span className="flex items-center gap-2">{toman(e.amount)}
                  {perms.add_expense && <button onClick={() => run(supabase.from("car_expenses").delete().eq("id", e.id), "حذف شد")}><Trash2 className="size-3.5 text-muted-foreground" /></button>}
                </span>
              </div>
            ))}
          </div>
          {perms.add_expense && (
            <form onSubmit={addExpense} className="grid grid-cols-2 gap-2 mt-4">
              <Input name="title" placeholder="عنوان هزینه" required />
              <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
              <JalaliDateField name="date" defaultValue={todayIso()} />
              <Input name="description" placeholder="توضیح" />
              <Button size="sm" className="col-span-2">افزودن هزینه</Button>
            </form>
          )}
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
        {(perms.add_payment || perms.manage_settlements) && (
          <form onSubmit={addSettlement} className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4">
            <NativeSelect name="partner" required>
              <option value="">شریک</option>
              {invs.map((i) => <option key={i.partner_id} value={i.partner_id}>{pName(i.partner_id)}</option>)}
            </NativeSelect>
            <NativeSelect name="type" defaultValue={perms.manage_settlements ? "settlement" : "payment"}>
              {perms.manage_settlements && <option value="settlement">تسویه شریک</option>}
              {perms.add_payment && <option value="payment">پرداخت</option>}
            </NativeSelect>
            <Input name="amount" placeholder="مبلغ (تومان)" inputMode="numeric" required />
            <JalaliDateField name="date" defaultValue={todayIso()} />
            <Input name="description" placeholder="توضیح" />
            <Button size="sm">ثبت</Button>
          </form>
        )}
      </div>
    </div>
  );
}
