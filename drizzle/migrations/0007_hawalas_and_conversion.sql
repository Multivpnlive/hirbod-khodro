-- 0007: three-mode hawala lifecycle and one-time conversion to a car.
BEGIN;

CREATE TABLE IF NOT EXISTS public.hawalas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode text NOT NULL CHECK (mode IN ('own_hold', 'own_trade', 'client_brokerage')),
  face_amount numeric(16,0) NOT NULL DEFAULT 0 CHECK (face_amount >= 0),
  cost_basis numeric(16,0) NOT NULL DEFAULT 0 CHECK (cost_basis >= 0),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'converted', 'sold', 'cancelled')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE RESTRICT,
  hawala_date date NOT NULL DEFAULT current_date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.hawala_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hawala_id uuid NOT NULL REFERENCES public.hawalas(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE RESTRICT,
  amount numeric(16,0) NOT NULL CHECK (amount >= 0),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hawala_id, partner_id)
);

CREATE TABLE IF NOT EXISTS public.hawala_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hawala_id uuid NOT NULL UNIQUE REFERENCES public.hawalas(id) ON DELETE RESTRICT,
  sale_amount numeric(16,0) NOT NULL CHECK (sale_amount >= 0),
  sale_date date NOT NULL DEFAULT current_date,
  buyer_customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS hawala_id uuid REFERENCES public.hawalas(id) ON DELETE SET NULL;
ALTER TABLE public.cars ADD COLUMN IF NOT EXISTS source_hawala_id uuid REFERENCES public.hawalas(id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX IF NOT EXISTS cars_source_hawala_id_unique ON public.cars(source_hawala_id) WHERE source_hawala_id IS NOT NULL;

ALTER TABLE public.hawalas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hawala_investments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hawala_sales ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.hawalas, public.hawala_investments, public.hawala_sales TO authenticated;
GRANT ALL ON public.hawalas, public.hawala_investments, public.hawala_sales TO service_role;
DROP POLICY IF EXISTS "admin all hawalas" ON public.hawalas;
CREATE POLICY "admin all hawalas" ON public.hawalas FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "admin all hawala investments" ON public.hawala_investments;
CREATE POLICY "admin all hawala investments" ON public.hawala_investments FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "admin all hawala sales" ON public.hawala_sales;
CREATE POLICY "admin all hawala sales" ON public.hawala_sales FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.guard_hawala_transaction()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mode text; v_status text; v_customer uuid; v_sale numeric; v_received numeric;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.hawala_id IS NULL THEN RETURN OLD; END IF;
    IF OLD.purpose = 'hawala_purchase' THEN
      RAISE EXCEPTION 'Hawala purchase transactions cannot be deleted; use a compensating transaction';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.hawala_id IS NULL THEN RETURN NEW; END IF;

  SELECT mode, status, customer_id INTO v_mode, v_status, v_customer
  FROM public.hawalas WHERE id = NEW.hawala_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Hawala not found'; END IF;

  IF NEW.purpose = 'hawala_purchase' THEN
    IF NEW.type <> 'payment' THEN RAISE EXCEPTION 'Hawala purchase must be a payment'; END IF;
    IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.hawala_id = NEW.hawala_id AND t.purpose = 'hawala_purchase' AND t.id <> NEW.id) THEN
      RAISE EXCEPTION 'Hawala purchase has already been recorded';
    END IF;
    IF v_mode = 'client_brokerage' THEN
      IF NEW.fund <> 'custody' OR NEW.customer_id IS DISTINCT FROM v_customer THEN
        RAISE EXCEPTION 'Customer brokerage hawala purchase must use that customer''s custody fund';
      END IF;
    ELSE
      IF NEW.fund <> 'business' THEN RAISE EXCEPTION 'Business hawala purchase must use business fund'; END IF;
    END IF;
  ELSIF NEW.purpose = 'hawala_sale' THEN
    IF NEW.type <> 'receipt' OR NEW.fund <> 'business' OR v_mode <> 'own_trade' OR v_status <> 'sold' THEN
      RAISE EXCEPTION 'Hawala sale receipts require a sold own-trade hawala and business-fund receipt';
    END IF;
    SELECT sale_amount INTO v_sale FROM public.hawala_sales WHERE hawala_id = NEW.hawala_id;
    SELECT COALESCE(SUM(amount), 0) INTO v_received FROM public.transactions
      WHERE hawala_id = NEW.hawala_id AND purpose = 'hawala_sale' AND type = 'receipt' AND NOT is_demo AND id <> NEW.id;
    IF v_received + NEW.amount > COALESCE(v_sale, 0) THEN RAISE EXCEPTION 'Hawala receipts exceed sale agreement'; END IF;
  ELSIF NEW.purpose = 'hawala_conversion_extra' THEN
    IF NEW.type <> 'payment' OR NEW.fund <> 'business' OR v_mode <> 'own_hold' OR v_status <> 'held' THEN
      RAISE EXCEPTION 'Conversion top-up must be a business payment for a held own-hold hawala';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_hawala_transaction ON public.transactions;
