import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration0004 = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0004_cash_cap_and_funds.sql"),
  "utf8",
);
const migration0005 = readFileSync(
  resolve(process.cwd(), "drizzle/migrations/0005_customers_receipts_brokerage.sql"),
  "utf8",
);

describe("cash and sale-receipt migrations", () => {
  it("pins the inherited security-definer helpers used by RLS and auth triggers", () => {
    for (const helper of [
      "has_role(uuid, public.app_role)",
      "my_partner_ids()",
      "my_car_shares()",
      "handle_new_user()",
      "link_partner_user()",
      "has_partner_perm(uuid, text)",
    ]) {
      expect(migration0004).toContain(
        `ALTER FUNCTION public.${helper} SET search_path = public, pg_temp;`,
      );
    }
    expect(migration0004).toContain(
      "REVOKE ALL ON FUNCTION public.has_partner_perm(uuid, text) FROM PUBLIC, anon;",
    );
    expect(migration0004).toContain(
      "GRANT EXECUTE ON FUNCTION public.has_partner_perm(uuid, text) TO authenticated;",
    );
  });

  it("makes 0005 policy and trigger creation safe to retry", () => {
    for (const [, policyName, tableName] of migration0005.matchAll(
      /CREATE POLICY "([^"]+)" ON public\.(\w+)/gi,
    )) {
      expect(migration0005).toContain(
        `DROP POLICY IF EXISTS "${policyName}" ON public.${tableName};`,
      );
    }
    for (const [, triggerName, tableName] of migration0005.matchAll(
      /CREATE TRIGGER (\w+)[\s\S]*?ON public\.(\w+)\s+FOR EACH ROW/gi,
    )) {
      expect(migration0005).toContain(
        `DROP TRIGGER IF EXISTS ${triggerName} ON public.${tableName};`,
      );
    }
  });

  it("rechecks the business cash invariant when demo status changes", () => {
    expect(migration0004).toMatch(
      /CREATE TRIGGER trg_business_cash_nonnegative\s+BEFORE INSERT OR UPDATE OF amount, type, fund, is_demo OR DELETE/i,
    );
    expect(migration0004).toMatch(/AND NOT is_demo/i);
  });

  it("enforces the sale-receivable cap when receipt demo status changes", () => {
    expect(migration0005).toMatch(
      /CREATE TRIGGER trg_guard_sale_transaction\s+BEFORE INSERT OR UPDATE OF amount, type, car_id, fund, is_demo ON public\.transactions/i,
    );
    expect(migration0005).toMatch(
      /IF NEW\.is_demo OR NEW\.type <> 'receipt' OR NEW\.fund <> 'business'/i,
    );
  });

  it("keeps linked sale receipts synchronized with transactions and sold cars", () => {
    expect(migration0005).toMatch(
      /AFTER INSERT OR UPDATE OF type, car_id, fund, is_demo ON public\.transactions/i,
    );
    expect(migration0005).toMatch(/DELETE FROM public\.sale_receipts WHERE txn_id = NEW\.id/i);
    expect(migration0005).toMatch(
      /AFTER UPDATE OF status ON public\.cars\s+FOR EACH ROW EXECUTE FUNCTION public\.link_sold_car_receipts\(\)/i,
    );
    expect(migration0005).toMatch(/OR v_fund <> 'business' OR v_is_demo/i);
    expect(migration0005).toMatch(/NEW\.is_demo IS DISTINCT FROM OLD\.is_demo/i);
  });

  it("keeps partner access policies scoped to business cash and authorized rows", () => {
    expect(migration0005).toMatch(
      /CREATE POLICY "partner reads business transactions"[\s\S]*?USING \(fund = 'business'[\s\S]*?partner_id IN \(SELECT public\.my_partner_ids\(\)\)/i,
    );
    expect(migration0005).toMatch(
      /CREATE POLICY "partner inserts permitted transactions"[\s\S]*?WITH CHECK \(\s*fund = 'business'[\s\S]*?has_partner_perm\(auth\.uid\(\), 'add_payment'\)/i,
    );
    expect(migration0005).toMatch(
      /CREATE POLICY "permitted users read sale_receipts"[\s\S]*?can_see_car_financials\(car_id\)/i,
    );
  });

  it("enables row-level security on customer, receipt, and brokerage data", () => {
    for (const table of [
      "customers",
      "customer_access",
      "sale_receipts",
      "sale_adjustments",
      "brokerage_deals",
      "commission_splits",
    ]) {
      expect(migration0005).toMatch(
        new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"),
      );
    }

    expect(migration0005).toMatch(
      /CREATE POLICY "customers visible"[\s\S]*?can_see_customer\(id\)/i,
    );
    expect(migration0005).toMatch(
      /CREATE POLICY "admin writes access"[\s\S]*?has_role\(auth\.uid\(\),'admin'\)/i,
    );
    expect(migration0005).toMatch(
      /CREATE POLICY "permitted partners read own-deal commission splits"[\s\S]*?partner_id IN \(SELECT public\.my_partner_ids\(\)\)[\s\S]*?can_see_customer\(bd\.customer_id\)/i,
    );
    expect(migration0005).toMatch(
      /FUNCTION public\.can_see_customer\([\s\S]*?SECURITY DEFINER SET search_path = public, pg_temp/i,
    );
    expect(migration0005).toMatch(
      /FUNCTION public\.can_see_car_financials\([\s\S]*?SECURITY DEFINER SET search_path = public, pg_temp/i,
    );
  });
});
