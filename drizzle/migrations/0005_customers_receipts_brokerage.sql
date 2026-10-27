-- Additive. Rollback: 0005_rollback.sql.
CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, phone text, notes text,
  created_at timestamptz NOT NULL DEFAULT now());
-- explicit per-partner grant; section access alone is NOT enough
CREATE TABLE IF NOT EXISTS public.customer_access (
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  PRIMARY KEY (customer_id, partner_id));

CREATE OR REPLACE FUNCTION public.can_see_customer(_cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.has_role(auth.uid(),'admin') OR EXISTS (
    SELECT 1 FROM public.customer_access ca
    WHERE ca.customer_id=_cid AND ca.partner_id IN (SELECT public.my_partner_ids()))
$$;
REVOKE ALL ON FUNCTION public.can_see_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_customer(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_see_car_financials(_car_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.has_role(auth.uid(),'admin')
    OR public.has_partner_perm(auth.uid(),'view_all_cars')
    OR EXISTS (
      SELECT 1 FROM public.car_investments ci
      WHERE ci.car_id=_car_id AND ci.partner_id IN (SELECT public.my_partner_ids()))
$$;
REVOKE ALL ON FUNCTION public.can_see_car_financials(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_car_financials(uuid) TO authenticated;

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_access ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.customers TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.customer_access TO authenticated;
GRANT ALL ON public.customers, public.customer_access TO service_role;
DROP POLICY IF EXISTS "customers visible" ON public.customers;
CREATE POLICY "customers visible" ON public.customers FOR SELECT TO authenticated
  USING (public.can_see_customer(id));
DROP POLICY IF EXISTS "admin writes customers" ON public.customers;
CREATE POLICY "admin writes customers" ON public.customers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "access visible" ON public.customer_access;
CREATE POLICY "access visible" ON public.customer_access FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR partner_id IN (SELECT public.my_partner_ids()));
DROP POLICY IF EXISTS "admin writes access" ON public.customer_access;
CREATE POLICY "admin writes access" ON public.customer_access FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS buyer_customer_id uuid REFERENCES public.customers(id);

-- partial sale receipts, traceable to a receipt transaction
CREATE TABLE IF NOT EXISTS public.sale_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id),
  txn_id uuid NOT NULL UNIQUE REFERENCES public.transactions(id),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.sale_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id),
  kind text NOT NULL CHECK (kind IN ('discount','write_off')),
  amount numeric(16,0) NOT NULL CHECK (amount > 0),
  note text, created_at timestamptz NOT NULL DEFAULT now());

CREATE OR REPLACE VIEW public.car_receivables WITH (security_invoker = false) AS
SELECT c.id AS car_id, c.sale_price,
  coalesce((SELECT sum(t.amount) FROM public.sale_receipts r JOIN public.transactions t ON t.id=r.txn_id WHERE r.car_id=c.id),0) AS received,
  coalesce((SELECT sum(a.amount) FROM public.sale_adjustments a WHERE a.car_id=c.id),0) AS adjusted,
  greatest(c.sale_price
   - coalesce((SELECT sum(t.amount) FROM public.sale_receipts r JOIN public.transactions t ON t.id=r.txn_id WHERE r.car_id=c.id),0)
   - coalesce((SELECT sum(a.amount) FROM public.sale_adjustments a WHERE a.car_id=c.id),0),0) AS outstanding
FROM public.cars c
WHERE c.status='sold' AND public.can_see_car_financials(c.id);

-- brokerage: only agreed commission is income
CREATE TABLE IF NOT EXISTS public.brokerage_deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id),
  car_id uuid REFERENCES public.cars(id),
  deal_value numeric(16,0) NOT NULL DEFAULT 0 CHECK (deal_value >= 0), -- NOT income
  commission numeric(16,0) NOT NULL DEFAULT 0 CHECK (commission >= 0),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.commission_splits (
  deal_id uuid NOT NULL REFERENCES public.brokerage_deals(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id),
  pct numeric(5,2) NOT NULL CHECK (pct > 0 AND pct <= 100),
  PRIMARY KEY (deal_id, partner_id));
