-- Hirbod Khodro: decouple financial partner records from login accounts.
-- Additive/non-destructive: keeps partner rows, auth users, role rows, historical
-- investments, transactions, customer grants and optional existing user_id links.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'No admin account exists. Refusing to change signup and access behavior until an admin is present.';
  END IF;
END $$;

-- Stop matching a partner to an account by email. Existing explicit links remain
-- intact so their current owner can still see only their own permitted records.
DROP TRIGGER IF EXISTS partners_link_user ON public.partners;
DROP FUNCTION IF EXISTS public.link_partner_user();

-- New auth users get a profile only. The first-ever user on a fresh installation
-- remains the bootstrap admin; later accounts receive no implicit partner role.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email)
  ON CONFLICT (id) DO NOTHING;

  PERFORM pg_advisory_xact_lock(hashtext('hirbod-bootstrap-admin'));
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;

-- Remove broad visibility permissions from partner accounts. Narrow operational
-- permissions (e.g. assigned-customer access, settlement actions) are preserved.
UPDATE public.partner_permissions
SET can_view_all_cars = false,
    can_view_all_partners = false
WHERE can_view_all_cars IS DISTINCT FROM false
   OR can_view_all_partners IS DISTINCT FROM false;

-- RLS policies are permissive and are OR-combined. Remove both historic variants
-- and recreate one self-only read policy; admin-all policy remains untouched.
DROP POLICY IF EXISTS "partner reads self" ON public.partners;
DROP POLICY IF EXISTS "partner reads partners" ON public.partners;
CREATE POLICY "partner reads own linked financial record"
ON public.partners FOR SELECT TO authenticated
USING (user_id = auth.uid());

COMMENT ON COLUMN public.partners.user_id IS
  'Optional explicit account-to-partner link for a restricted personal view. Never auto-linked by email; partner records do not require login accounts.';

-- Confirm the original finance records and account links were not deleted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.partner_permissions
    WHERE can_view_all_cars OR can_view_all_partners
  ) THEN
    RAISE EXCEPTION 'Broad partner visibility permissions remain enabled';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
