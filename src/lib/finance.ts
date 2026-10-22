export type CarLike = {
  id: string;
  purchase_price: number;
  sale_price: number | null;
  status: "available" | "reserved" | "sold";
};
export type ExpenseLike = { car_id: string; amount: number };
export type InvestmentLike = { car_id: string; partner_id: string; amount: number };

const n = (v: unknown) => Number(v ?? 0);

export function carExpensesTotal(carId: string, expenses: ExpenseLike[]) {
  return expenses.filter((e) => e.car_id === carId).reduce((s, e) => s + n(e.amount), 0);
}

export function carCost(car: CarLike, expenses: ExpenseLike[]) {
  return n(car.purchase_price) + carExpensesTotal(car.id, expenses);
}

/** Realized profit (negative = loss). null while the car is not sold. */
export function carProfit(car: CarLike, expenses: ExpenseLike[]): number | null {
  if (car.status !== "sold" || car.sale_price == null) return null;
  return n(car.sale_price) - carCost(car, expenses);
}

/** Split a profit proportionally to each partner's capital in that same deal. */
export function splitProfit(profit: number, investments: { partner_id: string; amount: number }[]) {
  const total = investments.reduce((s, i) => s + n(i.amount), 0);
  return investments.map((i) => ({
    partner_id: i.partner_id,
    amount: n(i.amount),
    sharePct: total > 0 ? n(i.amount) / total : 0,
    profit: total > 0 ? Math.round((profit * n(i.amount)) / total) : 0,
  }));
}

/** Share of a single partner given own capital and the deal's total capital. */
export function partnerShare(profit: number, myInvestment: number, totalInvestment: number) {
  if (totalInvestment <= 0) return 0;
  return Math.round((profit * myInvestment) / totalInvestment);
}

export type TxnLike = { type: "receipt" | "payment" | "expense" | "settlement"; amount: number };
export function cashBalance(txns: TxnLike[]) {
  return txns.reduce((s, t) => s + (t.type === "receipt" ? n(t.amount) : -n(t.amount)), 0);
}

export type SettlementLike = { partner_id: string | null; car_id: string | null; type: string; amount: number };

/**
 * Per-partner ledger for one car. Cost = purchase price + expenses (partner capital
 * funds that cost, so it is never added again). Due = own capital + profit/loss share
 * minus settlements already paid to that partner for this car.
 */
export function carPartnerLedger(
  car: CarLike,
  expenses: ExpenseLike[],
  investments: InvestmentLike[],
  txns: SettlementLike[],
) {
  const invs = investments.filter((i) => i.car_id === car.id);
  const profit = carProfit(car, expenses);
  const total = invs.reduce((s, i) => s + n(i.amount), 0);
  return invs.map((i) => {
    const share = profit === null ? 0 : partnerShare(profit, n(i.amount), total);
    const settled = txns
      .filter((t) => t.type === "settlement" && t.car_id === car.id && t.partner_id === i.partner_id)
      .reduce((s, t) => s + n(t.amount), 0);
    return {
      partner_id: i.partner_id,
      capital: n(i.amount),
      sharePct: total > 0 ? n(i.amount) / total : 0,
      profit: share,
      settled,
      due: profit === null ? 0 : n(i.amount) + share - settled,
    };
  });
}
