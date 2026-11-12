BEGIN;

-- Only admins and active staff may use the application.
CREATE OR REPLACE FUNCTION public.is_staff_enabled(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() = _user_id OR public.has_role(auth.uid(), 'admin') THEN
      COALESCE(
        (SELECT sa.is_active
         FROM public.staff_access sa
         WHERE sa.user_id = _user_id),
        public.has_role(_user_id, 'admin')
      )
    ELSE false
  END;
$$;

-- Partner records never grant website permissions.
CREATE OR REPLACE FUNCTION public.has_partner_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT false;
$$;

CREATE OR REPLACE FUNCTION public.my_partner_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT NULL::uuid WHERE false;
$$;

-- Remove legacy access to a linked partner's own record.
DROP POLICY IF EXISTS "partner reads own linked financial record"
ON public.partners;

-- Deactivation requires delete permission; reactivation requires edit permission.

CREATE OR REPLACE FUNCTION public.guard_partner_active_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF auth.role() = 'service_role'
       OR public.has_role(auth.uid(), 'admin') THEN
      RETURN NEW;
    END IF;

    IF NEW.is_active = false
       AND public.has_staff_perm(auth.uid(), 'partners', 'delete') THEN
      RETURN NEW;
    END IF;

    IF NEW.is_active = true
       AND public.has_staff_perm(auth.uid(), 'partners', 'edit') THEN
      RETURN NEW;
    END IF;

    RAISE EXCEPTION 'Insufficient permission to change partner active status';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_partner_active_change ON public.partners;

CREATE TRIGGER guard_partner_active_change
BEFORE UPDATE OF is_active ON public.partners
FOR EACH ROW
EXECUTE FUNCTION public.guard_partner_active_change();

CREATE OR REPLACE FUNCTION public.set_partner_active(
  _partner_id uuid,
  _is_active boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.role() <> 'authenticated' THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;

  IF _is_active THEN
    IF NOT public.has_role(auth.uid(), 'admin')
       AND NOT public.has_staff_perm(auth.uid(), 'partners', 'edit') THEN
      RAISE EXCEPTION 'Partner edit permission required';
    END IF;
  ELSE
    IF NOT public.has_role(auth.uid(), 'admin')
       AND NOT public.has_staff_perm(auth.uid(), 'partners', 'delete') THEN
      RAISE EXCEPTION 'Partner delete permission required';
    END IF;
  END IF;

  UPDATE public.partners
  SET is_active = _is_active
  WHERE id = _partner_id
    AND is_owner = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner not found or protected';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_partner_active(uuid, boolean)
FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.set_partner_active(uuid, boolean)
TO authenticated, service_role;

COMMIT;
