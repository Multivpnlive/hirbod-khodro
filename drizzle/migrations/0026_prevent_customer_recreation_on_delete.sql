-- A customer deletion sets partners.customer_id to NULL. Do not let the
-- synchronization triggers immediately recreate the customer being deleted.
BEGIN;

CREATE OR REPLACE FUNCTION public.sync_partner_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.customer_id IS NOT NULL AND NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.customer_id IS NULL THEN
    INSERT INTO public.customers (name, phone, is_demo)
    VALUES (NEW.name, NEW.phone, NEW.is_demo)
    RETURNING id INTO NEW.customer_id;
  ELSE
    UPDATE public.customers c
    SET name = NEW.name, phone = NEW.phone, is_demo = NEW.is_demo
    WHERE c.id = NEW.customer_id
      AND (c.name IS DISTINCT FROM NEW.name
        OR c.phone IS DISTINCT FROM NEW.phone
        OR c.is_demo IS DISTINCT FROM NEW.is_demo);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_customer_partner_access()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  DELETE FROM public.customer_access ca
  WHERE ca.partner_id = NEW.id
    AND ca.customer_id IS DISTINCT FROM NEW.customer_id;

  IF NEW.customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.customer_access (customer_id, partner_id)
  VALUES (NEW.customer_id, NEW.id)
  ON CONFLICT (customer_id, partner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_partner_customer_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_customer_partner_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_partner_customer_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_customer_partner_access() TO authenticated, service_role;

COMMIT;
