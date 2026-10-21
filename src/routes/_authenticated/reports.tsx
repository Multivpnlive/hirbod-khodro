import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AdminOnly, PageHeader, Stat } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { carCost, carProfit, cashBalance, partnerShare } from "@/lib/finance";
import { faDate, toman, txnLabel } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form-bits";

export const Route = createFileRoute("/_authenticated/reports")({
  head: () => ({ meta: [{ title: "گزارش‌ها | هیربد خودرو" }] }),
  component: () => (
    <AdminOnly>
      <Reports />
    </AdminOnly>
  ),
});

function Reports() {
  const d = useAllData();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [carId, setCarId] = useState("");
  const [pid, setPid] = useState("");
  const inRange = (date: string | null) => !!date && (!from || date >= from) && (!to || date <= to);

  let cars = d.cars.filter((c) => (!carId || c.id === carId) && (inRange(c.sale_date) || inRange(c.purchase_date)));
  if (pid) cars = cars.filter((c) => d.investments.some((i) => i.car_id === c.id && i.partner_id === pid));
  const rows = cars.map((c) => {
    const p = carProfit(c, d.expenses);
    const total = d.investments.filter((i) => i.car_id === c.id).reduce((a, i) => a + Number(i.amount), 0);
    const mine = pid ? Number(d.investments.find((i) => i.car_id === c.id && i.partner_id === pid)?.amount ?? 0) : total;
    return { c, cost: carCost(c, d.expenses), p, share: p === null ? null : pid ? partnerShare(p, mine, total) : p, mine };
  });
  const txns = d.txns.filter((t) => inRange(t.txn_date) && (!carId || t.car_id === carId) && (!pid || t.partner_id === pid));
  const totalProfit = rows.reduce((a, r) => a + (r.share ?? 0), 0);

  return (
    <div>
      <PageHeader title="گزارش‌گیری" />
      <div className="card-elevated p-4 grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Field label="از تاریخ"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="تا تاریخ"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="خودرو">
          <NativeSelect value={carId} onChange={(e) => setCarId(e.target.value)}><option value="">همه</option>{d.cars.map((c) => <option key={c.id} value={c.id}>{c.brand} {c.model}</option>)}</NativeSelect>
        </Field>
        <Field label="شریک">
          <NativeSelect value={pid} onChange={(e) => setPid(e.target.value)}><option value="">همه</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</NativeSelect>
        </Field>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="تعداد معاملات" value={new Intl.NumberFormat("fa-IR").format(rows.length)} />
        <Stat label={pid ? "سرمایه شریک" : "سرمایه کل"} value={toman(rows.reduce((a, r) => a + r.mine, 0))} />
        <Stat label={pid ? "سهم سود/زیان شریک" : "سود/زیان"} value={toman(totalProfit)} tone={totalProfit >= 0 ? "pos" : "neg"} />
        <Stat label="خالص تراکنش‌ها" value={toman(cashBalance(txns))} />
      </div>
      <div className="card-elevated overflow-x-auto mb-6">
        <table className="w-full text-sm min-w-[600px]">
          <thead className="text-xs text-muted-foreground bg-muted"><tr>
            <th className="text-start p-3">خودرو</th><th className="text-start">خرید</th><th className="text-start">فروش</th><th className="text-start">بهای تمام‌شده</th><th className="text-start">قیمت فروش</th><th className="text-start">{pid ? "سهم شریک" : "سود/زیان"}</th>
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
