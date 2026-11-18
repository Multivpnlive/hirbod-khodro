-- Receivables are the unpaid portion of the sale contract. Vehicle expenses
-- affect profit/cost, but must never be included in a customer's receivable.
BEGIN;

CREATE OR REPLACE VIEW public.car_receivables WITH (security_invoker = false) AS
SELECT
  c.id AS car_id,
  c.sale_price,
  COALESCE((
    SELECT SUM(t.amount)
    FROM public.transactions t
    WHERE t.car_id = c.id
      AND t.type = 'receipt'
      AND COALESCE(t.fund, 'business') = 'business'
      AND NOT t.is_demo
  ), 0) AS received,
  COALESCE((
    SELECT SUM(a.amount)
    FROM public.sale_adjustments a
    WHERE a.car_id = c.id
  ), 0) AS adjusted,
  GREATEST(
    COALESCE(c.sale_price, 0)
    - COALESCE((
        SELECT SUM(t.amount)
        FROM public.transactions t
        WHERE t.car_id = c.id
          AND t.type = 'receipt'
          AND COALESCE(t.fund, 'business') = 'business'
          AND NOT t.is_demo
      ), 0)
    - COALESCE((
        SELECT SUM(a.amount)
        FROM public.sale_adjustments a
        WHERE a.car_id = c.id
      ), 0),
    0
  ) AS outstanding
FROM public.cars c
WHERE c.status = 'sold'
  AND public.can_see_car_financials(c.id);

GRANT SELECT ON public.car_receivables TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
