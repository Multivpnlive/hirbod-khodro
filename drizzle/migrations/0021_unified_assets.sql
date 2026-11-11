-- 0021: Unified asset records.
-- Cars become the single record for both hawalas and delivered vehicles.

BEGIN;

-- Refuse to remove the legacy hawala workflow if data has appeared.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.hawalas)
       OR EXISTS (SELECT 1 FROM public.hawala_investments)
       OR EXISTS (SELECT 1 FROM public.hawala_sales)
       OR EXISTS (SELECT 1 FROM public.transactions WHERE hawala_id IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.cars WHERE source_hawala_id IS NOT NULL)
    THEN
        RAISE EXCEPTION
          'Legacy hawala data detected. Migration 0021 stopped without deleting data.';
    END IF;
END;
$$;

-- Remove only legacy hawala-specific triggers.
DROP TRIGGER IF EXISTS trg_complete_hawala_conversion ON public.cars;
DROP TRIGGER IF EXISTS trg_guard_hawala_conversion ON public.cars;
DROP TRIGGER IF EXISTS trg_guard_hawala_transaction ON public.transactions;
DROP TRIGGER IF EXISTS trg_sync_hawala_cost_basis ON public.transactions;
DROP TRIGGER IF EXISTS trg_guard_hawala_sale ON public.hawala_sales;

-- Remove only legacy hawala-specific functions.
DROP FUNCTION IF EXISTS public.complete_hawala_conversion();
DROP FUNCTION IF EXISTS public.guard_hawala_conversion();
DROP FUNCTION IF EXISTS public.guard_hawala_transaction();
DROP FUNCTION IF EXISTS public.sync_hawala_cost_basis();
DROP FUNCTION IF EXISTS public.guard_hawala_sale();

-- Remove old links to the now-obsolete hawala records.
DROP INDEX IF EXISTS public.cars_source_hawala_id_unique;

ALTER TABLE public.cars
    DROP CONSTRAINT IF EXISTS cars_source_hawala_id_fkey;

ALTER TABLE public.transactions
    DROP CONSTRAINT IF EXISTS transactions_hawala_id_fkey;

ALTER TABLE public.cars
    DROP COLUMN IF EXISTS source_hawala_id;

ALTER TABLE public.transactions
    DROP COLUMN IF EXISTS hawala_id;


-- Remove RLS policies attached to the obsolete hawala tables before dropping them.
DO $drop_legacy_hawala_policies$
DECLARE
    p record;
BEGIN
    FOR p IN
        SELECT tablename, policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('hawalas', 'hawala_investments', 'hawala_sales')
    LOOP
        EXECUTE format(
            'DROP POLICY %I ON public.%I',
            p.policyname,
            p.tablename
        );
    END LOOP;
END;
$drop_legacy_hawala_policies$;

-- Legacy tables are empty; remove the obsolete three-mode workflow.
DROP TABLE IF EXISTS public.hawala_sales;
DROP TABLE IF EXISTS public.hawala_investments;
DROP TABLE IF EXISTS public.hawalas;

-- Extend the existing cars table into the unified asset registry.
ALTER TABLE public.cars
    ADD COLUMN asset_type text NOT NULL DEFAULT 'car',
    ADD COLUMN ownership_type text NOT NULL DEFAULT 'personal',
    ADD COLUMN factory_price numeric(16,0) NOT NULL DEFAULT 0,
    ADD COLUMN premium_price numeric(16,0) NOT NULL DEFAULT 0,
    ADD COLUMN delivery_date date;

-- Preserve current vehicles and derive their ownership from existing investments.
UPDATE public.cars c
SET
    asset_type = 'car',
    ownership_type = CASE
        WHEN EXISTS (
            SELECT 1
            FROM public.car_investments ci
            WHERE ci.car_id = c.id
        ) THEN 'shared'
        ELSE 'personal'
    END;

ALTER TABLE public.cars
    ADD CONSTRAINT cars_asset_type_check
        CHECK (asset_type IN ('hawala', 'car')),
    ADD CONSTRAINT cars_ownership_type_check
        CHECK (ownership_type IN ('personal', 'shared')),
    ADD CONSTRAINT cars_hawala_pricing_check
        CHECK (
            asset_type <> 'hawala'
            OR (factory_price > 0 AND premium_price >= 0)
        );

