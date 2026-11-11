import { describe, expect, it } from "vitest";
import { businessCashBalance, customerCustodyBalance, saleOutstanding } from "@/lib/extended-finance";

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




  it("calculates receivable independently from collection timing", () => {
    expect(saleOutstanding(1200, [300, 400], [50])).toBe(450);
  });
});