ALTER TABLE public.sale_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brokerage_deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_splits ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sale_receipts, public.sale_adjustments, public.brokerage_deals, public.commission_splits TO authenticated;
GRANT SELECT ON public.car_receivables TO authenticated;
GRANT ALL ON public.sale_receipts, public.sale_adjustments, public.brokerage_deals, public.commission_splits TO service_role;
DROP POLICY IF EXISTS "admin read sale_receipts" ON public.sale_receipts;
CREATE POLICY "admin read sale_receipts" ON public.sale_receipts FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin all sale_adjustments" ON public.sale_adjustments;
CREATE POLICY "admin all sale_adjustments" ON public.sale_adjustments FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin all brokerage" ON public.brokerage_deals;
CREATE POLICY "admin all brokerage" ON public.brokerage_deals FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "admin all splits" ON public.commission_splits;
CREATE POLICY "admin all splits" ON public.commission_splits FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
DROP POLICY IF EXISTS "partner sees own splits" ON public.commission_splits;
CREATE POLICY "partner sees own splits" ON public.commission_splits FOR SELECT TO authenticated USING (partner_id IN (SELECT public.my_partner_ids()));
DROP POLICY IF EXISTS "partner sees permitted deals" ON public.brokerage_deals;
CREATE POLICY "partner sees permitted deals" ON public.brokerage_deals FOR SELECT TO authenticated
  USING (customer_id IS NOT NULL AND public.can_see_customer(customer_id));

-- Financial rows are visible only to admins and partners allowed to see the car.
DROP POLICY IF EXISTS "permitted users read sale_receipts" ON public.sale_receipts;
CREATE POLICY "permitted users read sale_receipts" ON public.sale_receipts FOR SELECT TO authenticated
  USING (public.can_see_car_financials(car_id));
DROP POLICY IF EXISTS "permitted users read sale_adjustments" ON public.sale_adjustments;
CREATE POLICY "permitted users read sale_adjustments" ON public.sale_adjustments FOR SELECT TO authenticated
  USING (public.can_see_car_financials(car_id));

-- Keep the receipt relation consistent with its underlying cash transaction.
CREATE OR REPLACE FUNCTION public.guard_sale_receipt_link()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_type public.txn_type;
  v_car_id uuid;
  v_fund text;
  v_is_demo boolean;
BEGIN
  SELECT type, car_id, fund, is_demo INTO v_type, v_car_id, v_fund, v_is_demo
  FROM public.transactions WHERE id = NEW.txn_id;
  IF NOT FOUND OR v_type <> 'receipt' OR v_car_id IS DISTINCT FROM NEW.car_id
     OR v_fund <> 'business' OR v_is_demo THEN
    RAISE EXCEPTION 'Sale receipt must reference a business-fund receipt for the same car'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_sale_receipt_link ON public.sale_receipts;
CREATE TRIGGER trg_guard_sale_receipt_link
BEFORE INSERT OR UPDATE ON public.sale_receipts
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_receipt_link();

-- Serialize receipts and adjustments per car so concurrent writes cannot exceed the sale price.
CREATE OR REPLACE FUNCTION public.guard_sale_receivable_amount()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sale_price numeric;
  v_status public.car_status;
  v_received numeric;
  v_adjusted numeric;
