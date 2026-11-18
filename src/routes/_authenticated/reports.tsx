import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { PageHeader, Stat } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { carCost, carProfit, cashBalance, partnerShare } from "@/lib/finance";
import { faDate, toman, txnLabel } from "@/lib/format";
import { Field, NativeSelect } from "@/components/form-bits";
import { JalaliDateField } from "@/components/JalaliDateField";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "گزارش‌ها | هیربد خودرو" }] }),
  component: Reports,
});

function Reports() {
  const d = useAllData();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [carId, setCarId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [carSearch, setCarSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const customers = d.customers;
  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const partnerIds = new Set((d.partners as Array<any>)
    .filter((partner) => partner.customer_id === customerId).map((partner) => partner.id));
  const inRange = (date: string | null) => !!date && (!from || date >= from) && (!to || date <= to);

  const normalizedCarSearch = carSearch.trim().toLocaleLowerCase();
  const normalizedCustomerSearch = customerSearch.trim().toLocaleLowerCase();
  const customerName = (customerId: string | null | undefined) =>
    customers.find((customer) => customer.id === customerId)?.name ?? "";
  let cars = d.cars.filter((c) =>
    (!carId || c.id === carId) &&
    (inRange(c.sale_date) || inRange(c.purchase_date)) &&
    (!normalizedCarSearch || `${c.brand} ${c.model} ${c.plate ?? ""}`.toLocaleLowerCase().includes(normalizedCarSearch)) &&
    (!normalizedCustomerSearch || customerName((c as any).buyer_customer_id).toLocaleLowerCase().includes(normalizedCustomerSearch))
  );
  if (customerId) cars = cars.filter((c) =>
    (c as any).buyer_customer_id === customerId || d.investments.some((i) => i.car_id === c.id && partnerIds.has(i.partner_id)),
  );
  const rows = cars.map((c) => {
    const p = carProfit(c, d.expenses);
    const total = d.investments.filter((i) => i.car_id === c.id).reduce((a, i) => a + Number(i.amount), 0);
    const mine = customerId
      ? d.investments.filter((i) => i.car_id === c.id && partnerIds.has(i.partner_id)).reduce((sum, investment) => sum + Number(investment.amount), 0)
      : total;
    return { c, cost: carCost(c, d.expenses), p, share: p === null ? null : customerId ? partnerShare(p, mine, total) : p, mine };
  });
  const txns = d.txns.filter((t) => {
    const car = d.cars.find((item) => item.id === t.car_id);
    return inRange(t.txn_date) && (!carId || t.car_id === carId) && (!customerId || partnerIds.has(t.partner_id ?? "") || (t as any).customer_id === customerId) &&
      (!normalizedCarSearch || !!car && `${car.brand} ${car.model} ${car.plate ?? ""}`.toLocaleLowerCase().includes(normalizedCarSearch)) &&
      (!normalizedCustomerSearch || customerName((t as any).customer_id).toLocaleLowerCase().includes(normalizedCustomerSearch) || !!car && customerName((car as any).buyer_customer_id).toLocaleLowerCase().includes(normalizedCustomerSearch));
  });
  const totalProfit = rows.reduce((a, r) => a + (r.share ?? 0), 0);

  return (
    <div>
      <PageHeader title="گزارش‌گیری" />
      <div className="card-elevated p-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
        <Field label="از تاریخ"><JalaliDateField value={from} onChange={setFrom} /></Field>
        <Field label="تا تاریخ"><JalaliDateField value={to} onChange={setTo} /></Field>
        <Field label="خودرو">
          <NativeSelect value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">همه</option>{d.cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model}</option>)}</NativeSelect>
        </Field>
        <Field label="مشتری">
          <NativeSelect value={customerId} onChange={(e) => setCustomerId(e.target.value)}><option value="">همه</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</NativeSelect>
        </Field>
        <Field label="جستجو بر اساس خودرو"><Input value={carSearch} onChange={(e) => setCarSearch(e.target.value)} placeholder="نام برند یا مدل" /></Field>
        <Field label="جستجو بر اساس مشتری"><Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="نام مشتری" /></Field>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="تعداد معاملات" value={new Intl.NumberFormat("fa-IR-u-nu-latn").format(rows.length)} />
        <Stat label={selectedCustomer ? "سرمایه مشتری" : "سرمایه کل"} value={toman(rows.reduce((a, r) => a + r.mine, 0))} />
        <Stat label={selectedCustomer ? "سهم سود/زیان مشتری" : "سود/زیان"} value={toman(totalProfit)} tone={totalProfit >= 0 ? "pos" : "neg"} />
        <Stat label="خالص تراکنش‌ها" value={toman(cashBalance(txns))} />
      </div>
      <div className="card-elevated overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs text-muted-foreground bg-muted"><tr>
            <th className="text-start p-3">خودرو</th><th className="text-start">خرید</th><th className="text-start">فروش</th><th className="text-start">بهای تمام‌شده</th><th className="text-start">قیمت فروش</th><th className="text-start">{selectedCustomer ? "سهم مشتری" : "سود/زیان"}</th>
          </tr></thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.c.id}>
                <td className="p-3">{r.c.brand} {r.c.model}</td>
                <td>{faDate(r.c.purchase_date)}</td>
                <td>{faDate(r.c.sale_date)}</td>
                <td>{toman(r.cost)}</td>
                <td>{r.c.sale_price ? toman(r.c.sale_price) : "—"}</td>
                <td className={(r.share ?? 0) >= 0 ? "text-success" : "text-destructive"}>{r.share === null ? "—" : toman(r.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="font-bold mb-2">تراکنش‌های بازه</div>
      <div className="card-elevated divide-y">
        {txns.map((t) => (
          <div key={t.id} className="flex justify-between p-3 text-sm">
            <span>{txnLabel[t.type]} · {faDate(t.txn_date)} {t.description && `· ${t.description}`}</span>
            <span className="font-bold">{toman(t.amount)}</span>
          </div>
        ))}
        {txns.length === 0 && <div className="p-3 text-sm text-muted-foreground">موردی نیست.</div>}
      </div>
    </div>
  );
}
