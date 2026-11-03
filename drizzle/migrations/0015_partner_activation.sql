-- Preserve partner financial history while supporting safe deactivation.
BEGIN;

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS partners_is_active_idx
  ON public.partners(is_active);

COMMIT;
