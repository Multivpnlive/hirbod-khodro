-- 0006: customer custody and transfers. Additive, compatible with deployed 0004/0005.
BEGIN;

ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS national_id text;
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE public.partners ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT false;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS purpose text;

CREATE TABLE IF NOT EXISTS public.fund_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  amount numeric(16,0) NOT NULL CHECK (amount > 0),
  target text NOT NULL DEFAULT 'business' CHECK (target IN ('business', 'business_commission', 'hawala_purchase', 'business_expense', 'other')),
  transfer_date date NOT NULL DEFAULT current_date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fund_transfers ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fund_transfers TO authenticated;
GRANT ALL ON public.fund_transfers TO service_role;
DROP POLICY IF EXISTS "admin all fund transfers" ON public.fund_transfers;
CREATE POLICY "admin all fund transfers" ON public.fund_transfers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- A transfer reclassifies customer custody as business funds; it is not another physical receipt.
CREATE OR REPLACE FUNCTION public.guard_customer_custody_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_customer uuid;
  v_balance numeric := 0;
  v_other_customer uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.fund <> 'custody' OR OLD.is_demo THEN RETURN OLD; END IF;
    v_customer := OLD.customer_id;
    IF v_customer IS NULL THEN RAISE EXCEPTION 'Custody transactions require a customer'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_customer::text, 0));
    SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.transactions
      WHERE fund = 'custody' AND customer_id = v_customer AND NOT is_demo AND id <> OLD.id;
    SELECT v_balance - COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.fund_transfers WHERE customer_id = v_customer AND NOT is_demo;
    IF v_balance < 0 THEN RAISE EXCEPTION 'Cannot delete this transaction: customer custody would become negative'; END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.fund = 'custody' AND NOT OLD.is_demo
     AND (NEW.fund IS DISTINCT FROM OLD.fund OR NEW.customer_id IS DISTINCT FROM OLD.customer_id) THEN
    v_other_customer := OLD.customer_id;
    IF v_other_customer IS NULL THEN RAISE EXCEPTION 'Custody transactions require a customer'; END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(v_other_customer::text, 0));
    SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE -amount END), 0)
      INTO v_balance FROM public.transactions
      WHERE fund = 'custody' AND customer_id = v_other_customer AND NOT is_demo AND id <> OLD.id;
    SELECT v_balance - COALESCE(SUM(amount), 0) INTO v_balance
      FROM public.fund_transfers WHERE customer_id = v_other_customer AND NOT is_demo;
    IF v_balance < 0 THEN RAISE EXCEPTION 'This update would make customer custody negative'; END IF;
  END IF;

  IF NEW.fund <> 'custody' OR NEW.is_demo THEN RETURN NEW; END IF;
  IF NEW.customer_id IS NULL THEN RAISE EXCEPTION 'Custody transactions require a customer'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.customer_id::text, 0));
  SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.transactions
    WHERE fund = 'custody' AND customer_id = NEW.customer_id AND NOT is_demo AND id <> NEW.id;
  SELECT v_balance - COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.fund_transfers WHERE customer_id = NEW.customer_id AND NOT is_demo;
  v_balance := v_balance + CASE WHEN NEW.type = 'receipt' THEN NEW.amount ELSE -NEW.amount END;
  IF v_balance < 0 THEN RAISE EXCEPTION 'Customer custody cannot become negative'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_customer_custody_transaction ON public.transactions;
CREATE TRIGGER trg_customer_custody_transaction
BEFORE INSERT OR UPDATE OF amount, type, fund, customer_id, is_demo OR DELETE
ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_customer_custody_transaction();

