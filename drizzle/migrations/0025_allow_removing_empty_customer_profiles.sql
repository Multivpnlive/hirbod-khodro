-- Customer-linked partner rows are profile links, not proof of financial history.
-- Preserve the partner profile and its financial rows while allowing its customer
-- record to be removed; the UI separately blocks customers with real activity.
BEGIN;

ALTER TABLE public.partners
  DROP CONSTRAINT IF EXISTS partners_customer_id_fkey;

ALTER TABLE public.partners
  ADD CONSTRAINT partners_customer_id_fkey
  FOREIGN KEY (customer_id)
  REFERENCES public.customers(id)
  ON DELETE SET NULL;

COMMIT;
