import { describe, expect, it } from "vitest";
import {
  carPartnerLedger,
  carCost,
  carProfit,
  splitProfit,
  partnerShare,
  cashBalance,
  payableNow,
  saleReceivable,
  canAcceptSaleReceipt,
} from "./finance";

const car = { id: "c", purchase_price: 3500, sale_price: 4100, status: "sold" as const };
const exp = [
  { car_id: "c", amount: 125 },
  { car_id: "x", amount: 999 },
];

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
    const r = carPartnerLedger(
      car,
      exp,
      [
        { car_id: "c", partner_id: "a", amount: 3000 },
        { car_id: "c", partner_id: "b", amount: 1000 },
      ],
      [
        { type: "settlement", car_id: "c", partner_id: "a", amount: 1000 },
        { type: "settlement", car_id: "x", partner_id: "b", amount: 50 },
      ],
    );
    expect(r.map((x) => x.profit)).toEqual([356, 119]);
    expect(r.map((x) => x.due)).toEqual([2356, 1119]);
    expect(r[0]!.sharePct).toBe(0.75);
  });
  it("loss is split proportionally too", () => {
    const r = carPartnerLedger(
      { ...car, sale_price: 3000 },
      exp,
      [
        { car_id: "c", partner_id: "a", amount: 1000 },
        { car_id: "c", partner_id: "b", amount: 1000 },
      ],
      [],
    );
    expect(r.map((x) => x.profit)).toEqual([-312, -312]);
  });
});

// سناریوی خواسته‌شده: خرید ۵۰۰م، تعمیرات ۱۰م، فروش ۶۰۰م، سرمایه حمیدرضا ۳۰۰م و حسام ۲۰۰م
describe("سناریوی معامله ۶۰۰ میلیونی", () => {
  const deal = {
    id: "deal",
    purchase_price: 500_000_000,
    sale_price: 600_000_000,
    status: "sold" as const,
  };
  const dealExp = [{ car_id: "deal", amount: 10_000_000 }];
  const dealInv = [
    { car_id: "deal", partner_id: "حمیدرضا", amount: 300_000_000 },
    { car_id: "deal", partner_id: "حسام", amount: 200_000_000 },
  ];

  it("بهای تمام‌شده = قیمت خرید + هزینه‌ها، بدون دوباره‌شماری سرمایه", () => {
    expect(carCost(deal, dealExp)).toBe(510_000_000);
  });
  it("سود خالص ۹۰ میلیون", () => {
    expect(carProfit(deal, dealExp)).toBe(90_000_000);
  });
  it("سهم سود حمیدرضا ۵۴ میلیون و حسام ۳۶ میلیون", () => {
    const r = splitProfit(90_000_000, dealInv);
    expect(r.map((x) => x.profit)).toEqual([54_000_000, 36_000_000]);
  });
  it("مانده پیش از تسویه: ۳۵۴ و ۲۳۶ میلیون", () => {
    const r = carPartnerLedger(deal, dealExp, dealInv, []);
    expect(r.map((x) => x.due)).toEqual([354_000_000, 236_000_000]);
  });
  it("پس از پرداخت ۵۰ میلیون به حمیدرضا: مانده ۳۰۴ میلیون و مانده حسام بدون تغییر ۲۳۶ میلیون", () => {
    const r = carPartnerLedger(deal, dealExp, dealInv, [
      { type: "settlement", car_id: "deal", partner_id: "حمیدرضا", amount: 50_000_000 },
    ]);
    expect(r.map((x) => x.due)).toEqual([304_000_000, 236_000_000]);
    expect(r[0]!.settled).toBe(50_000_000);
    expect(r[1]!.settled).toBe(0);
  });
  it("پرداخت‌های متوالی جایگزین هم نمی‌شوند بلکه جمع می‌شوند", () => {
    const r = carPartnerLedger(deal, dealExp, dealInv, [
      { type: "settlement", car_id: "deal", partner_id: "حمیدرضا", amount: 50_000_000 },
      { type: "settlement", car_id: "deal", partner_id: "حمیدرضا", amount: 20_000_000 },
    ]);
    expect(r[0]!.settled).toBe(70_000_000);
    expect(r[0]!.due).toBe(284_000_000);
  });
  it("مجموع مانده‌ها = سرمایه + سود − پرداخت‌ها", () => {
    const txns = [
      { type: "settlement", car_id: "deal", partner_id: "حمیدرضا", amount: 50_000_000 },
    ];
    const r = carPartnerLedger(deal, dealExp, dealInv, txns);
    const dueTotal = r.reduce((s, x) => s + x.due, 0);
    expect(dueTotal).toBe(500_000_000 + 90_000_000 - 50_000_000);
  });
  it("سناریوی زیان: فروش ۴۵۰ میلیون → زیان ۶۰ میلیون، سهم ۳۶ و ۲۴ میلیون منفی", () => {
    const loss = { ...deal, sale_price: 450_000_000 };
    expect(carProfit(loss, dealExp)).toBe(-60_000_000);
    const r = carPartnerLedger(loss, dealExp, dealInv, []);
    expect(r.map((x) => x.profit)).toEqual([-36_000_000, -24_000_000]);
  });
  it("خودروی موجود یا رزرو سود تحقق‌یافته ندارد", () => {
    expect(carProfit({ ...deal, status: "available" }, dealExp)).toBeNull();
    expect(carProfit({ ...deal, status: "reserved" }, dealExp)).toBeNull();
    expect(carProfit({ ...deal, sale_price: null }, dealExp)).toBeNull();
  });
});

describe("fund-specific cash balance", () => {
  const txns = [
    { type: "receipt" as const, amount: 100 },
    { type: "payment" as const, amount: 20, fund: "business" as const },
    { type: "receipt" as const, amount: 70, fund: "manager" as const },
    { type: "payment" as const, amount: 10, fund: "manager" as const },
    { type: "receipt" as const, amount: 500, fund: "custody" as const },
    { type: "payment" as const, amount: 100, fund: "custody" as const },
  ];

  it("defaults legacy transactions to the business fund", () => {
    expect(cashBalance(txns)).toBe(80);
  });

  it("calculates manager funds separately", () => {
    expect(cashBalance(txns, "manager")).toBe(60);
  });

  it("calculates customer custody funds separately", () => {
    expect(cashBalance(txns, "custody")).toBe(400);
  });
});

describe("payableNow", () => {
  it("caps payment at available business cash", () => {
    expect(payableNow(1000, 300)).toBe(300);
  });

  it("never pays more than the partner due", () => {
    expect(payableNow(200, 900)).toBe(200);
  });

  it("returns zero for negative due or cash", () => {
    expect(payableNow(-100, 900)).toBe(0);
    expect(payableNow(100, -50)).toBe(0);
  });
});

describe("sale receivables", () => {
  it("subtracts partial receipts and approved adjustments from sale price", () => {
    expect(saleReceivable(600, [100, 150], [20])).toEqual({
      received: 250,
      adjusted: 20,
      outstanding: 330,
    });
  });

  it("never reports a negative balance after overpayment or adjustments", () => {
    expect(saleReceivable(100, [80, 40], [10]).outstanding).toBe(0);
  });

  it("rejects zero, negative, and over-cap receipts", () => {
    expect(canAcceptSaleReceipt(50, 50)).toBe(true);
    expect(canAcceptSaleReceipt(51, 50)).toBe(false);
    expect(canAcceptSaleReceipt(0, 50)).toBe(false);
    expect(canAcceptSaleReceipt(-1, 50)).toBe(false);
  });
});
