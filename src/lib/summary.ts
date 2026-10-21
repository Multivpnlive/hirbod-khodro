import type { Car, Expense, Investment, Txn } from "@/lib/data";
import { carProfit, partnerShare } from "@/lib/finance";

export function partnerSummary(
  pid: string,
  d: { cars: Car[]; expenses: Expense[]; investments: Investment[]; txns: Txn[] },
) {
  const mine = d.investments.filter((i) => i.partner_id === pid);
  const capital = mine.reduce((a, i) => a + Number(i.amount), 0);
  let profit = 0;
  for (const inv of mine) {
    const car = d.cars.find((c) => c.id === inv.car_id);
    if (!car) continue;
    const p = carProfit(car, d.expenses);
    if (p === null) continue;
    const total = d.investments.filter((i) => i.car_id === car.id).reduce((a, i) => a + Number(i.amount), 0);
    profit += partnerShare(p, Number(inv.amount), total);
  }
  const settled = d.txns.filter((t) => t.partner_id === pid && t.type === "settlement").reduce((a, t) => a + Number(t.amount), 0);
  return { capital, profit, settled, due: profit - settled, deals: mine.length };
}