-- Calculate hawala acquisition cost from factory price plus premium.
-- Changing a hawala into a car keeps its existing purchase_price.
CREATE OR REPLACE FUNCTION public.sync_asset_purchase_price()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.asset_type = 'hawala' THEN
        IF NEW.factory_price <= 0 OR NEW.premium_price < 0 THEN
            RAISE EXCEPTION
              'A hawala requires a positive factory price and a non-negative premium';
        END IF;

        NEW.purchase_price := NEW.factory_price + NEW.premium_price;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_asset_purchase_price ON public.cars;

CREATE TRIGGER trg_sync_asset_purchase_price
BEFORE INSERT OR UPDATE OF
    asset_type,
    factory_price,
    premium_price,
    purchase_price
ON public.cars
FOR EACH ROW
EXECUTE FUNCTION public.sync_asset_purchase_price();

REVOKE ALL ON FUNCTION public.sync_asset_purchase_price()
FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.cars.asset_type IS
    'Unified asset type: hawala or delivered car';

COMMENT ON COLUMN public.cars.ownership_type IS
    'Asset ownership: personal or shared';

COMMENT ON COLUMN public.cars.factory_price IS
    'Factory price used for hawala cost calculation';

COMMENT ON COLUMN public.cars.premium_price IS
    'Hawala premium or assignment price';

COMMENT ON COLUMN public.cars.delivery_date IS
    'Date the hawala was delivered and became a vehicle';


-- Remove the obsolete hawalas resource from staff permission management.
-- Preserve the rest of both existing SECURITY DEFINER function bodies.
DO $remove_hawala_staff_resource$
DECLARE
    v_admin_definition text;
    v_seed_definition text;
BEGIN
    SELECT pg_get_functiondef(
        'public.admin_save_staff_user(uuid,text,boolean,jsonb,uuid)'::regprocedure
    )
    INTO v_admin_definition;

    IF position('jsonb_array_length(_permissions) <> 7' IN v_admin_definition) = 0
       OR position('Exactly seven resource permission rows are required' IN v_admin_definition) = 0
       OR position(') <> 7 THEN' IN v_admin_definition) = 0
       OR position(E'            ''hawalas''' IN v_admin_definition) = 0
    THEN
        RAISE EXCEPTION
          'admin_save_staff_user has an unexpected definition; migration stopped';
    END IF;

    v_admin_definition := replace(
        v_admin_definition,
        'jsonb_array_length(_permissions) <> 7',
        'jsonb_array_length(_permissions) <> 6'
    );

    v_admin_definition := replace(
        v_admin_definition,
        'Exactly seven resource permission rows are required',
        'Exactly six resource permission rows are required'
    );

    v_admin_definition := replace(
        v_admin_definition,
        ') <> 7 THEN',
        ') <> 6 THEN'
    );

    v_admin_definition := replace(
        v_admin_definition,
        E'            ''fund_transfers'',\n            ''hawalas''',
        E'            ''fund_transfers'''
    );

    IF position('hawalas' IN v_admin_definition) > 0 THEN
        RAISE EXCEPTION
          'Legacy hawalas resource remains in admin_save_staff_user; migration stopped';
    END IF;

    EXECUTE v_admin_definition;

    SELECT pg_get_functiondef(
        'public.seed_staff_permissions()'::regprocedure
    )
    INTO v_seed_definition;

    v_seed_definition := regexp_replace(
        v_seed_definition,
        E',\\s*\\(NEW\\.user_id, ''hawalas'',\\s*NEW\\.staff_role = ''finance_manager'',\\s*NEW\\.staff_role = ''finance_manager'',\\s*NEW\\.staff_role = ''finance_manager'', false\\)',
        '',
        'g'
    );

    IF position('hawalas' IN v_seed_definition) > 0 THEN
        RAISE EXCEPTION
          'Legacy hawalas resource remains in seed_staff_permissions; migration stopped';
    END IF;

    EXECUTE v_seed_definition;

    DELETE FROM public.staff_permissions
    WHERE resource = 'hawalas';
END;
$remove_hawala_staff_resource$;

NOTIFY pgrst, 'reload schema';

COMMIT;
