import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Pencil, Plus, Search, Trash2, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { useAllData, usePerms } from "@/lib/data";
import { customerInvestorSummary } from "@/lib/summary";
import { toman } from "@/lib/format";
import { errorText, normalizeNationalId, normalizePhone } from "@/lib/feature-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "مشتریان | هیربد خودرو" }] }),
  component: CustomersPage,
});

const db = supabase as any;

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  national_id: string | null;
  notes: string | null;
  is_demo: boolean;
};

function CustomersPage() {
  const d = useAllData();
  const { isAdmin, can } = usePerms();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState("");

  const mayView = isAdmin || can("customers", "view");
  const mayCreate = isAdmin || can("customers", "create");
  const mayEdit = isAdmin || can("customers", "edit");
  const mayDelete = isAdmin || can("customers", "delete");
  const mayViewFinancials = isAdmin || can("partners", "view");

  async function load() {
    if (!mayView) return;
    const { data, error } = await db.from("customers")
      .select("id,name,phone,national_id,notes,is_demo")
      .eq("is_demo", false).order("name");
    if (error) toast.error(`بارگذاری مشتریان: ${error.message}`);
    else setCustomers((data ?? []) as Customer[]);
  }

  useEffect(() => { void load(); }, [mayView]);

  async function saveCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const name = String(f.get("name") ?? "").trim();
    if (!name) { toast.error("نام مشتری الزامی است"); return; }
    const payload = {
      name,
      phone: normalizePhone(String(f.get("phone") ?? "")) || null,
      national_id: normalizeNationalId(String(f.get("national_id") ?? "")) || null,
      notes: String(f.get("notes") ?? "").trim() || null,
    };
    setBusy(true);
    const { error } = editing
      ? await db.from("customers").update(payload).eq("id", editing.id)
      : await db.from("customers").insert({ ...payload, is_demo: false });
    setBusy(false);
    if (error) { toast.error(errorText(error)); return; }
    toast.success(editing ? "اطلاعات مشتری ویرایش شد" : "مشتری ثبت شد");
    setFormOpen(false);
    setEditing(null);
    await load();
  }

  async function deleteCustomer(customer: Customer) {
    if (!window.confirm(`مشتری «${customer.name}» حذف شود؟`)) return;
    const [carRefs, transactionRefs, transferRefs, brokerageRefs, hawalaRefs, linkedPartnerResult] = await Promise.all([
      db.from("cars").select("id", { count: "exact", head: true }).eq("buyer_customer_id", customer.id),
      db.from("transactions").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      db.from("fund_transfers").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      db.from("brokerage_deals").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      db.from("hawalas").select("id", { count: "exact", head: true }).eq("customer_id", customer.id),
      db.from("partners").select("id").eq("customer_id", customer.id),
    ]);
    const refError = carRefs.error || transactionRefs.error || transferRefs.error || brokerageRefs.error || hawalaRefs.error || linkedPartnerResult.error;
    if (refError) { toast.error(errorText(refError)); return; }
    const partnerIds = (linkedPartnerResult.data ?? []).map((partner: { id: string }) => partner.id);
    const partnerHistoryChecks = partnerIds.length ? await Promise.all([
      db.from("car_investments").select("partner_id", { count: "exact", head: true }).in("partner_id", partnerIds),
      db.from("hawala_investments").select("partner_id", { count: "exact", head: true }).in("partner_id", partnerIds),
      db.from("transactions").select("id", { count: "exact", head: true }).in("partner_id", partnerIds),
      db.from("commission_splits").select("partner_id", { count: "exact", head: true }).in("partner_id", partnerIds),
    ]) : [];
    const partnerHistoryError = partnerHistoryChecks.find((result) => result.error)?.error;
    if (partnerHistoryError) { toast.error(errorText(partnerHistoryError)); return; }
    const hasPartnerHistory = partnerHistoryChecks.some((result) => (result.count ?? 0) > 0);
    if ([carRefs.count, transactionRefs.count, transferRefs.count, brokerageRefs.count, hawalaRefs.count].some((count) => (count ?? 0) > 0) || hasPartnerHistory) {
      toast.error("این مشتری در سابقهٔ خودرو یا امور مالی استفاده شده و برای حفظ سوابق قابل حذف نیست.");
      return;
    }
    const { data: deletedCustomer, error } = await db.from("customers")
      .delete()
      .eq("id", customer.id)
      .select("id")
      .maybeSingle();
    if (error) { toast.error(errorText(error)); return; }
    if (!deletedCustomer) {
      toast.error("مشتری حذف نشد؛ احتمالاً مجوز حذف در پایگاه داده برای حساب شما فعال نیست.");
      await load();
      return;
    }
    toast.success("مشتری حذف شد");
    await load();
  }

  async function linkAsInvestor(customer: Customer) {
    if (!mayCreate) return;
    const { error } = await db.from("partners").insert({
      customer_id: customer.id,
      name: customer.name,
      phone: customer.phone,
      is_demo: customer.is_demo,
    });
    if (error) { toast.error(errorText(error)); return; }
    toast.success("پروفایل مالی مشتری فعال شد.");
    await d.refetch();
  }

  const filtered = customers.filter((customer) =>
    `${customer.name} ${customer.phone ?? ""} ${customer.national_id ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (!mayView) return <div className="rounded-xl border p-5 text-sm text-muted-foreground">شما مجوز مشاهده فهرست مشتریان را ندارید.</div>;

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader
        title="مشتریان"
        action={mayCreate ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}><Plus className="size-4" /> مشتری جدید</Button> : undefined}
      />

      <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="relative max-w-xl">
          <Search className="absolute right-3 top-2.5 size-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="جستجو با نام، تلفن یا کد ملی" className="bg-card pr-9" />
        </div>
        <div className="text-sm text-muted-foreground">{filtered.length.toLocaleString("fa-IR-u-nu-latn")} مشتری</div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((customer) => (
          <article key={customer.id} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate font-bold">{customer.name}</h2>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2"><dt className="text-muted-foreground">تلفن</dt><dd dir="ltr" className="text-left">{customer.phone || "ثبت نشده"}</dd></div>
                  <div className="flex gap-2"><dt className="text-muted-foreground">کد ملی</dt><dd dir="ltr" className="text-left">{customer.national_id || "ثبت نشده"}</dd></div>
                </dl>
              </div>
              {(mayEdit || mayDelete) && <div className="flex shrink-0 gap-1">
                {mayEdit && <button type="button" className="rounded-md p-2 hover:bg-accent" aria-label="ویرایش مشتری" title="ویرایش" onClick={() => { setEditing(customer); setFormOpen(true); }}><Pencil className="size-4" /></button>}
                {mayDelete && <button type="button" className="rounded-md p-2 text-destructive hover:bg-destructive/10" aria-label="حذف مشتری" title="حذف" onClick={() => void deleteCustomer(customer)}><Trash2 className="size-4" /></button>}
              </div>}
            </div>
            {customer.notes && <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">{customer.notes}</p>}
            <details className="mt-3 border-t pt-3">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold">
                <span>پرونده و اطلاعات مالی</span><ChevronDown className="size-4" />
              </summary>
              {(() => {
                const linkedPartners = (d.partners as Array<any>).filter((partner) => partner.customer_id === customer.id);
                const stats = customerInvestorSummary(customer.id, { ...d, partners: d.partners as Array<any> });
                return linkedPartners.length && mayViewFinancials ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div><div className="text-xs text-muted-foreground">مجموع سرمایه‌گذاری</div><b>{toman(stats.investmentTotal)}</b></div>
                    <div><div className="text-xs text-muted-foreground">سرمایهٔ باقیمانده</div><b>{toman(stats.currentCapital)}</b></div>
                    <div><div className="text-xs text-muted-foreground">تعداد معامله</div><b>{stats.deals.toLocaleString("fa-IR-u-nu-latn")}</b></div>
                    <div><div className="text-xs text-muted-foreground">سهم سود/زیان</div><b className={stats.profit >= 0 ? "text-success" : "text-destructive"}>{toman(stats.profit)}</b></div>
                    <div><div className="text-xs text-muted-foreground">ماندهٔ تسویه</div><b>{toman(stats.due)}</b></div>
                  </div>
                ) : linkedPartners.length ? (
                  <div className="mt-3 text-sm text-muted-foreground">برای مشاهدهٔ اطلاعات سرمایه‌گذاری، مجوز مشاهدهٔ مالی لازم است.</div>
                ) : (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                    <span>برای این مشتری سابقهٔ سرمایه‌گذاری ثبت نشده است.</span>
                    {mayCreate && <Button size="sm" variant="outline" onClick={() => void linkAsInvestor(customer)}>فعال‌سازی سرمایه‌گذاری</Button>}
                  </div>
                );
              })()}
            </details>
          </article>
        ))}
        {filtered.length === 0 && <p className="rounded-lg border bg-card p-4 text-sm text-muted-foreground sm:col-span-2 xl:col-span-3">{customers.length ? "مشتری‌ای با این مشخصات پیدا نشد." : "هنوز مشتری ثبت نشده است."}</p>}
      </section>

      <Dialog open={formOpen} onOpenChange={(open) => { setFormOpen(open); if (!open) setEditing(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>{editing ? "ویرایش مشتری" : "ثبت مشتری جدید"}</DialogTitle></DialogHeader>
          <form key={editing?.id ?? "new-customer"} onSubmit={(e) => void saveCustomer(e)} className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-sm sm:col-span-2">نام و نام خانوادگی<Input name="name" defaultValue={editing?.name ?? ""} required autoFocus /></label>
            <label className="grid gap-1 text-sm">تلفن<Input name="phone" defaultValue={editing?.phone ?? ""} inputMode="tel" dir="ltr" /></label>
            <label className="grid gap-1 text-sm">کد ملی<Input name="national_id" defaultValue={editing?.national_id ?? ""} inputMode="numeric" dir="ltr" /></label>
            <label className="grid gap-1 text-sm sm:col-span-2">یادداشت<textarea name="notes" defaultValue={editing?.notes ?? ""} rows={3} className="rounded-md border bg-background px-3 py-2" /></label>
            <Button disabled={busy} className="sm:col-span-2">{busy ? "در حال ذخیره…" : editing ? "ذخیره تغییرات" : "ثبت مشتری"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
