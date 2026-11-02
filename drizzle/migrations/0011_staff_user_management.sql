-- Hirbod Khodro: independent staff accounts, permissions and optional partner links.
-- Additive migration. Does not delete or alter existing users, roles, partners or finance rows.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    RAISE EXCEPTION 'No admin account exists; refusing to install staff management.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.staff_access (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_role text NOT NULL CHECK (staff_role IN ('finance_manager','sales','limited')),
  is_active boolean NOT NULL DEFAULT true,
  linked_partner_id uuid UNIQUE REFERENCES public.partners(id) ON DELETE SET NULL,
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.staff_permissions (
  user_id uuid NOT NULL REFERENCES public.staff_access(user_id) ON DELETE CASCADE,
  resource text NOT NULL CHECK (resource IN (
    'cars','partners','transactions','customers','receivables',
    'fund_transfers','brokerage','hawalas'
  )),
  can_view boolean NOT NULL DEFAULT false,
  can_create boolean NOT NULL DEFAULT false,
  can_edit boolean NOT NULL DEFAULT false,
  can_delete boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, resource)
);

CREATE INDEX IF NOT EXISTS staff_access_active_idx ON public.staff_access(is_active);
CREATE INDEX IF NOT EXISTS staff_permissions_resource_idx ON public.staff_permissions(resource);

ALTER TABLE public.staff_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.staff_access, public.staff_permissions TO authenticated;
GRANT ALL ON public.staff_access, public.staff_permissions TO service_role;

