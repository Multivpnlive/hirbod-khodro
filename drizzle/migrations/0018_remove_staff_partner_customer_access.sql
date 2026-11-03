BEGIN;

-- Financial partners must never receive customer access.
-- Staff permissions control customer visibility directly on public.customers.
-- Preserve all existing customer_access records and admin policies.

DROP POLICY IF EXISTS staff_customers_view
ON public.customer_access;

DROP POLICY IF EXISTS staff_customer_access_manage
ON public.customer_access;

NOTIFY pgrst, 'reload schema';

COMMIT;
