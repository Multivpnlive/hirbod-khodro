-- Rollback helpers for migration 0004.
-- Does not drop the fund column or delete transaction data.
-- Review dependencies before running against any database.

DROP TRIGGER IF EXISTS trg_business_cash_nonnegative
ON public.transactions;

DROP FUNCTION IF EXISTS public.enforce_business_cash_nonnegative();

DROP TRIGGER IF EXISTS trg_guard_transaction_fund
ON public.transactions;

DROP FUNCTION IF EXISTS public.guard_transaction_fund();

-- Intentionally retain public.transactions.fund and its constraint.
-- The column may contain real financial classifications.
