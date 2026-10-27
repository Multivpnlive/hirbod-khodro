-- Rollback guide for migration 0005.
-- SAFETY: Do not run destructive DROP statements automatically.
-- This migration may contain real customer and financial records.
------------------------------------------------------------------

-- Before any rollback:
-- 1. Take and verify a database backup.
-- 2. Confirm whether any new tables contain real data.
-- 3. Review RLS policies, grants, views, and foreign-key dependencies.
-- 4. Prepare and test a recovery plan on a non-production database.
--------------------------------------------------------------------

-- The following objects are intentionally retained:
-- public.customers
-- public.customer_access
-- public.sale_receipts
-- public.sale_adjustments
-- public.brokerage_deals
-- public.commission_splits
-- public.cars.buyer_customer_id
-- public.can_see_customer(uuid)
-- public.car_receivables
-------------------------

-- No database changes are performed by this file.
