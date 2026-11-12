
BEGIN;

-- Safety checks: do not discard newly-created financial data.
DO $$
BEGIN
    IF to_regclass('public.brokerage_deals') IS NULL
       OR to_regclass('public.brokerage_costs') IS NULL
       OR to_regclass('public.commission_splits') IS NULL THEN
        RAISE EXCEPTION 'Expected brokerage tables are missing';
    END IF;

    IF EXISTS (SELECT 1 FROM public.brokerage_deals)
       OR EXISTS (SELECT 1 FROM public.brokerage_costs)
       OR EXISTS (SELECT 1 FROM public.commission_splits) THEN
        RAISE EXCEPTION
          'Brokerage records exist; migration stopped to protect data';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.transactions
        WHERE purpose = 'brokerage_commission'
           OR brokerage_deal_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION
          'Brokerage transactions exist; migration stopped to protect data';
    END IF;
END;
$$;


-- Seven default permission resources.
-- Hawala permissions remain independent of brokerage.

CREATE OR REPLACE FUNCTION public.seed_staff_permissions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
    INSERT INTO public.staff_permissions
        (user_id, resource, can_view, can_create, can_edit, can_delete)
    VALUES
        (NEW.user_id, 'cars',
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role IN ('finance_manager','sales'), false),

        (NEW.user_id, 'partners',
         NEW.staff_role = 'finance_manager', false, false, false),

        (NEW.user_id, 'transactions',
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role = 'finance_manager',
         NEW.staff_role = 'finance_manager', false),

        (NEW.user_id, 'customers',
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role IN ('finance_manager','sales'), false),

        (NEW.user_id, 'receivables',
         NEW.staff_role IN ('finance_manager','sales'),
         NEW.staff_role = 'sales',
         NEW.staff_role = 'finance_manager', false),

        (NEW.user_id, 'fund_transfers',
         NEW.staff_role = 'finance_manager',
         NEW.staff_role = 'finance_manager',
         NEW.staff_role = 'finance_manager', false),

        (NEW.user_id, 'hawalas',
         NEW.staff_role = 'finance_manager',
         NEW.staff_role = 'finance_manager',
         NEW.staff_role = 'finance_manager', false)

    ON CONFLICT (user_id, resource) DO NOTHING;

    RETURN NEW;
END;
$function$;


-- Update the staff permission management API.
-- Preserve the existing security and partner-linking logic.

