-- Count a receipt linked to a sold car as sale collection even when the money
-- was recorded in the customer's custody fund. Custody remains excluded from
-- business cash; this migration only changes sale receivable linkage.
BEGIN;

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
     OR (v_fund IS NOT NULL AND v_fund NOT IN ('business', 'manager', 'custody')) OR v_is_demo THEN
    RAISE EXCEPTION 'Sale receipt must reference a valid non-demo receipt for the same car'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

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

  SELECT COALESCE(SUM(t.amount), 0) INTO v_received
  FROM public.sale_receipts r JOIN public.transactions t ON t.id = r.txn_id
  WHERE r.car_id = NEW.car_id;
  SELECT COALESCE(SUM(a.amount), 0) INTO v_adjusted
  FROM public.sale_adjustments a
  WHERE a.car_id = NEW.car_id AND a.id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid);

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
    OR (NEW.fund IS NOT NULL AND NEW.fund NOT IN ('business', 'manager', 'custody'))
    OR NEW.is_demo IS DISTINCT FROM OLD.is_demo) THEN
    RAISE EXCEPTION 'A linked sale receipt must remain a receipt for the same car and a valid fund'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.is_demo OR NEW.type <> 'receipt' OR (NEW.fund IS NOT NULL AND NEW.fund NOT IN ('business', 'manager', 'custody')) OR NEW.car_id IS NULL THEN
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
  WHERE car_id = NEW.car_id AND type = 'receipt' AND (fund IS NULL OR fund IN ('business', 'manager', 'custody')) AND NOT is_demo
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
  IF NEW.type = 'receipt' AND (NEW.fund IS NULL OR NEW.fund IN ('business', 'manager', 'custody')) AND NOT NEW.is_demo AND NEW.car_id IS NOT NULL
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
      AND (t.fund IS NULL OR t.fund IN ('business', 'manager', 'custody')) AND NOT t.is_demo
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
  WHERE car_id = NEW.id AND type = 'receipt' AND (fund IS NULL OR fund IN ('business', 'manager', 'custody')) AND NOT is_demo;
  SELECT COALESCE(SUM(amount), 0) INTO v_adjusted FROM public.sale_adjustments WHERE car_id = NEW.id;
  IF v_received + v_adjusted > NEW.sale_price THEN
    RAISE EXCEPTION 'Sale price cannot be lower than receipts and adjustments already recorded'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Refuse to classify historical payments if they would make any sale
-- over-collected; this check runs before the backfill in the same transaction.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cars c
    WHERE c.status = 'sold' AND c.sale_price IS NOT NULL
      AND COALESCE((
        SELECT SUM(t.amount) FROM public.transactions t
        WHERE t.car_id = c.id AND t.type = 'receipt'
          AND (t.fund IS NULL OR t.fund IN ('business', 'manager', 'custody'))
          AND NOT t.is_demo
      ), 0) + COALESCE((
        SELECT SUM(a.amount) FROM public.sale_adjustments a WHERE a.car_id = c.id
      ), 0) > c.sale_price
  ) THEN
    RAISE EXCEPTION 'Historical receipts and adjustments exceed at least one sale price; migration stopped without changes';
  END IF;
END;
$$;

-- Link existing custody receipts that were recorded against already-sold cars.
INSERT INTO public.sale_receipts (car_id, txn_id)
SELECT t.car_id, t.id
FROM public.transactions t
JOIN public.cars c ON c.id = t.car_id
WHERE t.type = 'receipt' AND (t.fund IS NULL OR t.fund IN ('business', 'manager', 'custody')) AND NOT t.is_demo AND c.status = 'sold'
ON CONFLICT (txn_id) DO NOTHING;

-- Deleting a transaction must also remove its linked sale-collection row so
-- the receivable and cash ledgers stay consistent.
ALTER TABLE public.sale_receipts DROP CONSTRAINT IF EXISTS sale_receipts_txn_id_fkey;
ALTER TABLE public.sale_receipts ADD CONSTRAINT sale_receipts_txn_id_fkey
  FOREIGN KEY (txn_id) REFERENCES public.transactions(id) ON DELETE CASCADE;

DROP POLICY IF EXISTS staff_sale_adjustments_manage ON public.sale_adjustments;
DROP POLICY IF EXISTS staff_sale_adjustments_create ON public.sale_adjustments;
DROP POLICY IF EXISTS staff_sale_adjustments_edit ON public.sale_adjustments;
DROP POLICY IF EXISTS staff_sale_adjustments_delete ON public.sale_adjustments;
CREATE POLICY staff_sale_adjustments_create ON public.sale_adjustments FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_perm(auth.uid(),'receivables','create') OR public.has_staff_perm(auth.uid(),'receivables','edit'));
CREATE POLICY staff_sale_adjustments_edit ON public.sale_adjustments FOR UPDATE TO authenticated
  USING (public.has_staff_perm(auth.uid(),'receivables','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'receivables','edit'));
CREATE POLICY staff_sale_adjustments_delete ON public.sale_adjustments FOR DELETE TO authenticated
  USING (public.has_staff_perm(auth.uid(),'receivables','delete'));

NOTIFY pgrst, 'reload schema';
COMMIT;
