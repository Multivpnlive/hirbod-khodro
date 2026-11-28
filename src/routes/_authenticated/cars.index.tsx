import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useAllData, usePerms } from "@/lib/data";
import { carCost, carProfit } from "@/lib/finance";
import { customerInvestorSummary } from "@/lib/summary";
import { faYear, toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/AmountInput";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect, StatusBadge, num } from "@/components/form-bits";
import { FundingEditor, type ExpRow, type InvRow } from "@/components/FundingEditor";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";
import { CUSTOM_CATALOG_VALUE, VEHICLE_CATALOG } from "@/lib/iranian-vehicle-catalog";

export const Route = createFileRoute("/_authenticated/cars/")({
  head: () => ({ meta: [{ title: "خودروها | هیربد خودرو" }] }),
  component: Cars,
});

function Cars() {
  const { cars, expenses, isLoading } = useAllData();
  const { perms } = usePerms();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const list = cars.filter((c) =>
    `${c.brand} ${c.model} ${c.plate ?? ""}`.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="خودروها" action={perms.create_car ? <AddAsset /> : undefined} />
      <Input
        placeholder="جستجو در برند، مدل یا پلاک…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="mb-4 max-w-sm bg-card"
      />
      {isLoading && <div className="text-muted-foreground">در حال بارگذاری…</div>}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {list.map((c) => {
          const p = carProfit(c, expenses);
          return (
            <Link
              key={c.id}
              to="/cars/$id"
              params={{ id: c.id }}
              className="card-elevated p-4 hover:border-primary transition-colors"
            >
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold">{c.brand} {c.model}</div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} />
                  {perms.delete_car && <button type="button" className="rounded-md p-1 text-destructive hover:bg-destructive/10" aria-label="حذف خودرو" title="حذف خودرو" onClick={async (event) => {
                    event.preventDefault(); event.stopPropagation();
                    if (!window.confirm(`خودروی ${c.brand} ${c.model} حذف شود؟ این کار فقط وقتی ممکن است که وابستگی مالی نداشته باشد.`)) return;
                    const { count, error: relationError } = await supabase.from("transactions").select("id", { count: "exact", head: true }).eq("car_id", c.id);
                    if (relationError) { toast.error("بررسی وابستگی‌های خودرو ناموفق بود."); return; }
                    if ((count ?? 0) > 0) { toast.error("برای حفظ سوابق مالی، خودروی دارای تراکنش حذف نمی‌شود."); return; }
                    const { error } = await supabase.from("cars").delete().eq("id", c.id);
                    if (error) { toast.error("حذف خودرو انجام نشد؛ ممکن است سوابق مالی وابسته داشته باشد."); return; }
                    toast.success("خودرو حذف شد."); await queryClient.invalidateQueries({ queryKey: ["all-data"] });
                  }}><Trash2 className="size-4" /></button>}
                </div>
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>نوع معامله: {c.asset_type === "hawala" ? "حواله خودرو" : "خودروی آماده"}</span>
                <span>·</span>
                <span>{c.ownership_type === "shared" ? "شراکتی" : "شخصی"}</span>
                <span>·</span>
                <span>{faYear(c.year)}</span>
                {c.plate && <><span>·</span><span>{c.plate}</span></>}
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">بهای تمام‌شده</div>
                  {toman(carCost(c, expenses))}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">سود / زیان</div>
                  {p === null
                    ? <span className="text-muted-foreground">—</span>
                    : <span className={p >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{toman(p)}</span>}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!isLoading && list.length === 0 &&
        <div className="text-muted-foreground">خودرویی ثبت نشده است.</div>}
    </div>
  );
}

function AddAsset() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const d = useAllData();
  const customers = d.customers.filter((customer) => !customer.is_demo);
  const currentCapital = Object.fromEntries(customers.map((customer) => [
    customer.id,
    customerInvestorSummary(customer.id, { ...d, partners: d.partners as Array<any> }).currentCapital,
  ]));

  const [assetType, setAssetType] = useState<"hawala" | "car">("car");
  const [ownershipType, setOwnershipType] = useState<"personal" | "shared">("personal");
  const [invs, setInvs] = useState<InvRow[]>([]);
  const [exps, setExps] = useState<ExpRow[]>([]);
  const [purchase, setPurchase] = useState(0);
  const [factoryPrice, setFactoryPrice] = useState(0);
  const [premiumPrice, setPremiumPrice] = useState(0);
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");

  const manufacturers = Object.keys(VEHICLE_CATALOG);
  const models = manufacturer && manufacturer !== CUSTOM_CATALOG_VALUE
    ? VEHICLE_CATALOG[manufacturer as keyof typeof VEHICLE_CATALOG]
    : [];

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);

    const factory = num(f.get("factory_price"));
    const premium = num(f.get("premium_price"));
    const purchasePrice = assetType === "hawala"
      ? factory + premium
      : num(f.get("purchase_price"));

    if (assetType === "hawala" && factory <= 0) {
      toast.error("قیمت کارخانه باید بیشتر از صفر باشد.");
      return;
    }
    if (assetType === "hawala" && premium < 0) {
      toast.error("مبلغ امتیاز معتبر نیست.");
      return;
    }
    if (purchasePrice <= 0) {
      toast.error("بهای خرید باید بیشتر از صفر باشد.");
      return;
    }

    const status = assetType === "car" ? String(f.get("status") || "available") : "available";
    const salePrice = status === "sold" ? num(f.get("sale_price")) : 0;
    const saleDate = status === "sold" ? String(f.get("sale_date") || "") : "";
    if (status === "sold" && salePrice <= 0) { toast.error("برای ثبت فروش، مبلغ فروش معتبر وارد کنید."); return; }
    if (status === "sold" && !saleDate) { toast.error("برای ثبت فروش، تاریخ فروش را انتخاب کنید."); return; }

    const invRows = invs.filter((r) => r.customer_id && num(r.amount) > 0)
      .map((r) => ({ customer_id: r.customer_id, amount: num(r.amount) }));

    if (ownershipType === "shared" && invRows.length === 0) {
      toast.error("برای مالکیت شراکتی، حداقل یک مشتری سرمایه‌گذار و مبلغ سرمایه لازم است.");
      return;
    }

    const duplicateCustomers = new Set(invRows.map((r) => r.customer_id)).size !== invRows.length;
    if (duplicateCustomers) {
      toast.error("هر مشتری سرمایه‌گذار فقط یک‌بار باید در فهرست ثبت شود.");
      return;
    }

    const resolvedInvRows: Array<{ partner_id: string; amount: number }> = [];
    for (const row of invRows) {
      const customer = customers.find((item) => item.id === row.customer_id);
      if (!customer) { toast.error("مشتری انتخاب‌شده پیدا نشد؛ فهرست را تازه کنید."); return; }
      let partnerId = (d.partners as Array<any>).find((partner) => partner.customer_id === customer.id)?.id as string | undefined;
      if (!partnerId) {
        const { data, error } = await (supabase as any).from("partners")
          .insert({ customer_id: customer.id, name: customer.name, phone: customer.phone, is_demo: false })
          .select("id").single();
        if (error || !data) { toast.error(error?.message ?? "پروندهٔ سرمایه‌گذاری مشتری ایجاد نشد."); return; }
        partnerId = data.id as string;
      }
      resolvedInvRows.push({ partner_id: partnerId, amount: row.amount });
    }

    const { data: newAsset, error } = await supabase.from("cars").insert({
      brand: (manufacturer === CUSTOM_CATALOG_VALUE ? String(f.get("custom_brand") ?? "") : manufacturer).trim(),
      model: (model === CUSTOM_CATALOG_VALUE ? String(f.get("custom_model") ?? "") : model).trim(),
      year: num(f.get("year")) || null,
      color: String(f.get("color") ?? "").trim() || null,
      plate: assetType === "car" ? String(f.get("plate") ?? "").trim() || null : null,
      asset_type: assetType,
      ownership_type: ownershipType,
      factory_price: assetType === "hawala" ? factory : 0,
      premium_price: assetType === "hawala" ? premium : 0,
      purchase_price: purchasePrice,
      purchase_date: String(f.get("purchase_date") || todayIso()),
      delivery_date: null,
      sale_price: salePrice || null,
      sale_date: saleDate || null,
      buyer_customer_id: String(f.get("buyer_customer_id") || "") || null,
      status,
      is_demo: false,
    }).select("id").single();

    if (error || !newAsset) {
      toast.error(error?.message ?? "ثبت خودرو انجام نشد.");
      return;
    }

    const finalInvRows = resolvedInvRows.map((r) => ({
      ...r,
      car_id: newAsset.id,
      is_demo: false,
    }));

    const expRows = exps
      .filter((r) => r.title.trim() && num(r.amount) > 0)
      .map((r) => ({
        car_id: newAsset.id,
        title: r.title.trim(),
        amount: num(r.amount),
        expense_date: r.date,
        description: r.description.trim() || null,
        is_demo: false,
      }));

    const [investmentResult, expenseResult] = await Promise.all([
      finalInvRows.length
        ? supabase.from("car_investments").insert(finalInvRows)
        : Promise.resolve({ error: null }),
      expRows.length
        ? supabase.from("car_expenses").insert(expRows)
        : Promise.resolve({ error: null }),
    ]);

    if (investmentResult.error || expenseResult.error) {
      const originalError = investmentResult.error || expenseResult.error;
      const { error: cleanupError } = await supabase
        .from("cars")
        .delete()
        .eq("id", newAsset.id);

      toast.error(
        cleanupError
          ? `ثبت اطلاعات جانبی ناموفق بود: ${originalError?.message}. حذف پرونده ناقص نیز انجام نشد: ${cleanupError.message}`
          : `ثبت اطلاعات جانبی ناموفق بود؛ پرونده ناقص برگشت داده شد: ${originalError?.message}`
      );
      return;
    }

    toast.success(assetType === "hawala" ? "حواله در پرونده خودرو ثبت شد." : "خودرو ثبت شد.");
    form.reset();
    setInvs([]);
    setExps([]);
    setFactoryPrice(0);
    setPremiumPrice(0);
    setPurchase(0);
    setAssetType("car");
    setOwnershipType("personal");
    setManufacturer("");
    setModel("");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> خودروی جدید</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>ثبت خودرو یا حواله</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="نوع معامله">
              <NativeSelect
                value={assetType}
                onChange={(e) => setAssetType(e.target.value as "hawala" | "car")}
              >
                <option value="hawala">حواله</option>
                <option value="car">خودروی آماده</option>
              </NativeSelect>
            </Field>
          </div>

          <div className="col-span-2">
            <Field label="نوع مالکیت">
              <NativeSelect
                value={ownershipType}
                onChange={(e) => {
                  const value = e.target.value as "personal" | "shared";
                  setOwnershipType(value);
                }}
              >
                <option value="personal">شخصی</option>
                <option value="shared">شراکتی</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label="برند / سازنده">
            <NativeSelect name="manufacturer" value={manufacturer} required onChange={(e) => { setManufacturer(e.target.value); setModel(""); }}>
              <option value="">انتخاب سازنده</option>
              {manufacturers.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value={CUSTOM_CATALOG_VALUE}>سازنده در فهرست نیست؛ ورود دستی</option>
            </NativeSelect>
            {manufacturer === CUSTOM_CATALOG_VALUE && <Input name="custom_brand" className="mt-2" placeholder="نام سازنده را وارد کنید" required />}
          </Field>
          <Field label="مدل خودرو">
            <NativeSelect name="model_choice" value={model} required disabled={!manufacturer} onChange={(e) => setModel(e.target.value)}>
              <option value="">{manufacturer ? "انتخاب مدل" : "ابتدا سازنده را انتخاب کنید"}</option>
              {models.map((name) => <option key={name} value={name}>{name}</option>)}
              <option value={CUSTOM_CATALOG_VALUE}>مدل در فهرست نیست؛ ورود دستی</option>
            </NativeSelect>
            {model === CUSTOM_CATALOG_VALUE && <Input name="custom_model" className="mt-2" placeholder="نام مدل را وارد کنید" required />}
          </Field>

          <Field label="سال ساخت">
            <Input name="year" inputMode="numeric" />
          </Field>
          <Field label="رنگ">
            <Input name="color" />
          </Field>

          {assetType === "car" && (
            <div className="col-span-2">
              <Field label="شماره پلاک">
                <Input name="plate" />
              </Field>
            </div>
          )}

          {assetType === "hawala" ? (
            <>
              <Field label="قیمت کارخانه (تومان)">
                <AmountInput
                  name="factory_price"
                  required
                  onValueChange={(raw) => {
                    const value = num(raw);
                    setFactoryPrice(value);
                    setPurchase(value + premiumPrice);
                  }}
                />
              </Field>
              <Field label="مبلغ امتیاز حواله (تومان)">
                <AmountInput
                  name="premium_price"
                  required
                  onValueChange={(raw) => {
                    const value = num(raw);
                    setPremiumPrice(value);
                    setPurchase(factoryPrice + value);
                  }}
                />
              </Field>
              <div className="col-span-2 rounded-lg bg-muted p-3 text-sm">
                بهای خرید حواله: <strong>{toman(purchase)}</strong>
                <div className="text-xs text-muted-foreground mt-1">
                  قیمت کارخانه به‌اضافه مبلغ امتیاز حواله
                </div>
              </div>
            </>
          ) : (
            <Field label="قیمت خرید خودرو (تومان)">
              <AmountInput
                name="purchase_price"
                required
                onValueChange={(raw) => setPurchase(num(raw))}
              />
            </Field>
          )}

          <Field label="تاریخ خرید">
            <JalaliDateField name="purchase_date" defaultValue={todayIso()} />
          </Field>

          {assetType === "car" && (
            <>
              <Field label="قیمت فروش (تومان)">
                <AmountInput name="sale_price" />
              </Field>
              <Field label="تاریخ فروش">
                <JalaliDateField name="sale_date" />
              </Field>
              <div className="col-span-2">
                <Field label="وضعیت معامله">
                  <NativeSelect name="status" defaultValue="available">
                    <option value="available">موجود</option>
                    <option value="reserved">رزرو</option>
                    <option value="sold">فروخته‌شده</option>
                  </NativeSelect>
                </Field>
              </div>
            </>
          )}

          <div className="col-span-2">
            <Field label="مشتری مرتبط با خودرو یا حواله">
              <NativeSelect name="buyer_customer_id" defaultValue="">
                <option value="">انتخاب مشتری (اختیاری)</option>
                {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
              </NativeSelect>
            </Field>
          </div>

          <FundingEditor
            customers={customers}
            currentCapital={currentCapital}
            invs={invs}
            setInvs={setInvs}
            exps={exps}
            setExps={setExps}
            purchase={purchase}
            allowInvestments={true}
          />

          <Button className="col-span-2">ذخیره خودرو</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