DROP POLICY IF EXISTS "staff reads own access" ON public.staff_access;
CREATE POLICY "staff reads own access" ON public.staff_access
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "admin reads staff access" ON public.staff_access;
CREATE POLICY "admin reads staff access" ON public.staff_access
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "staff reads own permissions" ON public.staff_permissions;
CREATE POLICY "staff reads own permissions" ON public.staff_permissions
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS "admin reads staff permissions" ON public.staff_permissions;
CREATE POLICY "admin reads staff permissions" ON public.staff_permissions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- A user without a staff_access row keeps the existing partner-account behavior.
-- A deactivated staff account loses staff and linked-partner permissions immediately.
CREATE OR REPLACE FUNCTION public.is_staff_enabled(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.role() = 'service_role' OR auth.uid() = _user_id OR public.has_role(auth.uid(), 'admin')
      THEN COALESCE((SELECT sa.is_active FROM public.staff_access sa WHERE sa.user_id = _user_id), true)
    ELSE false
  END
$$;

CREATE OR REPLACE FUNCTION public.has_staff_perm(_user_id uuid, _resource text, _action text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN auth.role() <> 'service_role' AND auth.uid() IS DISTINCT FROM _user_id AND NOT public.has_role(auth.uid(), 'admin') THEN false
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
  END
$$;

REVOKE ALL ON FUNCTION public.is_staff_enabled(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_staff_perm(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_staff_enabled(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_staff_perm(uuid, text, text) TO authenticated, service_role;

-- Keep old partner-based access intact, except when a staff account is disabled.
CREATE OR REPLACE FUNCTION public.has_partner_perm(_user_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.is_staff_enabled(_user_id) AND COALESCE((
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

CREATE OR REPLACE FUNCTION public.my_partner_ids()
RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM public.partners
  WHERE user_id = auth.uid() AND public.is_staff_enabled(auth.uid())
$$;

-- Preset permissions are defaults only. The manager can customize every cell later.
CREATE OR REPLACE FUNCTION public.seed_staff_permissions()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.staff_permissions (user_id, resource, can_view, can_create, can_edit, can_delete)
  VALUES
    (NEW.user_id, 'cars', NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role IN ('finance_manager','sales'), false),
    (NEW.user_id, 'partners', NEW.staff_role = 'finance_manager', false, false, false),
    (NEW.user_id, 'transactions', NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', false),
    (NEW.user_id, 'customers', NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role IN ('finance_manager','sales'), false),
    (NEW.user_id, 'receivables', NEW.staff_role IN ('finance_manager','sales'), NEW.staff_role = 'sales', NEW.staff_role = 'finance_manager', false),
    (NEW.user_id, 'fund_transfers', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', false),
    (NEW.user_id, 'brokerage', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', false),
    (NEW.user_id, 'hawalas', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', NEW.staff_role = 'finance_manager', false)
  ON CONFLICT (user_id, resource) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staff_access_seed_permissions ON public.staff_access;
CREATE TRIGGER staff_access_seed_permissions
AFTER INSERT ON public.staff_access
FOR EACH ROW EXECUTE FUNCTION public.seed_staff_permissions();

-- Atomic admin-only save: role, active state, permission matrix and optional partner link.
CREATE OR REPLACE FUNCTION public.admin_save_staff_user(
  _user_id uuid,
  _staff_role text,
  _is_active boolean,
  _permissions jsonb,
  _linked_partner_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  _old_partner_id uuid;
  _item jsonb;
  _resource text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF _staff_role NOT IN ('finance_manager','sales','limited') THEN
    RAISE EXCEPTION 'Invalid staff role';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.staff_access WHERE user_id = _user_id) THEN
    RAISE EXCEPTION 'Staff account not found';
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'admin') THEN
    RAISE EXCEPTION 'The primary administrator cannot be managed as staff';
  END IF;
  IF jsonb_typeof(_permissions) <> 'array' OR jsonb_array_length(_permissions) <> 8 THEN
    RAISE EXCEPTION 'Exactly eight resource permission rows are required';
  END IF;
  FOR _item IN SELECT value FROM jsonb_array_elements(_permissions)
  LOOP
    _resource := _item->>'resource';
    IF _resource NOT IN ('cars','partners','transactions','customers','receivables','fund_transfers','brokerage','hawalas') THEN
      RAISE EXCEPTION 'Invalid resource in permission matrix';
    END IF;
    IF jsonb_typeof(_item->'can_view') <> 'boolean'
       OR jsonb_typeof(_item->'can_create') <> 'boolean'
       OR jsonb_typeof(_item->'can_edit') <> 'boolean'
       OR jsonb_typeof(_item->'can_delete') <> 'boolean' THEN
      RAISE EXCEPTION 'Permission flags must be booleans';
    END IF;
  END LOOP;
  IF (SELECT count(DISTINCT value->>'resource') FROM jsonb_array_elements(_permissions)) <> 8 THEN
    RAISE EXCEPTION 'Permission resources must be unique';
  END IF;
  SELECT linked_partner_id INTO _old_partner_id FROM public.staff_access WHERE user_id = _user_id FOR UPDATE;
  IF _linked_partner_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.staff_access WHERE linked_partner_id = _linked_partner_id AND user_id <> _user_id) THEN
      RAISE EXCEPTION 'This partner is already linked to another staff account';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.partners WHERE id = _linked_partner_id) THEN
      RAISE EXCEPTION 'Partner record not found';
    END IF;
    IF EXISTS (SELECT 1 FROM public.partners WHERE id = _linked_partner_id AND user_id IS NOT NULL AND user_id <> _user_id) THEN
      RAISE EXCEPTION 'Partner record is linked to another account';
    END IF;
    IF EXISTS (SELECT 1 FROM public.partners WHERE user_id = _user_id AND id <> _linked_partner_id) THEN
      RAISE EXCEPTION 'This account is already linked to another partner record';
    END IF;
  END IF;
  IF _old_partner_id IS DISTINCT FROM _linked_partner_id THEN
    UPDATE public.partners SET user_id = NULL WHERE id = _old_partner_id AND user_id = _user_id;
  END IF;
  IF _linked_partner_id IS NOT NULL THEN
    UPDATE public.partners SET user_id = _user_id WHERE id = _linked_partner_id;
  END IF;
  UPDATE public.staff_access
  SET staff_role = _staff_role,
      is_active = _is_active,
      linked_partner_id = _linked_partner_id,
      updated_at = now()
  WHERE user_id = _user_id;

  DELETE FROM public.staff_permissions WHERE user_id = _user_id;
  INSERT INTO public.staff_permissions (user_id, resource, can_view, can_create, can_edit, can_delete)
  SELECT _user_id, x.resource, x.can_view, x.can_create, x.can_edit, x.can_delete
  FROM jsonb_to_recordset(_permissions) AS x(
    resource text, can_view boolean, can_create boolean, can_edit boolean, can_delete boolean
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_save_staff_user(uuid, text, boolean, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_staff_user(uuid, text, boolean, jsonb, uuid) TO service_role;

-- RLS policies are OR-combined; these add explicit staff capabilities without widening partner access.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('cars','cars'),
    ('partners','partners'),
    ('car_investments','cars'),
    ('car_expenses','cars'),
    ('customers','customers'),
    ('customer_access','customers'),
    ('sale_receipts','receivables'),
    ('sale_adjustments','receivables'),
    ('fund_transfers','fund_transfers'),
    ('brokerage_deals','brokerage'),
    ('brokerage_costs','brokerage'),
    ('commission_splits','brokerage'),
    ('hawalas','hawalas'),
    ('hawala_investments','hawalas'),
    ('hawala_sales','hawalas')
  ) AS t(tablename, resource)
  LOOP
    -- Add a staff read policy for the table/resource pair.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'staff_'||r.resource||'_view', r.tablename);
    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_perm(auth.uid(), %L, %L))',
      'staff_'||r.resource||'_view', r.tablename, r.resource, 'view');
  END LOOP;
END $$;

-- Write policies, with sensitive transaction custody funds kept outside the staff transaction permission.
DROP POLICY IF EXISTS staff_cars_create ON public.cars;
CREATE POLICY staff_cars_create ON public.cars FOR INSERT TO authenticated
  WITH CHECK (public.has_staff_perm(auth.uid(),'cars','create'));
DROP POLICY IF EXISTS staff_cars_edit ON public.cars;
CREATE POLICY staff_cars_edit ON public.cars FOR UPDATE TO authenticated
  USING (public.has_staff_perm(auth.uid(),'cars','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'cars','edit'));
DROP POLICY IF EXISTS staff_cars_delete ON public.cars;
CREATE POLICY staff_cars_delete ON public.cars FOR DELETE TO authenticated
  USING (public.has_staff_perm(auth.uid(),'cars','delete'));

DROP POLICY IF EXISTS staff_partners_create ON public.partners;
CREATE POLICY staff_partners_create ON public.partners FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'partners','create'));
DROP POLICY IF EXISTS staff_partners_edit ON public.partners;
CREATE POLICY staff_partners_edit ON public.partners FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'partners','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'partners','edit'));
DROP POLICY IF EXISTS staff_partners_delete ON public.partners;
CREATE POLICY staff_partners_delete ON public.partners FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'partners','delete'));

DROP POLICY IF EXISTS staff_car_investments_create ON public.car_investments;
CREATE POLICY staff_car_investments_create ON public.car_investments FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'cars','create') OR public.has_staff_perm(auth.uid(),'cars','edit'));
DROP POLICY IF EXISTS staff_car_investments_edit ON public.car_investments;
CREATE POLICY staff_car_investments_edit ON public.car_investments FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'cars','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'cars','edit'));
DROP POLICY IF EXISTS staff_car_investments_delete ON public.car_investments;
CREATE POLICY staff_car_investments_delete ON public.car_investments FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'cars','delete'));

DROP POLICY IF EXISTS staff_car_expenses_create ON public.car_expenses;
CREATE POLICY staff_car_expenses_create ON public.car_expenses FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'cars','create') OR public.has_staff_perm(auth.uid(),'cars','edit'));
DROP POLICY IF EXISTS staff_car_expenses_edit ON public.car_expenses;
CREATE POLICY staff_car_expenses_edit ON public.car_expenses FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'cars','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'cars','edit'));
DROP POLICY IF EXISTS staff_car_expenses_delete ON public.car_expenses;
CREATE POLICY staff_car_expenses_delete ON public.car_expenses FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'cars','delete'));