CREATE TRIGGER trg_guard_hawala_transaction
BEFORE INSERT OR UPDATE OF type, amount, fund, customer_id, hawala_id, purpose, is_demo OR DELETE
ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.guard_hawala_transaction();

CREATE OR REPLACE FUNCTION public.sync_hawala_cost_basis()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  v_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.hawala_id ELSE NEW.hawala_id END;
  IF v_id IS NULL THEN IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END IF;
  UPDATE public.hawalas h SET cost_basis = COALESCE((
    SELECT SUM(t.amount) FROM public.transactions t
    WHERE t.hawala_id = v_id AND t.purpose = 'hawala_purchase' AND t.type = 'payment' AND NOT t.is_demo
  ), 0) WHERE h.id = v_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
DROP TRIGGER IF EXISTS trg_sync_hawala_cost_basis ON public.transactions;
CREATE TRIGGER trg_sync_hawala_cost_basis
AFTER INSERT OR UPDATE OF amount, type, is_demo, hawala_id, purpose OR DELETE
ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.sync_hawala_cost_basis();

CREATE OR REPLACE FUNCTION public.guard_hawala_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mode text; v_status text;
BEGIN
  SELECT mode, status INTO v_mode, v_status FROM public.hawalas WHERE id = NEW.hawala_id FOR UPDATE;
  IF NOT FOUND OR v_mode <> 'own_trade' OR v_status <> 'held' THEN
    RAISE EXCEPTION 'Only a held own-trade hawala can be sold';
  END IF;
  UPDATE public.hawalas SET status = 'sold' WHERE id = NEW.hawala_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_hawala_sale ON public.hawala_sales;
CREATE TRIGGER trg_guard_hawala_sale BEFORE INSERT ON public.hawala_sales
FOR EACH ROW EXECUTE FUNCTION public.guard_hawala_sale();

CREATE OR REPLACE FUNCTION public.guard_hawala_conversion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_mode text; v_status text; v_cost numeric; v_demo boolean; v_extra numeric;
BEGIN
  IF NEW.source_hawala_id IS NULL THEN RETURN NEW; END IF;
  SELECT mode, status, cost_basis, is_demo INTO v_mode, v_status, v_cost, v_demo
  FROM public.hawalas WHERE id = NEW.source_hawala_id FOR UPDATE;
  IF NOT FOUND OR v_mode <> 'own_hold' OR v_status <> 'held' THEN
    RAISE EXCEPTION 'Only a held own-hold hawala can be converted to a car';
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_extra FROM public.transactions
  WHERE hawala_id = NEW.source_hawala_id AND purpose = 'hawala_conversion_extra' AND type = 'payment' AND NOT is_demo;
  IF NEW.purchase_price <> v_cost + v_extra THEN
    RAISE EXCEPTION 'Car purchase price must equal hawala cost basis plus real conversion top-up';
  END IF;
  NEW.is_demo := v_demo;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_hawala_conversion ON public.cars;
CREATE TRIGGER trg_guard_hawala_conversion BEFORE INSERT OR UPDATE OF source_hawala_id, purchase_price
ON public.cars FOR EACH ROW EXECUTE FUNCTION public.guard_hawala_conversion();

CREATE OR REPLACE FUNCTION public.complete_hawala_conversion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.source_hawala_id IS NULL THEN RETURN NEW; END IF;
  UPDATE public.hawalas SET status = 'converted' WHERE id = NEW.source_hawala_id AND status = 'held';
  INSERT INTO public.car_investments (car_id, partner_id, amount, is_demo)
    SELECT NEW.id, hi.partner_id, hi.amount, hi.is_demo
    FROM public.hawala_investments hi WHERE hi.hawala_id = NEW.source_hawala_id
    ON CONFLICT (car_id, partner_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_complete_hawala_conversion ON public.cars;
CREATE TRIGGER trg_complete_hawala_conversion AFTER INSERT ON public.cars
FOR EACH ROW WHEN (NEW.source_hawala_id IS NOT NULL) EXECUTE FUNCTION public.complete_hawala_conversion();

REVOKE ALL ON FUNCTION public.guard_hawala_transaction() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_hawala_cost_basis() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_hawala_sale() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_hawala_conversion() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_hawala_conversion() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
