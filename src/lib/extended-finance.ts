export type FundTxn = {
  type: "receipt" | "payment" | "expense" | "settlement" | string;
  amount: number;
  fund?: "business" | "manager" | "custody" | string | null;
  customer_id?: string | null;
  is_demo?: boolean;
};
export type FundTransfer = { customer_id: string; amount: number; target?: string; is_demo?: boolean };

const n = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;

/** Business cash excludes manager/custody ledgers and adds transfers that reclassify custody as business funds. */
export function businessCashBalance(txns: FundTxn[], transfers: FundTransfer[] = []): number {
  const txBalance = txns
    .filter((t) => !t.is_demo && (t.fund == null || t.fund === "business"))
    .reduce((sum, t) => sum + (t.type === "receipt" ? n(t.amount) : -n(t.amount)), 0);
  const custodyReclassifications = transfers
    .filter((t) => !t.is_demo && t.target !== "refund")
    .reduce((sum, t) => sum + n(t.amount), 0);
  return txBalance + custodyReclassifications;
}

/** Custody is a liability: receipts increase it, payments/expenses decrease it, transfers reduce it. */
export function customerCustodyBalance(customerId: string, txns: FundTxn[], transfers: FundTransfer[]): number {
  const movement = txns
    .filter((t) => !t.is_demo && t.fund === "custody" && t.customer_id === customerId)
    .reduce((sum, t) => sum + (t.type === "receipt" ? n(t.amount) : -n(t.amount)), 0);
  const allocated = transfers
    .filter((t) => !t.is_demo && t.customer_id === customerId)
    .reduce((sum, t) => sum + n(t.amount), 0);
  return movement - allocated;
}

/** Sale receivable is derived, not stored; collections never alter profit. */
export function saleOutstanding(salePrice: number, receipts: number[], adjustments: number[]): number {
  return Math.max(0, n(salePrice) - receipts.reduce((s, x) => s + n(x), 0) - adjustments.reduce((s, x) => s + n(x), 0));
}
