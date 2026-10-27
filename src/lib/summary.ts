import type { Car, Expense, Investment, Txn } from "@/lib/data";
import { carPartnerLedger } from "@/lib/finance";

export function partnerSummary(
  pid: string,
  d: {
    cars: Car[];
    expenses: Expense[];
    investments: Investment[];
    txns: Txn[];
  },
) {
  const mine = d.investments.filter((i) => i.partner_id === pid);

  const capital = mine.reduce((sum, i) => sum + Number(i.amount), 0);

  const soldCarIds = new Set(d.cars.filter((car) => car.status === "sold").map((car) => car.id));

  const soldInvestments = mine.filter((i) => soldCarIds.has(i.car_id));

  const soldCapital = soldInvestments.reduce((sum, i) => sum + Number(i.amount), 0);

  const soldLedger = d.cars
    .filter((car) => car.status === "sold")
    .flatMap((car) =>
      carPartnerLedger(car, d.expenses, d.investments, d.txns).filter(
        (entry) => entry.partner_id === pid,
      ),
    );

  const profit = soldLedger.reduce((sum, entry) => sum + entry.profit, 0);
  const settled = soldLedger.reduce((sum, entry) => sum + entry.settled, 0);
  const due = soldLedger.reduce((sum, entry) => sum + entry.due, 0);

  return {
    capital,
    soldCapital,
    profit,
    settled,
    due,
    deals: mine.length,
  };
}
