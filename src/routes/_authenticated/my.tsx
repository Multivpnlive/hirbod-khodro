import { createFileRoute } from "@tanstack/react-router";
import { PageHeader, Stat } from "@/components/AppShell";
import { useAllData, useMyShares } from "@/lib/data";
import { carProfit, partnerShare } from "@/lib/finance";
import { faDate, pct, toman, txnLabel } from "@/lib/format";
import { StatusBadge } from "@/components/form-bits";

export const Route = createFileRoute("/_authenticated/my")({
  head: () => ({ meta: [{ title: "حساب من | هیربد خودرو" }] }),
  component: MyAccount,
});

function MyAccount() {
  const d = useAllData();
  const shares = useMyShares();
  if (d.isLoading || shares.isLoading) return <div className="text-muted-foreground">در حال بارگذاری…</div>;
  const me = d.data?.partners.find((p) => p.user_id);
  if (!me)
    return (
      <div className="card-elevated p-6 max-w-lg">
        <div className="font-bold">حساب شما هنوز به پرونده شریک متصل نیست.</div>
        <p className="text-sm text-muted-foreground mt-2 leading-7">از مدیر بخواهید شما را با همین ایمیل در بخش شرکا ثبت کند؛ پس از آن اطلاعات مالی شما اینجا نمایش داده می‌شود.</p>
      </div>
    );

  const rows = (shares.data ?? []).map((s) => {
    const car = d.data!.cars.find((c) => c.id === s.car_id);
    const p = car ? carProfit(car, d.data!.expenses) : null;
    return { s, car, myProfit: p === null ? null : partnerShare(p, Number(s.my_investment), Number(s.total_investment)) };
  });
  const capital = rows.reduce((a, r) => a + Number(r.s.my_investment), 0);
  const profit = rows.reduce((a, r) => a + (r.myProfit ?? 0), 0);
  const myTxns = d.data!.txns;
  const settled = myTxns.filter((t) => t.type === "settlement").reduce((a, t) => a + Number(t.amount), 0);

  return (
    <div>
      <PageHeader title={`حساب ${me.name}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Stat label="سرمایه من در معاملات" value={toman(capital)} />
        <Stat label="سهم سود/زیان من" value={toman(profit)} tone={profit >= 0 ? "pos" : "neg"} />
        <Stat label="تسویه‌شده" value={toman(settled)} />
        <Stat label="مانده قابل دریافت" value={toman(profit - settled)} />
      </div>
      <div className="card-elevated divide-y mb-6">
        {rows.map((r) => (
          <div key={r.s.car_id} className="p-3 text-sm flex flex-wrap justify-between gap-2">
            <div>
              <b>{r.car?.brand} {r.car?.model}</b> {r.car && <StatusBadge status={r.car.status} />}
              <div className="text-xs text-muted-foreground mt-0.5">سرمایه من {toman(r.s.my_investment)} · سهم {pct(Number(r.s.my_investment) / Number(r.s.total_investment || 1))}</div>
            </div>
            <div className={(r.myProfit ?? 0) >= 0 ? "text-success font-bold" : "text-destructive font-bold"}>{r.myProfit === null ? "در جریان" : toman(r.myProfit)}</div>
          </div>
        ))}
        {rows.length === 0 && <div className="p-3 text-sm text-muted-foreground">هنوز در معامله‌ای سرمایه ندارید.</div>}
      </div>
      <div className="font-bold mb-2">تراکنش‌های من</div>
      <div className="card-elevated divide-y">
        {myTxns.map((t) => (
          <div key={t.id} className="flex justify-between p-3 text-sm">
            <span>{txnLabel[t.type]} · {faDate(t.txn_date)} {t.description && `· ${t.description}`}</span>
            <b>{toman(t.amount)}</b>
          </div>
        ))}
        {myTxns.length === 0 && <div className="p-3 text-sm text-muted-foreground">تراکنشی نیست.</div>}
      </div>
    </div>
  );
}