DROP POLICY IF EXISTS staff_transactions_view ON public.transactions;
CREATE POLICY staff_transactions_view ON public.transactions FOR SELECT TO authenticated USING (fund = 'business' AND public.has_staff_perm(auth.uid(),'transactions','view'));
DROP POLICY IF EXISTS staff_transactions_create ON public.transactions;
CREATE POLICY staff_transactions_create ON public.transactions FOR INSERT TO authenticated WITH CHECK (fund = 'business' AND public.has_staff_perm(auth.uid(),'transactions','create'));
DROP POLICY IF EXISTS staff_transactions_edit ON public.transactions;
CREATE POLICY staff_transactions_edit ON public.transactions FOR UPDATE TO authenticated USING (fund = 'business' AND public.has_staff_perm(auth.uid(),'transactions','edit')) WITH CHECK (fund = 'business' AND public.has_staff_perm(auth.uid(),'transactions','edit'));
DROP POLICY IF EXISTS staff_transactions_delete ON public.transactions;
CREATE POLICY staff_transactions_delete ON public.transactions FOR DELETE TO authenticated USING (fund = 'business' AND public.has_staff_perm(auth.uid(),'transactions','delete'));

DROP POLICY IF EXISTS staff_customers_create ON public.customers;
CREATE POLICY staff_customers_create ON public.customers FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'customers','create'));
DROP POLICY IF EXISTS staff_customers_edit ON public.customers;
CREATE POLICY staff_customers_edit ON public.customers FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'customers','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'customers','edit'));
DROP POLICY IF EXISTS staff_customers_delete ON public.customers;
CREATE POLICY staff_customers_delete ON public.customers FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'customers','delete'));
DROP POLICY IF EXISTS staff_customer_access_manage ON public.customer_access;
CREATE POLICY staff_customer_access_manage ON public.customer_access FOR ALL TO authenticated USING (public.has_staff_perm(auth.uid(),'customers','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'customers','edit'));

DROP POLICY IF EXISTS staff_sale_receipts_create ON public.sale_receipts;
CREATE POLICY staff_sale_receipts_create ON public.sale_receipts FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'receivables','create'));
DROP POLICY IF EXISTS staff_sale_receipts_delete ON public.sale_receipts;
CREATE POLICY staff_sale_receipts_delete ON public.sale_receipts FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'receivables','delete'));
DROP POLICY IF EXISTS staff_sale_adjustments_manage ON public.sale_adjustments;
CREATE POLICY staff_sale_adjustments_manage ON public.sale_adjustments FOR ALL TO authenticated USING (public.has_staff_perm(auth.uid(),'receivables','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'receivables','edit'));

DROP POLICY IF EXISTS staff_fund_transfers_create ON public.fund_transfers;
CREATE POLICY staff_fund_transfers_create ON public.fund_transfers FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'fund_transfers','create'));
DROP POLICY IF EXISTS staff_fund_transfers_edit ON public.fund_transfers;
CREATE POLICY staff_fund_transfers_edit ON public.fund_transfers FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'fund_transfers','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'fund_transfers','edit'));
DROP POLICY IF EXISTS staff_fund_transfers_delete ON public.fund_transfers;
CREATE POLICY staff_fund_transfers_delete ON public.fund_transfers FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'fund_transfers','delete'));

