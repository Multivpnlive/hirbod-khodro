#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="${APP_DIR:-/opt/hirbod/app}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
BACKUP_DIR="/root/hirbod-backup/pre-feature-pack"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="$BACKUP_DIR/hirbod-before-0006-0009-$STAMP.dump"
METRICS_BEFORE="$BACKUP_DIR/metrics-before-$STAMP.txt"
METRICS_AFTER="$BACKUP_DIR/metrics-after-$STAMP.txt"

if [[ ! -f "$APP_DIR/drizzle/migrations/0006_custody_and_customer_scoping.sql" ]]; then
  echo "Migration files were not found at $APP_DIR. Pull the feature code first." >&2
  exit 1
fi
if ! docker ps --format '{{.Names}}' | grep -Fxq "$DB_CONTAINER"; then
  echo "Database container '$DB_CONTAINER' is not running. No migration was applied." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

metrics() {
  docker exec -i -u postgres "$DB_CONTAINER" psql -X -U postgres -d postgres -At -F '|' -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'cars_count', COUNT(*) FROM public.cars;
SELECT 'cars_purchase_sum', COALESCE(SUM(purchase_price),0) FROM public.cars;
SELECT 'cars_sale_sum', COALESCE(SUM(sale_price),0) FROM public.cars;
SELECT 'partners_count', COUNT(*) FROM public.partners;
SELECT 'transactions_count', COUNT(*) FROM public.transactions;
SELECT 'transactions_sum', COALESCE(SUM(amount),0) FROM public.transactions;
SELECT 'investments_count', COUNT(*) FROM public.car_investments;
SELECT 'investments_sum', COALESCE(SUM(amount),0) FROM public.car_investments;
SELECT 'expenses_count', COUNT(*) FROM public.car_expenses;
SELECT 'expenses_sum', COALESCE(SUM(amount),0) FROM public.car_expenses;
SQL
}

echo "===== Full database backup ====="
docker exec -u postgres "$DB_CONTAINER" pg_dump -U postgres -d postgres -Fc > "$BACKUP"
test -s "$BACKUP"
docker exec -i -u postgres "$DB_CONTAINER" pg_restore -l < "$BACKUP" >/dev/null
chmod 600 "$BACKUP"
echo "Backup verified: $BACKUP"

echo "===== Capture existing counts and financial totals ====="
metrics > "$METRICS_BEFORE"
cat "$METRICS_BEFORE"

for migration in \
  0006_custody_and_customer_scoping.sql \
  0007_hawalas_and_conversion.sql \
  0008_brokerage_extensions.sql \
  0009_fine_grained_permissions.sql
do
  echo "===== Applying $migration ====="
  docker exec -i -u postgres "$DB_CONTAINER" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 < "$APP_DIR/drizzle/migrations/$migration"
done

echo "===== Verify existing records and control totals ====="
metrics > "$METRICS_AFTER"
if ! diff -u "$METRICS_BEFORE" "$METRICS_AFTER"; then
  echo "ERROR: Existing row counts or control totals changed. Backup remains at $BACKUP. Do not repeat migrations or restore blindly." >&2
  exit 2
fi

docker exec -i -u postgres "$DB_CONTAINER" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 <<'SQL'
NOTIFY pgrst, 'reload schema';
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public'
AND table_name IN ('customers','customer_access','sale_receipts','sale_adjustments','brokerage_deals','commission_splits','fund_transfers','hawalas','hawala_investments','hawala_sales','brokerage_costs')
ORDER BY table_name;
SQL

echo "All migrations 0006-0009 applied; original counts and control totals match."
echo "Verified backup: $BACKUP"
echo "No build/restart was done by this script. After this, run:"
echo "  cd $APP_DIR && NITRO_PRESET=node-server npm run build && systemctl restart hirbod-app"