CREATE OR REPLACE FUNCTION public.admin_save_staff_user(
    _user_id uuid,
    _staff_role text,
    _is_active boolean,
    _permissions jsonb,
    _linked_partner_id uuid DEFAULT NULL::uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
    _old_partner_id uuid;
    _item jsonb;
    _resource text;
BEGIN
    IF auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Service role required';
    END IF;

    IF _staff_role NOT IN (
        'finance_manager', 'sales', 'limited'
    ) THEN
        RAISE EXCEPTION 'Invalid staff role';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.staff_access
        WHERE user_id = _user_id
    ) THEN
        RAISE EXCEPTION 'Staff account not found';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = 'admin'
    ) THEN
        RAISE EXCEPTION
          'The primary administrator cannot be managed as staff';
    END IF;

    IF jsonb_typeof(_permissions) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Permission matrix must be an array';
    END IF;

    IF jsonb_array_length(_permissions) <> 7 THEN
        RAISE EXCEPTION
          'Exactly seven resource permission rows are required';
    END IF;

    FOR _item IN
        SELECT value
        FROM jsonb_array_elements(_permissions)
    LOOP
        _resource := _item->>'resource';

        IF _resource IS NULL OR _resource NOT IN (
            'cars',
            'partners',
            'transactions',
            'customers',
            'receivables',
            'fund_transfers',
            'hawalas'
        ) THEN
            RAISE EXCEPTION 'Invalid resource in permission matrix';
        END IF;

        IF jsonb_typeof(_item->'can_view') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(_item->'can_create') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(_item->'can_edit') IS DISTINCT FROM 'boolean'
           OR jsonb_typeof(_item->'can_delete') IS DISTINCT FROM 'boolean'
        THEN
            RAISE EXCEPTION 'Permission flags must be booleans';
        END IF;
    END LOOP;

    IF (
        SELECT count(DISTINCT value->>'resource')
        FROM jsonb_array_elements(_permissions)
    ) <> 7 THEN
        RAISE EXCEPTION 'Permission resources must be unique';
    END IF;

    SELECT linked_partner_id
    INTO _old_partner_id
    FROM public.staff_access
    WHERE user_id = _user_id
    FOR UPDATE;

    IF _linked_partner_id IS NOT NULL THEN

        IF EXISTS (
            SELECT 1
            FROM public.staff_access
            WHERE linked_partner_id = _linked_partner_id
              AND user_id <> _user_id
        ) THEN
            RAISE EXCEPTION
              'This partner is already linked to another staff account';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM public.partners
            WHERE id = _linked_partner_id
        ) THEN
            RAISE EXCEPTION 'Partner record not found';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.partners
            WHERE id = _linked_partner_id
              AND user_id IS NOT NULL
              AND user_id <> _user_id
        ) THEN
            RAISE EXCEPTION 'Partner record is linked to another account';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.partners
            WHERE user_id = _user_id
              AND id <> _linked_partner_id
        ) THEN
            RAISE EXCEPTION
              'This account is already linked to another partner record';
        END IF;

    END IF;

    IF _old_partner_id IS DISTINCT FROM _linked_partner_id THEN
        UPDATE public.partners
        SET user_id = NULL
        WHERE id = _old_partner_id
          AND user_id = _user_id;
    END IF;

    IF _linked_partner_id IS NOT NULL THEN
        UPDATE public.partners
        SET user_id = _user_id
        WHERE id = _linked_partner_id;
    END IF;

    UPDATE public.staff_access
    SET staff_role = _staff_role,
        is_active = _is_active,
        linked_partner_id = _linked_partner_id,
        updated_at = now()
    WHERE user_id = _user_id;

    DELETE FROM public.staff_permissions
    WHERE user_id = _user_id;

    INSERT INTO public.staff_permissions
        (user_id, resource, can_view, can_create, can_edit, can_delete)
    SELECT
        _user_id,
        x.resource,
        x.can_view,
        x.can_create,
        x.can_edit,
        x.can_delete
    FROM jsonb_to_recordset(_permissions) AS x(
        resource text,
        can_view boolean,
        can_create boolean,
        can_edit boolean,
        can_delete boolean
    );
END;
$function$;


-- Remove the old permission from existing staff accounts.

DELETE FROM public.staff_permissions
WHERE resource = 'brokerage';


-- Remove the obsolete partner permission column.

ALTER TABLE public.partner_permissions
DROP COLUMN IF EXISTS can_view_brokerage;


-- Remove the foreign key and obsolete transaction column.

ALTER TABLE public.transactions
DROP CONSTRAINT IF EXISTS transactions_brokerage_deal_id_fkey;

ALTER TABLE public.transactions
DROP COLUMN IF EXISTS brokerage_deal_id;


-- Remove the three independent brokerage tables.
-- No CASCADE: unexpected dependencies must stop the migration.

DROP TABLE public.brokerage_costs;
DROP TABLE public.commission_splits;
DROP TABLE public.brokerage_deals;


-- Remove only brokerage-specific trigger functions.

DROP FUNCTION public.sync_brokerage_commission_columns();
DROP FUNCTION public.guard_commission_split_total();
DROP FUNCTION public.guard_commission_splits_before_first_receipt();


-- Final integrity checks.

DO $$
BEGIN
    IF to_regclass('public.brokerage_deals') IS NOT NULL
       OR to_regclass('public.brokerage_costs') IS NOT NULL
       OR to_regclass('public.commission_splits') IS NOT NULL THEN
        RAISE EXCEPTION 'Brokerage tables still exist';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.staff_permissions
        WHERE resource = 'brokerage'
    ) THEN
        RAISE EXCEPTION 'Brokerage staff permission still exists';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'partner_permissions'
          AND column_name = 'can_view_brokerage'
    ) THEN
        RAISE EXCEPTION 'Brokerage partner permission column still exists';
    END IF;

    IF to_regprocedure(
        'public.guard_hawala_transaction()'
    ) IS NULL THEN
        RAISE EXCEPTION 'Hawala transaction guard is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'trg_guard_hawala_transaction'
          AND tgfoid =
            'public.guard_hawala_transaction()'::regprocedure
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Hawala transaction trigger is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'staff_access_seed_permissions'
          AND tgfoid =
            'public.seed_staff_permissions()'::regprocedure
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'Staff permission seed trigger is missing';
    END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
