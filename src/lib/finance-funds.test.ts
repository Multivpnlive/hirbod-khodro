import { describe, expect, it } from "vitest";
import { cashBalance } from "@/lib/finance";

describe("cashBalance fund boundaries", () => {
  it("does not count customer custody or manager funds as business cash", () => {
    expect(cashBalance([
      { type: "receipt", amount: 500, fund: "custody" },
      { type: "payment", amount: 200, fund: "manager" },
      { type: "receipt", amount: 100, fund: "business" },
      { type: "expense", amount: 20 },
    ])).toBe(80);
  });

  it("keeps legacy transactions without a fund in the business cash pool", () => {
    expect(cashBalance([
      { type: "receipt", amount: 125 },
      { type: "payment", amount: 25 },
    ])).toBe(100);
  });
});