BEGIN
  SELECT sale_price, status INTO v_sale_price, v_status
  FROM public.cars WHERE id = NEW.car_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'sold' OR v_sale_price IS NULL THEN
    RAISE EXCEPTION 'Receipts and adjustments require a sold car with a sale price'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_received
  FROM public.transactions
  WHERE car_id = NEW.car_id AND type = 'receipt' AND fund = 'business' AND NOT is_demo
    AND (TG_TABLE_NAME <> 'transactions' OR id <> NEW.id);

  SELECT COALESCE(SUM(amount), 0) INTO v_adjusted
  FROM public.sale_adjustments
  WHERE car_id = NEW.car_id
    AND (TG_TABLE_NAME <> 'sale_adjustments' OR id <> NEW.id);

  IF v_received + v_adjusted + NEW.amount > v_sale_price THEN
    RAISE EXCEPTION 'Receipt or adjustment exceeds the remaining sale balance'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_sale_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sale_price numeric;
  v_status public.car_status;
  v_received numeric;
  v_adjusted numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM public.sale_receipts WHERE txn_id = OLD.id
  ) AND (NEW.type <> 'receipt' OR NEW.car_id IS DISTINCT FROM OLD.car_id
    OR NEW.fund <> 'business' OR NEW.is_demo IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'A linked sale receipt cannot change type, car, or fund'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_demo OR NEW.type <> 'receipt' OR NEW.fund <> 'business' OR NEW.car_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT sale_price, status INTO v_sale_price, v_status
  FROM public.cars WHERE id = NEW.car_id FOR UPDATE;
  IF NOT FOUND OR v_status <> 'sold' THEN
    RETURN NEW;
  END IF;
  IF v_sale_price IS NULL THEN
    RAISE EXCEPTION 'A sold car must have a sale price before receiving a sale payment'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_received
  FROM public.transactions
  WHERE car_id = NEW.car_id AND type = 'receipt' AND fund = 'business' AND NOT is_demo
    AND (TG_OP = 'INSERT' OR id <> NEW.id);
  SELECT COALESCE(SUM(amount), 0) INTO v_adjusted
  FROM public.sale_adjustments WHERE car_id = NEW.car_id;

  IF v_received + v_adjusted + NEW.amount > v_sale_price THEN
    RAISE EXCEPTION 'Receipt exceeds the remaining sale balance'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_sale_receipt_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.type = 'receipt' AND NEW.fund = 'business' AND NOT NEW.is_demo AND NEW.car_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.cars WHERE id = NEW.car_id AND status = 'sold') THEN
    INSERT INTO public.sale_receipts (car_id, txn_id) VALUES (NEW.car_id, NEW.id)
    ON CONFLICT (txn_id) DO UPDATE SET car_id = EXCLUDED.car_id;
  ELSE
    DELETE FROM public.sale_receipts WHERE txn_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.link_sold_car_receipts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'sold' AND NEW.status = 'sold' THEN
    INSERT INTO public.sale_receipts (car_id, txn_id)
    SELECT NEW.id, t.id
    FROM public.transactions t
    WHERE t.car_id = NEW.id AND t.type = 'receipt'
      AND t.fund = 'business' AND NOT t.is_demo
    ON CONFLICT (txn_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_sold_car_price()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_received numeric;
  v_adjusted numeric;
BEGIN
  IF NEW.status <> 'sold' AND EXISTS (
    SELECT 1 FROM public.sale_receipts WHERE car_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'A car with recorded sale receipts cannot be moved out of sold status'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'sold' OR NEW.sale_price IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_received
  FROM public.transactions
  WHERE car_id = NEW.id AND type = 'receipt' AND fund = 'business' AND NOT is_demo;
  SELECT COALESCE(SUM(amount), 0) INTO v_adjusted
  FROM public.sale_adjustments WHERE car_id = NEW.id;
  IF v_received + v_adjusted > NEW.sale_price THEN
    RAISE EXCEPTION 'Sale price cannot be lower than receipts and adjustments already recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Preserve and classify already-recorded receipts for sold cars.
INSERT INTO public.sale_receipts (car_id, txn_id)
SELECT t.car_id, t.id
FROM public.transactions t
JOIN public.cars c ON c.id = t.car_id
WHERE t.type = 'receipt' AND t.fund = 'business' AND NOT t.is_demo AND c.status = 'sold'
ON CONFLICT (txn_id) DO NOTHING;

DROP TRIGGER IF EXISTS trg_guard_sale_receivable_amount ON public.sale_adjustments;
CREATE TRIGGER trg_guard_sale_receivable_amount
BEFORE INSERT OR UPDATE ON public.sale_adjustments
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_receivable_amount();
DROP TRIGGER IF EXISTS trg_guard_sale_transaction ON public.transactions;
CREATE TRIGGER trg_guard_sale_transaction
BEFORE INSERT OR UPDATE OF amount, type, car_id, fund, is_demo ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_sale_transaction();
DROP TRIGGER IF EXISTS trg_link_sale_receipt_transaction ON public.transactions;
CREATE TRIGGER trg_link_sale_receipt_transaction
AFTER INSERT OR UPDATE OF type, car_id, fund, is_demo ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.link_sale_receipt_transaction();
DROP TRIGGER IF EXISTS trg_guard_sold_car_price ON public.cars;
CREATE TRIGGER trg_guard_sold_car_price
BEFORE UPDATE OF status, sale_price ON public.cars
FOR EACH ROW EXECUTE FUNCTION public.guard_sold_car_price();
DROP TRIGGER IF EXISTS trg_link_sold_car_receipts ON public.cars;
CREATE TRIGGER trg_link_sold_car_receipts
AFTER UPDATE OF status ON public.cars
FOR EACH ROW EXECUTE FUNCTION public.link_sold_car_receipts();

CREATE OR REPLACE FUNCTION public.guard_partner_settlement_due()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sale_price numeric;
  v_purchase_price numeric;
  v_profit numeric;
  v_expenses numeric;
  v_own_capital numeric;
  v_total_capital numeric;
  v_settled numeric;
  v_due numeric;
BEGIN
  IF NEW.type <> 'settlement' OR NEW.is_demo THEN
    RETURN NEW;
  END IF;
  IF NEW.car_id IS NULL OR NEW.partner_id IS NULL THEN
    RAISE EXCEPTION 'A real partner settlement must reference a car and partner'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT sale_price, purchase_price INTO v_sale_price, v_purchase_price
  FROM public.cars WHERE id = NEW.car_id AND status = 'sold' FOR UPDATE;
  IF NOT FOUND OR v_sale_price IS NULL THEN
    RAISE EXCEPTION 'Partner settlements require a sold car with a sale price'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_own_capital
  FROM public.car_investments
  WHERE car_id = NEW.car_id AND partner_id = NEW.partner_id AND NOT is_demo;
  SELECT COALESCE(SUM(amount), 0) INTO v_total_capital
  FROM public.car_investments WHERE car_id = NEW.car_id AND NOT is_demo;
  IF v_own_capital <= 0 OR v_total_capital <= 0 THEN
    RAISE EXCEPTION 'A settlement partner must have capital in the car'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_expenses
  FROM public.car_expenses WHERE car_id = NEW.car_id AND NOT is_demo;
  SELECT COALESCE(SUM(amount), 0) INTO v_settled
  FROM public.transactions
  WHERE type = 'settlement' AND car_id = NEW.car_id AND partner_id = NEW.partner_id
    AND NOT is_demo AND (TG_OP = 'INSERT' OR id <> NEW.id);

  v_profit := v_sale_price - v_purchase_price - v_expenses;
  v_due := v_own_capital + floor(v_profit * v_own_capital / v_total_capital + 0.5) - v_settled;
  IF NEW.amount > greatest(v_due, 0) THEN
    RAISE EXCEPTION 'Settlement exceeds this partner''s remaining deal balance'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_partner_settlement_due ON public.transactions;
CREATE TRIGGER trg_guard_partner_settlement_due
BEFORE INSERT OR UPDATE OF amount, type, car_id, partner_id, is_demo ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.guard_partner_settlement_due();

-- A deal's partner commissions may never exceed the agreed commission.
CREATE OR REPLACE FUNCTION public.guard_commission_split_total()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_total numeric;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.deal_id <> OLD.deal_id THEN
    RAISE EXCEPTION 'A commission split cannot be moved to another deal'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.deal_id::text, 0));
  IF TG_OP = 'UPDATE' THEN
    SELECT COALESCE(SUM(pct), 0) INTO v_total FROM public.commission_splits
    WHERE deal_id = NEW.deal_id AND partner_id <> OLD.partner_id;
  ELSE
    SELECT COALESCE(SUM(pct), 0) INTO v_total FROM public.commission_splits
    WHERE deal_id = NEW.deal_id;
  END IF;
  IF v_total + NEW.pct > 100 THEN
    RAISE EXCEPTION 'Commission splits cannot exceed 100 percent'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_commission_split_total ON public.commission_splits;
