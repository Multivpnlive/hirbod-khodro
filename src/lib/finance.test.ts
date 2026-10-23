import { describe, expect, it } from "vitest";
import { carPartnerLedger, carCost, carProfit, splitProfit, partnerShare, cashBalance } from "./finance";

const car = { id: "c", purchase_price: 3500, sale_price: 4100, status: "sold" as const };
const exp = [{ car_id: "c", amount: 125 }, { car_id: "x", amount: 999 }];

describe("finance", () => {
  it("profit = sale - purchase - that car's expenses", () => {
    expect(carProfit(car, exp)).toBe(475);
  });
  it("unsold car has no realized profit", () => {
    expect(carProfit({ ...car, status: "available" }, exp)).toBeNull();
  });
  it("loss is negative", () => {
    expect(carProfit({ ...car, sale_price: 3000 }, exp)).toBe(-625);
  });
  it("splits profit by capital share in the same deal", () => {
    const r = splitProfit(1000, [
      { partner_id: "a", amount: 3000 },
      { partner_id: "b", amount: 1000 },
    ]);
    expect(r.map((x) => x.profit)).toEqual([750, 250]);
  });
  it("partner share from own vs total capital", () => {
    expect(partnerShare(-400, 1, 4)).toBe(-100);
  });
  it("cash = receipts minus payments, expenses and settlements", () => {
    expect(
      cashBalance([
        { type: "receipt", amount: 100 },
        { type: "payment", amount: 30 },
        { type: "expense", amount: 10 },
        { type: "settlement", amount: 20 },
      ]),
    ).toBe(40);
  });
  it("cost counts purchase + expenses once, not partner capital", () => {
    expect(carCost(car, exp)).toBe(3625);
  });
  it("ledger: capital share, profit share and due after settlement", () => {
    const r = carPartnerLedger(car, exp,
      [{ car_id: "c", partner_id: "a", amount: 3000 }, { car_id: "c", partner_id: "b", amount: 1000 }],
      [{ type: "settlement", car_id: "c", partner_id: "a", amount: 1000 }, { type: "settlement", car_id: "x", partner_id: "b", amount: 50 }]);
    expect(r.map((x) => x.profit)).toEqual([356, 119]);
    expect(r.map((x) => x.due)).toEqual([2356, 1119]);
    expect(r[0]!.sharePct).toBe(0.75);
  });
  it("loss is split proportionally too", () => {
    const r = carPartnerLedger({ ...car, sale_price: 3000 }, exp,
      [{ car_id: "c", partner_id: "a", amount: 1000 }, { car_id: "c", partner_id: "b", amount: 1000 }], []);
    expect(r.map((x) => x.profit)).toEqual([-312, -312]);
  });
});
