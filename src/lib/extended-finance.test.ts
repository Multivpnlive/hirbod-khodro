import { describe, expect, it } from "vitest";
import { businessCashBalance, convertedCarPurchasePrice, customerCustodyBalance, hawalaProfit, netBrokerageCommission, saleOutstanding } from "@/lib/extended-finance";

describe("expanded financial ledgers", () => {
  it("excludes custody from business cash and adds a reclassification once", () => {
    const txns = [
      { type: "receipt", amount: 500, fund: "custody", customer_id: "c1" },
      { type: "receipt", amount: 100, fund: "business" },
      { type: "expense", amount: 20, fund: "business" },
    ];
    expect(businessCashBalance(txns, [{ customer_id: "c1", amount: 300, target: "business" }])).toBe(380);
  });

  it("keeps the custody balance as a liability, reduced by transfers", () => {
    const txns = [
      { type: "receipt", amount: 500, fund: "custody", customer_id: "c1" },
      { type: "payment", amount: 200, fund: "custody", customer_id: "c1" },
    ];
    expect(customerCustodyBalance("c1", txns, [{ customer_id: "c1", amount: 300 }])).toBe(0);
    expect(customerCustodyBalance("c1", txns, [{ customer_id: "c1", amount: 600 }])).toBe(-300);
  });

  it("recognizes own-trade hawala profit at sale, not at collection", () => {
    expect(hawalaProfit({ mode: "own_trade", status: "sold", cost_basis: 950 }, 980)).toBe(30);
    expect(hawalaProfit({ mode: "own_hold", status: "held", cost_basis: 950 }, 980)).toBeNull();
  });

  it("deducts only business-borne brokerage costs", () => {
    expect(netBrokerageCommission(40, [
      { amount: 5, bearer: "business" },
      { amount: 9, bearer: "customer" },
    ])).toBe(35);
  });

  it("does not double-count hawala cost when converting to a car", () => {
    expect(convertedCarPurchasePrice(950, 0)).toBe(950);
    expect(convertedCarPurchasePrice(950, 50)).toBe(1000);
  });

  it("calculates receivable independently from collection timing", () => {
    expect(saleOutstanding(1200, [300, 400], [50])).toBe(450);
  });
});
