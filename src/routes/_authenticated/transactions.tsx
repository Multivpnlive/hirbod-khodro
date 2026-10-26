import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

function Transactions() {
  const d = useAllData();
  const { isAdmin, perms } = usePerms();
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const list = d.txns.filter((t) => !type || t.type === type);
  const sum = (k: string) => d.txns.filter((t) => t.type === k).reduce((a, t) => a + Number(t.amount), 0);
  async function del(id: string) {
    if (!confirm("حذف این تراکنش؟")) return;
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["all-data"] });
  }
  return (
    <div>
      <PageHeader title="دریافت‌ها، پرداخت‌ها و تسویه" action={perms.add_payment || perms.manage_settlements ? <AddTxn /> : undefined} />
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <Stat label="دریافت‌ها" value={toman(sum("receipt"))} tone="pos" />
        <Stat label="پرداخت‌ها" value={toman(sum("payment"))} />
        <Stat label="هزینه‌ها" value={toman(sum("expense"))} />
        <Stat label="تسویه شرکا" value={toman(sum("settlement"))} />
        <Stat label="موجودی نقدی" value={toman(cashBalance(d.txns))} />
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
                <span className="font-bold">{txnLabel[t.type]}</span>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {faDate(t.txn_date)} {t.description && `· ${t.description}`} {car && `· ${car.brand} ${car.model}`} {p && `· ${p.name}`}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className={t.type === "receipt" ? "text-success font-bold" : "font-bold"}>{t.type === "receipt" ? "+" : "−"}{toman(t.amount)}</span>
                {isAdmin && <button onClick={() => del(t.id)} aria-label="حذف"><Trash2 className="size-4 text-muted-foreground" /></button>}
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
  const { perms } = usePerms();
  const allowedTypes = Object.entries(txnLabel).filter(([k]) =>
    k === "settlement" ? perms.manage_settlements : perms.add_payment,
  );
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("transactions").insert({
      type: f.get("type") as "receipt" | "payment" | "expense" | "settlement",
      amount: num(f.get("amount")),
      txn_date: String(f.get("date")),
      partner_id: (f.get("partner") as string) || null,
      car_id: (f.get("car") as string) || null,
      description: String(f.get("description") || ""),
    });
    if (error) { toast.error(error.message); return; }
    toast.success("تراکنش ثبت شد");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> تراکنش جدید</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>ثبت تراکنش</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid grid-cols-2 gap-3">
          <Field label="نوع">
            <NativeSelect name="type" defaultValue={allowedTypes[0]?.[0] ?? "receipt"}>
              {allowedTypes.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </NativeSelect>
          </Field>
          <Field label="مبلغ (تومان)"><Input name="amount" inputMode="numeric" required /></Field>
          <Field label="تاریخ"><JalaliDateField name="date" defaultValue={todayIso()} /></Field>
          <Field label="شریک (اختیاری)">
            <NativeSelect name="partner"><option value="">—</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
          </Field>
          <div className="col-span-2"><Field label="خودرو (اختیاری)">
            <NativeSelect name="car"><option value="">—</option>{d.cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model} {c.plate}</option>)}</NativeSelect>
          </Field></div>
          <div className="col-span-2"><Field label="توضیحات"><Input name="description" /></Field></div>
          <Button className="col-span-2">ذخیره</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
