import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, Stat } from "@/components/AppShell";
import { useAllData, usePerms } from "@/lib/data";
import { cashBalance } from "@/lib/finance";
import { faDate, toman, txnLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, NativeSelect, num } from "@/components/form-bits";
import { JalaliDateField } from "@/components/JalaliDateField";
import { todayIso } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({ meta: [{ title: "تراکنش‌ها | هیربد خودرو" }] }),
  component: Transactions,
});

const db = supabase as any;
type ExtendedTxn = {
  id: string;
  type: "receipt" | "payment" | "expense" | "settlement";
  amount: number;
  txn_date: string;
  description?: string | null;
  car_id?: string | null;
  partner_id?: string | null;
  fund?: string | null;
  customer_id?: string | null;
  is_demo?: boolean;
};
type CustomerOption = { id: string; name: string };
const FUND_LABEL: Record<string, string> = { business: "کسب‌وکار", manager: "مدیر", custody: "امانی مشتری" };

function Transactions() {
  const d = useAllData();
  const { isAdmin, perms } = usePerms();
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const txns = d.txns as ExtendedTxn[];
  const list = txns.filter((t) => !type || t.type === type);
  const businessTxns = txns.filter((t) => t.fund == null || t.fund === "business");
  const sum = (k: string) => businessTxns.filter((t) => t.type === k).reduce((a, t) => a + Number(t.amount), 0);

  async function del(id: string) {
    if (!confirm("حذف این تراکنش؟")) return;
    const { error } = await db.from("transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["all-data"] });
  }

  return (
    <div>
      <PageHeader title="دریافت‌ها، پرداخت‌ها و تسویه" action={perms.add_payment || perms.manage_settlements ? <AddTxn /> : undefined} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="دریافت‌های کسب‌وکار" value={toman(sum("receipt"))} tone="pos" />
        <Stat label="پرداخت‌های کسب‌وکار" value={toman(sum("payment"))} />
        <Stat label="هزینه‌های کسب‌وکار" value={toman(sum("expense"))} />
        <Stat label="تسویه شرکا" value={toman(sum("settlement"))} />
        <Stat label="موجودی نقد کسب‌وکار" value={toman(cashBalance(businessTxns))} />
      </div>
      <div className="mb-3 max-w-48">
        <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">همه انواع</option>
          {Object.entries(txnLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </NativeSelect>
      </div>
      <div className="card-elevated divide-y">
        {list.map((t) => {
          const car = d.cars.find((c) => c.id === t.car_id);
          const p = d.partners.find((x) => x.id === t.partner_id);
          return (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{txnLabel[t.type] ?? t.type}</span>
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">{FUND_LABEL[t.fund ?? "business"] ?? t.fund}</span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {faDate(t.txn_date)} {t.description && `· ${t.description}`} {car && `· ${car.brand} ${car.model}`} {p && `· ${p.name}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={t.type === "receipt" ? "text-success font-bold" : "font-bold"}>{t.type === "receipt" ? "+" : "−"}{toman(t.amount)}</span>
                {isAdmin && <button onClick={() => void del(t.id)} aria-label="حذف"><Trash2 className="size-4 text-muted-foreground" /></button>}
              </div>
            </div>
          );
        })}
        {list.length === 0 && <div className="p-4 text-sm text-muted-foreground">تراکنشی نیست.</div>}
      </div>
    </div>
  );
}

function AddTxn() {
  const d = useAllData();
  const { perms, isAdmin } = usePerms();
  const allowedTypes = Object.entries(txnLabel).filter(([k]) => k === "settlement" ? perms.manage_settlements : perms.add_payment);
  const [open, setOpen] = useState(false);
  const [fund, setFund] = useState("business");
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (!open || !isAdmin) return;
    let active = true;
    void db.from("customers").select("id,name").eq("is_demo", false).order("name").then(({ data, error }: any) => {
      if (!active) return;
      if (error) toast.error(`فهرست مشتریان: ${error.message}`);
      else setCustomers((data ?? []) as CustomerOption[]);
    });
    return () => { active = false; };
  }, [open, isAdmin]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const txnType = String(f.get("type"));
    const chosenFund = isAdmin ? String(f.get("fund") || "business") : "business";
    let customerId = String(f.get("customer") || "") || null;
    const newCustomerName = String(f.get("new_customer_name") || "").trim();
    if (chosenFund === "custody" && !customerId && !newCustomerName) {
      toast.error("برای تراکنش امانی، مشتری را انتخاب یا مشخصات مشتری جدید را وارد کنید");
      return;
    }
    if (txnType === "settlement" && chosenFund !== "business") { toast.error("تسویه شرکا فقط از صندوق کسب‌وکار مجاز است"); return; }
    setBusy(true);

    if (chosenFund === "custody" && !customerId && newCustomerName) {
      const nationalId = String(f.get("new_customer_national_id") || "").trim() || null;
      if (nationalId) {
        const { data, error } = await db.from("customers").select("id")
          .eq("national_id", nationalId).eq("is_demo", false).limit(1).maybeSingle();
        if (error) { toast.error(error.message); setBusy(false); return; }
        customerId = data?.id ?? null;
      }
      if (!customerId) {
        const { data, error } = await db.from("customers").insert({
          name: newCustomerName,
          phone: String(f.get("new_customer_phone") || "").trim() || null,
          national_id: nationalId,
          notes: null,
          is_demo: false,
        }).select("id,name").single();
        if (error) { toast.error(error.message); setBusy(false); return; }
        customerId = data.id;
        setCustomers((current) => [...current, data as CustomerOption]);
      }
    }

    const { error } = await db.from("transactions").insert({
      type: txnType,
      amount: num(f.get("amount")),
      txn_date: String(f.get("date") || todayIso()),
      partner_id: (String(f.get("partner") || "") || null),
      car_id: (String(f.get("car") || "") || null),
      customer_id: chosenFund === "custody" ? customerId : null,
      fund: chosenFund,
      purpose: chosenFund === "custody" ? (txnType === "receipt" ? "custody_deposit" : "custody_withdrawal") : null,
      description: String(f.get("description") || ""),
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(chosenFund === "custody" ? "تراکنش امانی مشتری ثبت شد" : "تراکنش ثبت شد");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
    setFund("business");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> تراکنش جدید</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>ثبت تراکنش</DialogTitle></DialogHeader>
        <form onSubmit={(e) => void submit(e)} className="grid grid-cols-2 gap-3">
          <Field label="نوع">
            <NativeSelect name="type" defaultValue={allowedTypes[0]?.[0] ?? "receipt"}>
              {allowedTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="مبلغ (تومان)"><Input name="amount" inputMode="numeric" required /></Field>
          <Field label="تاریخ"><JalaliDateField name="date" defaultValue={todayIso()} /></Field>
          {isAdmin && <Field label="صندوق">
            <NativeSelect name="fund" value={fund} onChange={(e) => setFund(e.target.value)}>
              <option value="business">کسب‌وکار</option>
              <option value="manager">مدیر</option>
              <option value="custody">امانی مشتری</option>
            </NativeSelect>
          </Field>}
          {isAdmin && fund === "custody" && <div className="col-span-2"><Field label="مشتری صاحب وجه">
            <NativeSelect name="customer"><option value="">انتخاب مشتری</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect>
          </Field></div>}
          {isAdmin && fund === "custody" && <div className="col-span-2 rounded-lg border p-3">
            <details>
              <summary className="cursor-pointer text-sm">افزودن مشتری جدید</summary>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <Field label="نام مشتری"><Input name="new_customer_name" /></Field>
                <Field label="تلفن"><Input name="new_customer_phone" inputMode="tel" /></Field>
                <Field label="کد ملی"><Input name="new_customer_national_id" inputMode="numeric" /></Field>
              </div>
            </details>
          </div>}
          <Field label="شریک (اختیاری)">
            <NativeSelect name="partner"><option value="">—</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
          </Field>
          <div className="col-span-2"><Field label="خودرو (اختیاری)">
            <NativeSelect name="car"><option value="">—</option>{d.cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model} {c.plate}</option>)}</NativeSelect>
          </Field></div>
          <div className="col-span-2"><Field label="توضیحات"><Input name="description" /></Field></div>
          <Button className="col-span-2" disabled={busy}>{busy ? "در حال ذخیره…" : "ذخیره"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
