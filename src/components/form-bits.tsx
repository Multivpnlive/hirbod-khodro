import type { ReactNode, SelectHTMLAttributes } from "react";
import { Label } from "@/components/ui/label";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function NativeSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    />
  );
}

export function DemoTag({ show }: { show: boolean }) {
  return show ? <span className="ms-1 rounded bg-warning/20 px-1.5 py-0.5 text-[10px]">نمونه</span> : null;
}

export function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "sold" ? "bg-success/15 text-success" : status === "reserved" ? "bg-warning/20" : "bg-primary/10 text-primary";
  const label = status === "sold" ? "فروخته‌شده" : status === "reserved" ? "رزرو" : "موجود";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}

export const num = (v: FormDataEntryValue | null) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
