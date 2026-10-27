-- 0008: extend existing brokerage tables from 0005; no duplicate brokerage ledger.
BEGIN;

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS brokerage_deal_id uuid;
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS hawala_id uuid REFERENCES public.hawalas(id) ON DELETE SET NULL;
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS agreed_commission numeric(16,0) NOT NULL DEFAULT 0 CHECK (agreed_commission >= 0);
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS deal_date date NOT NULL DEFAULT current_date;
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled'));
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.brokerage_deals ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
UPDATE public.brokerage_deals SET agreed_commission = COALESCE(commission, 0) WHERE agreed_commission = 0 AND COALESCE(commission, 0) <> 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_brokerage_deal_id_fkey' AND conrelid = 'public.transactions'::regclass) THEN
    ALTER TABLE public.transactions ADD CONSTRAINT transactions_brokerage_deal_id_fkey
      FOREIGN KEY (brokerage_deal_id) REFERENCES public.brokerage_deals(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.brokerage_costs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.brokerage_deals(id) ON DELETE CASCADE,
  amount numeric(16,0) NOT NULL CHECK (amount > 0),
  bearer text NOT NULL CHECK (bearer IN ('business', 'customer')),
  cost_date date NOT NULL DEFAULT current_date,
  description text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.brokerage_costs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.brokerage_costs TO authenticated;
GRANT ALL ON public.brokerage_costs TO service_role;
DROP POLICY IF EXISTS "admin all brokerage costs" ON public.brokerage_costs;
CREATE POLICY "admin all brokerage costs" ON public.brokerage_costs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.sync_brokerage_commission_columns()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.agreed_commission = 0 AND COALESCE(NEW.commission, 0) <> 0 THEN
      NEW.agreed_commission := NEW.commission;
    ELSE
      NEW.commission := NEW.agreed_commission;
    END IF;
  ELSIF NEW.agreed_commission IS DISTINCT FROM OLD.agreed_commission THEN
    NEW.commission := NEW.agreed_commission;
  ELSIF NEW.commission IS DISTINCT FROM OLD.commission THEN
    NEW.agreed_commission := NEW.commission;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_brokerage_commission_columns ON public.brokerage_deals;
CREATE TRIGGER trg_sync_brokerage_commission_columns BEFORE INSERT OR UPDATE OF commission, agreed_commission
ON public.brokerage_deals FOR EACH ROW EXECUTE FUNCTION public.sync_brokerage_commission_columns();

CREATE OR REPLACE FUNCTION public.guard_commission_splits_before_first_receipt()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_deal uuid;
BEGIN
  v_deal := CASE WHEN TG_OP = 'DELETE' THEN OLD.deal_id ELSE NEW.deal_id END;
  IF EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.brokerage_deal_id = v_deal AND t.purpose = 'brokerage_commission'
      AND t.type = 'receipt' AND NOT t.is_demo
  ) THEN
    RAISE EXCEPTION 'Commission splits are locked after the first real commission receipt';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_commission_splits_before_first_receipt ON public.commission_splits;
CREATE TRIGGER trg_guard_commission_splits_before_first_receipt
BEFORE INSERT OR UPDATE OR DELETE ON public.commission_splits
FOR EACH ROW EXECUTE FUNCTION public.guard_commission_splits_before_first_receipt();

REVOKE ALL ON FUNCTION public.guard_commission_splits_before_first_receipt() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
