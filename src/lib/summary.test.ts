import { describe, expect, it } from "vitest";
import { partnerSummary } from "./summary";

describe("partnerSummary", () => {
  it("excludes capital in unsold cars from settlement due", () => {
    const data = {
      cars: [
        {
          id: "sold",
          purchase_price: 100,
          sale_price: 150,
          status: "sold",
        },
        {
          id: "unsold",
          purchase_price: 200,
          sale_price: null,
          status: "available",
        },
      ],
      expenses: [],
      investments: [
        { car_id: "sold", partner_id: "p1", amount: 100 },
        { car_id: "unsold", partner_id: "p1", amount: 200 },
      ],
      txns: [],
    };

    const result = partnerSummary("p1", data as never);

    expect(result.capital).toBe(300);
    expect(result.soldCapital).toBe(100);
    expect(result.profit).toBe(50);
    expect(result.due).toBe(150);
  });

  it("subtracts only settlements for the same partner and car", () => {
    const data = {
      cars: [
        {
          id: "sold",
          purchase_price: 100,
          sale_price: 150,
          status: "sold",
        },
      ],
      expenses: [],
      investments: [{ car_id: "sold", partner_id: "p1", amount: 100 }],
      txns: [
        {
          type: "settlement",
          car_id: "sold",
          partner_id: "p1",
          amount: 20,
        },
        {
          type: "settlement",
          car_id: "sold",
          partner_id: "p2",
          amount: 10,
        },
        {
          type: "settlement",
          car_id: "other",
          partner_id: "p1",
          amount: 5,
        },
      ],
    };

    const result = partnerSummary("p1", data as never);

    expect(result.settled).toBe(20);
    expect(result.due).toBe(130);
  });
});
