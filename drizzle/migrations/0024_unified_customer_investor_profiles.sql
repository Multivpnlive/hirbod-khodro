-- Keep one customer-facing profile for each person while preserving all existing
-- partner IDs, investment rows, transaction links, and account permissions.
BEGIN;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS customer_id uuid
  REFERENCES public.customers(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS partners_customer_id_idx
  ON public.partners(customer_id);

-- Keep visibility anchored in database RLS. Admins and explicitly permitted
-- staff can work with customer profiles; financial partners only see profiles
-- linked to one of their own partner IDs.
CREATE OR REPLACE FUNCTION public.can_see_customer(_cid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.has_role(auth.uid(), 'admin')
    OR public.has_staff_perm(auth.uid(), 'customers', 'view')
    OR EXISTS (
      SELECT 1 FROM public.customer_access ca
      WHERE ca.customer_id = _cid
        AND ca.partner_id IN (SELECT public.my_partner_ids())
    )
$$;
REVOKE ALL ON FUNCTION public.can_see_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_customer(uuid) TO authenticated;

-- Match only on both normalized full name and a non-empty phone number. If a
-- reliable match does not exist, create a profile instead of merging by name alone.
DO $$
DECLARE
  p record;
  v_customer_id uuid;
  v_partner_phone text;
BEGIN
  FOR p IN
    SELECT id, name, phone, is_demo
    FROM public.partners
    WHERE customer_id IS NULL
    ORDER BY created_at, id
  LOOP
    v_partner_phone := regexp_replace(
      translate(COALESCE(p.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
      '[^0-9]', '', 'g'
    );
    v_customer_id := NULL;

    IF v_partner_phone <> '' THEN
      SELECT c.id INTO v_customer_id
      FROM public.customers c
      WHERE c.is_demo = p.is_demo
        AND lower(regexp_replace(trim(c.name), '[[:space:]]+', ' ', 'g')) =
            lower(regexp_replace(trim(p.name), '[[:space:]]+', ' ', 'g'))
        AND regexp_replace(
          translate(COALESCE(c.phone, ''), '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'),
          '[^0-9]', '', 'g'
        ) = v_partner_phone
      ORDER BY c.created_at, c.id
      LIMIT 1;
    END IF;

    IF v_customer_id IS NULL THEN
      INSERT INTO public.customers (name, phone, is_demo)
      VALUES (p.name, p.phone, p.is_demo)
      RETURNING id INTO v_customer_id;
    END IF;

    UPDATE public.partners SET customer_id = v_customer_id WHERE id = p.id;
  END LOOP;
END;
$$;

INSERT INTO public.customer_access (customer_id, partner_id)
SELECT p.customer_id, p.id
FROM public.partners p
WHERE p.customer_id IS NOT NULL
ON CONFLICT (customer_id, partner_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.sync_partner_customer_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

CREATE OR REPLACE FUNCTION public.sync_customer_profile_to_partners()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.partners p
  SET name = NEW.name, phone = NEW.phone, is_demo = NEW.is_demo
  WHERE p.customer_id = NEW.id
    AND (p.name IS DISTINCT FROM NEW.name
      OR p.phone IS DISTINCT FROM NEW.phone
      OR p.is_demo IS DISTINCT FROM NEW.is_demo);
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

  INSERT INTO public.customer_access (customer_id, partner_id)
  VALUES (NEW.customer_id, NEW.id)
  ON CONFLICT (customer_id, partner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_partner_customer_profile ON public.partners;
CREATE TRIGGER trg_sync_partner_customer_profile
BEFORE INSERT OR UPDATE OF name, phone, is_demo, customer_id
ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.sync_partner_customer_profile();

DROP TRIGGER IF EXISTS trg_sync_customer_profile_to_partners ON public.customers;
CREATE TRIGGER trg_sync_customer_profile_to_partners
AFTER UPDATE OF name, phone, is_demo
ON public.customers
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_profile_to_partners();

DROP TRIGGER IF EXISTS trg_sync_customer_partner_access ON public.partners;
CREATE TRIGGER trg_sync_customer_partner_access
AFTER INSERT OR UPDATE OF customer_id
ON public.partners
FOR EACH ROW EXECUTE FUNCTION public.sync_customer_partner_access();

REVOKE ALL ON FUNCTION public.sync_partner_customer_profile() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_customer_profile_to_partners() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sync_customer_partner_access() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_partner_customer_profile() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_customer_profile_to_partners() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_customer_partner_access() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
