-- Staff accounts must use staff_permissions only.
-- Partner financial records never grant website permissions to staff.

BEGIN;

CREATE OR REPLACE FUNCTION public.has_partner_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    NOT EXISTS (
      SELECT 1 FROM public.staff_access sa
      WHERE sa.user_id = _user_id
    )
    AND public.is_staff_enabled(_user_id)
    AND COALESCE((
      SELECT CASE _perm
        WHEN 'view_all_cars' THEN pp.can_view_all_cars
        WHEN 'create_car' THEN pp.can_create_car
        WHEN 'edit_car' THEN pp.can_edit_car
        WHEN 'add_expense' THEN pp.can_add_expense
        WHEN 'add_payment' THEN pp.can_add_payment
        WHEN 'manage_settlements' THEN pp.can_manage_settlements
        WHEN 'view_all_partners' THEN pp.can_view_all_partners
        WHEN 'view_customers' THEN pp.can_view_customers
        WHEN 'view_customer_finance' THEN pp.can_view_customer_finance
        WHEN 'manage_customers' THEN pp.can_manage_customers
        WHEN 'view_brokerage' THEN pp.can_view_brokerage
        WHEN 'view_hawala' THEN pp.can_view_hawala
        WHEN 'view_custody' THEN pp.can_view_custody
        ELSE false
      END
      FROM public.partner_permissions pp
      JOIN public.partners p ON p.id = pp.partner_id
      WHERE p.user_id = _user_id
    ), false);
$$;

CREATE OR REPLACE FUNCTION public.my_partner_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id
  FROM public.partners p
  WHERE p.user_id = auth.uid()
    AND public.is_staff_enabled(auth.uid())
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_access sa
      WHERE sa.user_id = auth.uid()
    );
$$;

COMMIT;
