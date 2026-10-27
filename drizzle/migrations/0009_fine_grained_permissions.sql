-- 0009: fine-grained partner permissions for customer, hawala, brokerage and custody areas.
BEGIN;

ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_view_customers boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_view_customer_finance boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_manage_customers boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_view_brokerage boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_view_hawala boolean NOT NULL DEFAULT false;
ALTER TABLE public.partner_permissions ADD COLUMN IF NOT EXISTS can_view_custody boolean NOT NULL DEFAULT false;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_permissions TO authenticated;

CREATE OR REPLACE FUNCTION public.has_partner_perm(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((
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
      ELSE false END
    FROM public.partner_permissions pp
    JOIN public.partners p ON p.id = pp.partner_id
    WHERE p.user_id = _user_id
  ), false)
$$;
REVOKE ALL ON FUNCTION public.has_partner_perm(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_partner_perm(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.can_see_customer(_cid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR (
    public.has_partner_perm(auth.uid(), 'view_customers') AND EXISTS (
      SELECT 1 FROM public.customer_access ca
      WHERE ca.customer_id = _cid AND ca.partner_id IN (SELECT public.my_partner_ids())
    )
  )
$$;
REVOKE ALL ON FUNCTION public.can_see_customer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_customer(uuid) TO authenticated;

DROP POLICY IF EXISTS "customers visible" ON public.customers;
CREATE POLICY "customers visible" ON public.customers FOR SELECT TO authenticated USING (public.can_see_customer(id));
DROP POLICY IF EXISTS "admin writes customers" ON public.customers;
CREATE POLICY "admin writes customers" ON public.customers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "partner reads permitted deals" ON public.brokerage_deals;
DROP POLICY IF EXISTS "partner sees permitted deals" ON public.brokerage_deals;
CREATE POLICY "partner sees permitted deals" ON public.brokerage_deals FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_brokerage') AND customer_id IS NOT NULL AND public.can_see_customer(customer_id));
DROP POLICY IF EXISTS "partner reads own splits" ON public.commission_splits;
DROP POLICY IF EXISTS "permitted partners read own-deal commission splits" ON public.commission_splits;
CREATE POLICY "permitted partners read own-deal commission splits" ON public.commission_splits FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_brokerage') AND partner_id IN (SELECT public.my_partner_ids())
    AND EXISTS (SELECT 1 FROM public.brokerage_deals bd WHERE bd.id = commission_splits.deal_id
      AND bd.customer_id IS NOT NULL AND public.can_see_customer(bd.customer_id)));

DROP POLICY IF EXISTS "permitted partners read hawalas" ON public.hawalas;
CREATE POLICY "permitted partners read hawalas" ON public.hawalas FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_hawala') AND (
    (customer_id IS NOT NULL AND public.can_see_customer(customer_id)) OR EXISTS (
      SELECT 1 FROM public.hawala_investments hi WHERE hi.hawala_id = hawalas.id AND hi.partner_id IN (SELECT public.my_partner_ids())
    )
  ));
DROP POLICY IF EXISTS "permitted partners read hawala investments" ON public.hawala_investments;
CREATE POLICY "permitted partners read hawala investments" ON public.hawala_investments FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_hawala') AND partner_id IN (SELECT public.my_partner_ids()));
DROP POLICY IF EXISTS "permitted partners read hawala sales" ON public.hawala_sales;
CREATE POLICY "permitted partners read hawala sales" ON public.hawala_sales FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_hawala') AND EXISTS (
    SELECT 1 FROM public.hawalas h WHERE h.id = hawala_sales.hawala_id AND (
      (h.customer_id IS NOT NULL AND public.can_see_customer(h.customer_id))
      OR EXISTS (SELECT 1 FROM public.hawala_investments hi
        WHERE hi.hawala_id = h.id AND hi.partner_id IN (SELECT public.my_partner_ids()))
    )
  ));
DROP POLICY IF EXISTS "permitted partners read brokerage costs" ON public.brokerage_costs;
CREATE POLICY "permitted partners read brokerage costs" ON public.brokerage_costs FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_brokerage') AND EXISTS (
    SELECT 1 FROM public.brokerage_deals bd WHERE bd.id = brokerage_costs.deal_id
      AND bd.customer_id IS NOT NULL AND public.can_see_customer(bd.customer_id)
  ));
DROP POLICY IF EXISTS "permitted partners read fund transfers" ON public.fund_transfers;
CREATE POLICY "permitted partners read fund transfers" ON public.fund_transfers FOR SELECT TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'view_custody') AND public.can_see_customer(customer_id));

DROP POLICY IF EXISTS "permitted partners read custody transactions" ON public.transactions;
CREATE POLICY "permitted partners read custody transactions" ON public.transactions FOR SELECT TO authenticated
  USING (fund = 'custody' AND customer_id IS NOT NULL AND public.has_partner_perm(auth.uid(), 'view_custody')
    AND public.can_see_customer(customer_id));

NOTIFY pgrst, 'reload schema';
COMMIT;
