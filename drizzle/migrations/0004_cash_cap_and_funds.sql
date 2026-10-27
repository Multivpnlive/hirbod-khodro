-- Additive migration. Do not run against production until reviewed.
-- All business settlements share one cash pool.

-- Pin existing SECURITY DEFINER helpers so temporary objects cannot shadow public tables.
ALTER FUNCTION public.has_role(uuid, public.app_role) SET search_path = public, pg_temp;
ALTER FUNCTION public.my_partner_ids() SET search_path = public, pg_temp;
ALTER FUNCTION public.my_car_shares() SET search_path = public, pg_temp;
ALTER FUNCTION public.handle_new_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.link_partner_user() SET search_path = public, pg_temp;
ALTER FUNCTION public.has_partner_perm(uuid, text) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.has_partner_perm(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_partner_perm(uuid, text) TO authenticated;

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS fund text NOT NULL DEFAULT 'business';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'transactions_fund_check'
      AND conrelid = 'public.transactions'::regclass
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_fund_check
      CHECK (fund IN ('business', 'manager', 'custody'));
  END IF;
END $$;

-- Only admins can assign non-business funds.
CREATE OR REPLACE FUNCTION public.guard_transaction_fund()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.fund IS DISTINCT FROM 'business'
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins may use manager or custody funds'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.type = 'settlement' AND NEW.fund <> 'business' THEN
    RAISE EXCEPTION 'Partner settlements must use the business fund'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_transaction_fund
  ON public.transactions;

CREATE TRIGGER trg_guard_transaction_fund
BEFORE INSERT OR UPDATE OF fund, type
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.guard_transaction_fund();

-- Keep business cash non-negative after each business transaction.
-- Serialize all business-fund changes through one shared advisory lock.
CREATE OR REPLACE FUNCTION public.enforce_business_cash_nonnegative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_balance numeric;
  v_transaction_id uuid;
  v_fund text;
  v_type public.txn_type;
  v_is_demo boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_transaction_id := OLD.id;
    v_fund := OLD.fund;
    v_is_demo := OLD.is_demo;
  ELSE
    v_transaction_id := NEW.id;
    v_fund := NEW.fund;
    v_type := NEW.type;
    v_is_demo := NEW.is_demo;
  END IF;

  IF (v_fund = 'business' AND NOT v_is_demo)
     OR (TG_OP = 'UPDATE' AND OLD.fund = 'business' AND NOT OLD.is_demo) THEN
    PERFORM pg_advisory_xact_lock(73190421);
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(
    CASE WHEN type = 'receipt' THEN amount ELSE -amount END
  ), 0)
  INTO v_balance
  FROM public.transactions
  WHERE fund = 'business'
    AND NOT is_demo
    AND id <> v_transaction_id;

  IF TG_OP <> 'DELETE' AND v_fund = 'business' AND NOT v_is_demo THEN
    v_balance := v_balance +
      CASE WHEN v_type = 'receipt' THEN NEW.amount ELSE -NEW.amount END;
  END IF;

  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Business cash cannot become negative'
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_cash_nonnegative
  ON public.transactions;

CREATE TRIGGER trg_business_cash_nonnegative
BEFORE INSERT OR UPDATE OF amount, type, fund, is_demo OR DELETE
ON public.transactions
FOR EACH ROW
EXECUTE FUNCTION public.enforce_business_cash_nonnegative();

REVOKE ALL ON FUNCTION public.guard_transaction_fund() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_business_cash_nonnegative() FROM PUBLIC, anon, authenticated;