DROP POLICY IF EXISTS staff_brokerage_deals_create ON public.brokerage_deals;
CREATE POLICY staff_brokerage_deals_create ON public.brokerage_deals FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','create'));
DROP POLICY IF EXISTS staff_brokerage_deals_edit ON public.brokerage_deals;
CREATE POLICY staff_brokerage_deals_edit ON public.brokerage_deals FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','edit'));
DROP POLICY IF EXISTS staff_brokerage_deals_delete ON public.brokerage_deals;
CREATE POLICY staff_brokerage_deals_delete ON public.brokerage_deals FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','delete'));
DROP POLICY IF EXISTS staff_brokerage_costs_create ON public.brokerage_costs;
CREATE POLICY staff_brokerage_costs_create ON public.brokerage_costs FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','create'));
DROP POLICY IF EXISTS staff_brokerage_costs_edit ON public.brokerage_costs;
CREATE POLICY staff_brokerage_costs_edit ON public.brokerage_costs FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','edit'));
DROP POLICY IF EXISTS staff_brokerage_costs_delete ON public.brokerage_costs;
CREATE POLICY staff_brokerage_costs_delete ON public.brokerage_costs FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','delete'));
DROP POLICY IF EXISTS staff_commission_splits_create ON public.commission_splits;
CREATE POLICY staff_commission_splits_create ON public.commission_splits FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','create'));
DROP POLICY IF EXISTS staff_commission_splits_edit ON public.commission_splits;
CREATE POLICY staff_commission_splits_edit ON public.commission_splits FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'brokerage','edit'));
DROP POLICY IF EXISTS staff_commission_splits_delete ON public.commission_splits;
CREATE POLICY staff_commission_splits_delete ON public.commission_splits FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'brokerage','delete'));

DROP POLICY IF EXISTS staff_hawalas_create ON public.hawalas;
CREATE POLICY staff_hawalas_create ON public.hawalas FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','create'));
DROP POLICY IF EXISTS staff_hawalas_edit ON public.hawalas;
CREATE POLICY staff_hawalas_edit ON public.hawalas FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','edit'));
DROP POLICY IF EXISTS staff_hawalas_delete ON public.hawalas;
CREATE POLICY staff_hawalas_delete ON public.hawalas FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','delete'));
DROP POLICY IF EXISTS staff_hawala_investments_create ON public.hawala_investments;
CREATE POLICY staff_hawala_investments_create ON public.hawala_investments FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','create'));
DROP POLICY IF EXISTS staff_hawala_investments_edit ON public.hawala_investments;
CREATE POLICY staff_hawala_investments_edit ON public.hawala_investments FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','edit'));
DROP POLICY IF EXISTS staff_hawala_investments_delete ON public.hawala_investments;
CREATE POLICY staff_hawala_investments_delete ON public.hawala_investments FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','delete'));
DROP POLICY IF EXISTS staff_hawala_sales_create ON public.hawala_sales;
CREATE POLICY staff_hawala_sales_create ON public.hawala_sales FOR INSERT TO authenticated WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','create'));
DROP POLICY IF EXISTS staff_hawala_sales_edit ON public.hawala_sales;
CREATE POLICY staff_hawala_sales_edit ON public.hawala_sales FOR UPDATE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','edit')) WITH CHECK (public.has_staff_perm(auth.uid(),'hawalas','edit'));
DROP POLICY IF EXISTS staff_hawala_sales_delete ON public.hawala_sales;
CREATE POLICY staff_hawala_sales_delete ON public.hawala_sales FOR DELETE TO authenticated USING (public.has_staff_perm(auth.uid(),'hawalas','delete'));

-- An inactive staff account must not retain the old self-only partner-row read policy.
DROP POLICY IF EXISTS "partner reads own linked financial record" ON public.partners;
CREATE POLICY "partner reads own linked financial record" ON public.partners
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.is_staff_enabled(auth.uid()));

NOTIFY pgrst, 'reload schema';
