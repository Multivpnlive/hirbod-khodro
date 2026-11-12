const ITEMS = [
] as const;

export function FeatureLinks() {
  return (
    <div className="mb-5 flex flex-wrap gap-2 rounded-xl border bg-card p-3" dir="rtl" aria-label="بخش‌های مالی">
      {ITEMS.map(([href, label]) => (
        <a key={href} href={href} className="rounded-lg border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted">
          {label} ←
        </a>
      ))}
    </div>
  );
}
