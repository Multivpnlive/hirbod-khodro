import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader, Stat } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { carProfit, cashBalance } from "@/lib/finance";
import { fmt, toman, statusLabel } from "@/lib/format";
import { jalaliMonthKey, jalaliMonthLabel } from "@/lib/jalali";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "داشبورد | هیربد خودرو" }] }),
  component: Dashboard,
});

function Dashboard() {
  const { cars, expenses, investments, txns, isLoading } = useAllData();

  const s = useMemo(() => {
    const capital = investments.reduce((a, i) => a + Number(i.amount), 0);
    const tradeValue = cars.reduce((a, c) => a + Number(c.purchase_price) + (c.status === "sold" ? Number(c.sale_price ?? 0) : 0), 0);
    const profits = cars.map((c) => ({ c, p: carProfit(c, expenses) })).filter((x) => x.p !== null) as { c: (typeof cars)[0]; p: number }[];
    const profit = profits.reduce((a, x) => a + x.p, 0);
    const byMonth = new Map<string, number>();
    profits.forEach(({ c, p }) => {
      const k = jalaliMonthKey(c.sale_date ?? c.purchase_date);
      byMonth.set(k, (byMonth.get(k) ?? 0) + p);
    });
    const monthly = [...byMonth.entries()].sort().map(([k, v]) => {
      const [jy, jm] = k.split("-").map(Number);
      return { m: jalaliMonthLabel(jy!, jm!), v };
    });
    const statuses = (["available", "reserved", "sold"] as const).map((st) => ({ name: statusLabel[st], value: cars.filter((c) => c.status === st).length }));
    return { capital, tradeValue, profit, cash: cashBalance(txns), monthly, statuses, profits };
  }, [cars, expenses, investments, txns]);

  if (isLoading) return <div className="text-muted-foreground">در حال بارگذاری…</div>;
  const colors = ["hsl(var(--chart-1))", "hsl(var(--chart-2))", "hsl(var(--chart-5))"];

  return (
    <div>
      <PageHeader title="داشبورد مدیریتی" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="مجموع سرمایه شرکا" value={toman(s.capital)} />
        <Stat label="ارزش معاملات" value={toman(s.tradeValue)} />
        <Stat label="سود و زیان خالص" value={toman(s.profit)} tone={s.profit >= 0 ? "pos" : "neg"} />
        <Stat label="موجودی نقدی" value={toman(s.cash)} tone={s.cash >= 0 ? undefined : "neg"} />
      </div>
      <div className="grid lg:grid-cols-3 gap-4 mt-6">
        <div className="card-elevated p-4 lg:col-span-2">
          <div className="font-bold mb-3">سود و زیان ماهانه (میلیون تومان)</div>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer>
              <BarChart data={s.monthly.map((x) => ({ ...x, v: Math.round(x.v / 1e6) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="m" fontSize={12} />
                <YAxis fontSize={12} tickFormatter={(v) => fmt(v)} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]}>
                  {s.monthly.map((x, i) => (
                    <Cell key={i} fill={x.v >= 0 ? "hsl(var(--chart-2))" : "hsl(var(--chart-4))"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card-elevated p-4">
          <div className="font-bold mb-3">وضعیت خودروها</div>
          <div className="h-64" dir="ltr">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={s.statuses} dataKey="value" nameKey="name" innerRadius={50} outerRadius={85} paddingAngle={3}>
                  {s.statuses.map((_, i) => (
                    <Cell key={i} fill={colors[i]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 text-xs">
            {s.statuses.map((x, i) => (
              <span key={x.name} className="flex items-center gap-1">
                <span className="size-2.5 rounded-full" style={{ background: colors[i] }} />
                {x.name} ({fmt(x.value)})
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="card-elevated p-4 mt-6">
        <div className="font-bold mb-3">آخرین معاملات فروخته‌شده</div>
        <div className="divide-y">
          {s.profits.slice(0, 5).map(({ c, p }) => (
            <div key={c.id} className="flex justify-between py-2 text-sm">
              <span>{c.brand} {c.model}</span>
              <span className={p >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{toman(p)}</span>
            </div>
          ))}
          {s.profits.length === 0 && <div className="text-sm text-muted-foreground py-2">هنوز معامله‌ای فروخته نشده.</div>}
        </div>
      </div>
    </div>
  );
}