CREATE OR REPLACE FUNCTION public.guard_customer_fund_transfer()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_balance numeric := 0; v_cid uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_cid := OLD.customer_id;
  ELSE
    v_cid := NEW.customer_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_cid::text, 0));
  SELECT COALESCE(SUM(CASE WHEN t.type = 'receipt' THEN t.amount ELSE -t.amount END), 0)
    INTO v_balance FROM public.transactions t
    WHERE t.fund = 'custody' AND t.customer_id = v_cid AND NOT t.is_demo
      AND (TG_OP = 'DELETE' OR t.id <> NEW.id);
  SELECT v_balance - COALESCE(SUM(ft.amount), 0) INTO v_balance
    FROM public.fund_transfers ft
    WHERE ft.customer_id = v_cid AND NOT ft.is_demo
      AND (TG_OP = 'DELETE' OR ft.id <> NEW.id);
  IF TG_OP <> 'DELETE' AND NOT NEW.is_demo THEN
    v_balance := v_balance - NEW.amount;
  END IF;
  IF v_balance < 0 THEN RAISE EXCEPTION 'Transfer exceeds the customer''s available custody balance'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_customer_fund_transfer ON public.fund_transfers;
CREATE TRIGGER trg_guard_customer_fund_transfer
BEFORE INSERT OR UPDATE OF amount, customer_id, is_demo OR DELETE
ON public.fund_transfers FOR EACH ROW EXECUTE FUNCTION public.guard_customer_fund_transfer();

-- Deleting/reducing a reclassification must not make business cash negative.
CREATE OR REPLACE FUNCTION public.guard_business_cash_after_transfer_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_balance numeric := 0;
  v_transfer_sum numeric := 0;
  v_old_id uuid := NULL;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_id := OLD.id; END IF;
  PERFORM pg_advisory_xact_lock(73190421);
  SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.transactions WHERE fund = 'business' AND NOT is_demo;
  SELECT COALESCE(SUM(amount), 0) INTO v_transfer_sum
    FROM public.fund_transfers WHERE NOT is_demo AND id IS DISTINCT FROM v_old_id;
  IF TG_OP <> 'DELETE' AND NOT NEW.is_demo THEN v_transfer_sum := v_transfer_sum + NEW.amount; END IF;
  IF v_balance + v_transfer_sum < 0 THEN
    RAISE EXCEPTION 'Cannot remove this custody transfer: business cash would become negative'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_business_cash_after_transfer_change ON public.fund_transfers;
CREATE TRIGGER trg_guard_business_cash_after_transfer_change
BEFORE INSERT OR UPDATE OF amount, customer_id, target, is_demo OR DELETE
ON public.fund_transfers FOR EACH ROW EXECUTE FUNCTION public.guard_business_cash_after_transfer_change();

-- Preserve the existing cash rule, but include custody reclassifications as business-available funds.
CREATE OR REPLACE FUNCTION public.enforce_business_cash_nonnegative()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_balance numeric;
  v_transaction_id uuid;
  v_fund text;
  v_type public.txn_type;
  v_is_demo boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_transaction_id := OLD.id; v_fund := OLD.fund; v_is_demo := OLD.is_demo;
  ELSE
    v_transaction_id := NEW.id; v_fund := NEW.fund; v_type := NEW.type; v_is_demo := NEW.is_demo;
  END IF;

  IF (v_fund = 'business' AND NOT v_is_demo)
     OR (TG_OP = 'UPDATE' AND OLD.fund = 'business' AND NOT OLD.is_demo) THEN
    PERFORM pg_advisory_xact_lock(73190421);
  ELSE
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  SELECT COALESCE(SUM(CASE WHEN type = 'receipt' THEN amount ELSE -amount END), 0)
    INTO v_balance FROM public.transactions
    WHERE fund = 'business' AND NOT is_demo AND id <> v_transaction_id;

  IF TG_OP <> 'DELETE' AND v_fund = 'business' AND NOT v_is_demo THEN
    v_balance := v_balance + CASE WHEN v_type = 'receipt' THEN NEW.amount ELSE -NEW.amount END;
  END IF;

  SELECT v_balance + COALESCE(SUM(amount), 0) INTO v_balance
    FROM public.fund_transfers WHERE NOT is_demo AND target <> 'refund';
  IF v_balance < 0 THEN
    RAISE EXCEPTION 'Business cash cannot become negative' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_customer_custody_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_customer_fund_transfer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_business_cash_after_transfer_change() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
