import type { Car, Expense, Investment, Partner, Txn } from "@/lib/data";
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

/**
 * Financial overview for a customer profile linked to one or more legacy partner rows.
 * The full settlement amount is deducted from invested principal. Realized
 * profit/loss remains visible separately and does not change this capital balance.
 */
export function customerInvestorSummary(
  customerId: string,
  d: {
    partners: Array<Pick<Partner, "id"> & { customer_id?: string | null }>;
    cars: Car[];
    expenses: Expense[];
    investments: Investment[];
    txns: Txn[];
  },
) {
  const partnerIds = new Set(d.partners.filter((partner) => partner.customer_id === customerId).map((partner) => partner.id));
  const investments = d.investments.filter((investment) => partnerIds.has(investment.partner_id));
  const investmentTotal = investments.reduce((sum, investment) => sum + Number(investment.amount), 0);
  const carById = new Map(d.cars.map((car) => [car.id, car]));
  let currentCapital = 0;
  let profit = 0;
  let due = 0;

  for (const investment of investments) {
    const car = carById.get(investment.car_id);
    const principal = Number(investment.amount);
    if (!car || car.status !== "sold") {
      currentCapital += principal;
      continue;
    }

    const ledgerEntry = carPartnerLedger(car, d.expenses, d.investments, d.txns)
      .find((entry) => entry.partner_id === investment.partner_id);
    if (!ledgerEntry) continue;
    profit += ledgerEntry.profit;
    due += ledgerEntry.due;
    currentCapital += Math.max(0, principal - ledgerEntry.settled);
  }

  return {
    investmentTotal,
    currentCapital,
    deals: new Set(investments.map((investment) => investment.car_id)).size,
    profit,
    due,
  };
}
