BEGIN;

CREATE OR REPLACE FUNCTION public.has_staff_perm(_user_id uuid, _resource text, _action text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT CASE
    WHEN auth.role() = 'service_role' THEN true
    WHEN auth.uid() IS DISTINCT FROM _user_id AND NOT public.has_role(auth.uid(), 'admin') THEN false
    WHEN public.has_role(_user_id, 'admin') THEN true
    ELSE COALESCE((
      SELECT sa.is_active AND CASE _action
        WHEN 'view' THEN sp.can_view
        WHEN 'create' THEN sp.can_create
        WHEN 'edit' THEN sp.can_edit
        WHEN 'delete' THEN sp.can_delete
        ELSE false
      END
      FROM public.staff_access sa
      JOIN public.staff_permissions sp ON sp.user_id = sa.user_id
      WHERE sa.user_id = _user_id AND sp.resource = _resource
    ), false)
  END;
$function$;

COMMIT;
