CREATE TABLE public.partner_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL UNIQUE REFERENCES public.partners(id) ON DELETE CASCADE,
  can_view_all_cars boolean NOT NULL DEFAULT false,
  can_create_car boolean NOT NULL DEFAULT false,
  can_edit_car boolean NOT NULL DEFAULT false,
  can_add_expense boolean NOT NULL DEFAULT false,
  can_add_payment boolean NOT NULL DEFAULT false,
  can_manage_settlements boolean NOT NULL DEFAULT false,
  can_view_all_partners boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.partner_permissions TO authenticated;
GRANT ALL ON public.partner_permissions TO service_role;
ALTER TABLE public.partner_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin all partner_permissions" ON public.partner_permissions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads own permissions" ON public.partner_permissions FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_partner_ids()));

CREATE OR REPLACE FUNCTION public.has_partner_perm(_user_id uuid, _perm text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE _perm
      WHEN 'view_all_cars' THEN pp.can_view_all_cars
      WHEN 'create_car' THEN pp.can_create_car
      WHEN 'edit_car' THEN pp.can_edit_car
      WHEN 'add_expense' THEN pp.can_add_expense
      WHEN 'add_payment' THEN pp.can_add_payment
      WHEN 'manage_settlements' THEN pp.can_manage_settlements
      WHEN 'view_all_partners' THEN pp.can_view_all_partners
      ELSE false END
    FROM public.partner_permissions pp
    JOIN public.partners p ON p.id = pp.partner_id
    WHERE p.user_id = _user_id
  ), false)
$$;
GRANT EXECUTE ON FUNCTION public.has_partner_perm(uuid, text) TO authenticated;

-- cars
DROP POLICY "partner reads invested cars" ON public.cars;
CREATE POLICY "partner reads cars" ON public.cars FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.car_investments ci WHERE ci.car_id = cars.id AND ci.partner_id IN (SELECT public.my_partner_ids()))
    OR public.has_partner_perm(auth.uid(), 'view_all_cars'));
CREATE POLICY "partner inserts cars" ON public.cars FOR INSERT TO authenticated
  WITH CHECK (public.has_partner_perm(auth.uid(), 'create_car'));
CREATE POLICY "partner updates cars" ON public.cars FOR UPDATE TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'edit_car')) WITH CHECK (public.has_partner_perm(auth.uid(), 'edit_car'));

-- car_expenses
DROP POLICY "partner reads invested car expenses" ON public.car_expenses;
CREATE POLICY "partner reads car expenses" ON public.car_expenses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.car_investments ci WHERE ci.car_id = car_expenses.car_id AND ci.partner_id IN (SELECT public.my_partner_ids()))
    OR public.has_partner_perm(auth.uid(), 'view_all_cars'));
CREATE POLICY "partner inserts car expenses" ON public.car_expenses FOR INSERT TO authenticated
  WITH CHECK (public.has_partner_perm(auth.uid(), 'add_expense'));
CREATE POLICY "partner updates car expenses" ON public.car_expenses FOR UPDATE TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'add_expense')) WITH CHECK (public.has_partner_perm(auth.uid(), 'add_expense'));

-- car_investments
DROP POLICY "partner reads own investments" ON public.car_investments;
CREATE POLICY "partner reads investments" ON public.car_investments FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_partner_ids()) OR public.has_partner_perm(auth.uid(), 'view_all_partners'));
CREATE POLICY "partner inserts investments" ON public.car_investments FOR INSERT TO authenticated
  WITH CHECK (public.has_partner_perm(auth.uid(), 'edit_car'));
CREATE POLICY "partner updates investments" ON public.car_investments FOR UPDATE TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'edit_car')) WITH CHECK (public.has_partner_perm(auth.uid(), 'edit_car'));
CREATE POLICY "partner deletes investments" ON public.car_investments FOR DELETE TO authenticated
  USING (public.has_partner_perm(auth.uid(), 'edit_car'));

-- partners
DROP POLICY "partner reads self" ON public.partners;
CREATE POLICY "partner reads partners" ON public.partners FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_partner_perm(auth.uid(), 'view_all_partners'));

-- transactions
DROP POLICY "partner reads own transactions" ON public.transactions;
CREATE POLICY "partner reads transactions" ON public.transactions FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_partner_ids()) OR public.has_partner_perm(auth.uid(), 'view_all_partners'));
CREATE POLICY "partner inserts transactions" ON public.transactions FOR INSERT TO authenticated
  WITH CHECK ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
    OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')));
CREATE POLICY "partner updates transactions" ON public.transactions FOR UPDATE TO authenticated
  USING ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
    OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')))
  WITH CHECK ((type = 'settlement' AND public.has_partner_perm(auth.uid(), 'manage_settlements'))
    OR (type <> 'settlement' AND public.has_partner_perm(auth.uid(), 'add_payment')));