CREATE TRIGGER trg_guard_commission_split_total
BEFORE INSERT OR UPDATE ON public.commission_splits
FOR EACH ROW EXECUTE FUNCTION public.guard_commission_split_total();

DROP POLICY IF EXISTS "partner reads transactions" ON public.transactions;
DROP POLICY IF EXISTS "partner reads business transactions" ON public.transactions;
CREATE POLICY "partner reads business transactions" ON public.transactions FOR SELECT TO authenticated
  USING (fund = 'business' AND
    (partner_id IN (SELECT public.my_partner_ids()) OR public.has_partner_perm(auth.uid(), 'view_all_partners')));
DROP POLICY IF EXISTS "partner inserts transactions" ON public.transactions;
DROP POLICY IF EXISTS "partner inserts permitted transactions" ON public.transactions;
CREATE POLICY "partner inserts permitted transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK (
    fund = 'business'
    AND ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
      OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')))
    AND (partner_id IS NULL OR partner_id IN (SELECT public.my_partner_ids())
      OR (type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements')))
    AND (car_id IS NULL OR public.can_see_car_financials(car_id))
  );
DROP POLICY IF EXISTS "partner updates transactions" ON public.transactions;
DROP POLICY IF EXISTS "partner updates permitted transactions" ON public.transactions;
CREATE POLICY "partner updates permitted transactions" ON public.transactions FOR UPDATE TO authenticated
  USING (
    fund = 'business'
    AND (partner_id IN (SELECT public.my_partner_ids()) OR public.has_partner_perm(auth.uid(), 'manage_settlements'))
    AND ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
      OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')))
  )
  WITH CHECK (
    fund = 'business'
    AND ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
      OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')))
    AND (partner_id IS NULL OR partner_id IN (SELECT public.my_partner_ids())
      OR (type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements')))
    AND (car_id IS NULL OR public.can_see_car_financials(car_id))
  );

DROP POLICY IF EXISTS "partner sees own splits" ON public.commission_splits;
DROP POLICY IF EXISTS "permitted partners read own-deal commission splits" ON public.commission_splits;
CREATE POLICY "permitted partners read own-deal commission splits" ON public.commission_splits FOR SELECT TO authenticated
  USING (
    partner_id IN (SELECT public.my_partner_ids())
    AND EXISTS (
      SELECT 1 FROM public.brokerage_deals bd
      WHERE bd.id = commission_splits.deal_id
        AND bd.customer_id IS NOT NULL
        AND public.can_see_customer(bd.customer_id)
    )
  );

REVOKE ALL ON FUNCTION public.guard_sale_receipt_link() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sale_receivable_amount() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sale_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_sale_receipt_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.link_sold_car_receipts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_sold_car_price() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_commission_split_total() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_partner_settlement_due() FROM PUBLIC, anon, authenticated;
