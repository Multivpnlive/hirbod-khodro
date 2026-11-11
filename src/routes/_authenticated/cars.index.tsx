import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useAllData, usePerms } from "@/lib/data";
import { carCost, carProfit } from "@/lib/finance";
import { faYear, toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect, StatusBadge, num } from "@/components/form-bits";
import { FundingEditor, type ExpRow, type InvRow } from "@/components/FundingEditor";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/cars/")({
  head: () => ({ meta: [{ title: "دارایی‌ها | هیربد خودرو" }] }),
  component: Cars,
});

function Cars() {
  const { cars, expenses, isLoading } = useAllData();
  const { perms } = usePerms();
  const [q, setQ] = useState("");
  const list = cars.filter((c) =>
    `${c.brand} ${c.model} ${c.plate ?? ""}`.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="دارایی‌ها" action={perms.create_car ? <AddAsset /> : undefined} />
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
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{c.asset_type === "hawala" ? "حواله" : "خودروی آماده"}</span>
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
        <div className="text-muted-foreground">دارایی‌ای ثبت نشده است.</div>}
    </div>
  );
}

function AddAsset() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { partners } = useAllData();

  const [assetType, setAssetType] = useState<"hawala" | "car">("car");
  const [ownershipType, setOwnershipType] = useState<"personal" | "shared">("personal");
  const [invs, setInvs] = useState<InvRow[]>([]);
  const [exps, setExps] = useState<ExpRow[]>([]);
  const [purchase, setPurchase] = useState(0);
  const [factoryPrice, setFactoryPrice] = useState(0);
  const [premiumPrice, setPremiumPrice] = useState(0);

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

    const invRows = ownershipType === "shared"
      ? invs.filter((r) => r.partner_id && num(r.amount) > 0)
          .map((r) => ({ car_id: "", partner_id: r.partner_id, amount: num(r.amount) }))
      : [];

    if (ownershipType === "shared" && invRows.length === 0) {
      toast.error("برای مالکیت شراکتی، حداقل یک شریک و مبلغ سرمایه لازم است.");
      return;
    }

    const duplicatePartners = new Set(invRows.map((r) => r.partner_id)).size !== invRows.length;
    if (duplicatePartners) {
      toast.error("هر شریک فقط یک‌بار باید در فهرست سرمایه‌گذاران ثبت شود.");
      return;
    }

    const { data: newAsset, error } = await supabase.from("cars").insert({
      brand: String(f.get("brand") ?? "").trim(),
      model: String(f.get("model") ?? "").trim(),
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
      sale_price: null,
      sale_date: null,
      status: "available",
      is_demo: false,
    }).select("id").single();

    if (error || !newAsset) {
      toast.error(error?.message ?? "ثبت دارایی انجام نشد.");
      return;
    }

    const finalInvRows = invRows.map((r) => ({
      ...r,
      car_id: newAsset.id,
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

    toast.success(assetType === "hawala" ? "حواله در پرونده دارایی ثبت شد." : "خودرو ثبت شد.");
    form.reset();
    setInvs([]);
    setExps([]);
    setFactoryPrice(0);
    setPremiumPrice(0);
    setPurchase(0);
    setAssetType("car");
    setOwnershipType("personal");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> دارایی جدید</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader><DialogTitle>ثبت دارایی</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Field label="نوع دارایی">
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
                  if (value === "personal") setInvs([]);
                }}
              >
                <option value="personal">شخصی</option>
                <option value="shared">شراکتی</option>
              </NativeSelect>
            </Field>
          </div>

          <Field label="برند / سازنده">
            <Input name="brand" required />
          </Field>
          <Field label="مدل">
            <Input name="model" required />
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
                <Input
                  name="factory_price"
                  inputMode="numeric"
                  required
                  onChange={(e) => {
                    const value = num(e.target.value);
                    setFactoryPrice(value);
                    setPurchase(value + premiumPrice);
                  }}
                />
              </Field>
              <Field label="مبلغ امتیاز حواله (تومان)">
                <Input
                  name="premium_price"
                  inputMode="numeric"
                  required
                  onChange={(e) => {
                    const value = num(e.target.value);
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
              <Input
                name="purchase_price"
                inputMode="numeric"
                required
                onChange={(e) => setPurchase(num(e.target.value))}
              />
            </Field>
          )}

          <Field label="تاریخ خرید">
            <JalaliDateField name="purchase_date" defaultValue={todayIso()} />
          </Field>

          {assetType === "car" && (
            <>
              <Field label="قیمت فروش (تومان)">
                <Input name="sale_price" inputMode="numeric" />
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

          <FundingEditor
            partners={partners.filter((p) => !p.is_demo)}
            invs={invs}
            setInvs={setInvs}
            exps={exps}
            setExps={setExps}
            purchase={purchase}
            allowInvestments={ownershipType === "shared"}
          />

          <Button className="col-span-2">ذخیره دارایی</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
