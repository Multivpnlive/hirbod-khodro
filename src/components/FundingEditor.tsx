import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NativeSelect, num } from "@/components/form-bits";
import { toman } from "@/lib/format";
import { todayIso } from "@/lib/jalali";
import { JalaliDateField } from "@/components/JalaliDateField";
import type { Partner } from "@/lib/data";

export type InvRow = { partner_id: string; amount: string };
export type ExpRow = { title: string; amount: string; date: string; description: string };

export const today = todayIso;

/** «سرمایه شرکا و هزینه‌ها» section used inside the new-car form. */
export function FundingEditor({
  partners, invs, setInvs, exps, setExps, purchase, allowInvestments = true,
}: {
  partners: Partner[];
  invs: InvRow[];
  setInvs: (r: InvRow[]) => void;
  exps: ExpRow[];
  setExps: (r: ExpRow[]) => void;
  purchase: number;
  allowInvestments?: boolean;
}) {
  const capital = invs.reduce((s, r) => s + num(r.amount), 0);
  const expTotal = exps.reduce((s, r) => s + num(r.amount), 0);
  const used = new Set(invs.map((r) => r.partner_id));
  return (
    <div className="col-span-2 space-y-3 rounded-lg border p-3">
      <div className="font-bold text-sm">سرمایه شرکا و هزینه‌ها</div>

      {allowInvestments && (
      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">سرمایه شرکا (تومان)</div>
        {invs.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <NativeSelect value={r.partner_id} onChange={(e) => setInvs(invs.map((x, j) => (j === i ? { ...x, partner_id: e.target.value } : x)))}>
              <option value="">انتخاب شریک</option>
              {partners.filter((p) => p.id === r.partner_id || !used.has(p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </NativeSelect>
            <Input placeholder="مبلغ" inputMode="numeric" value={r.amount} onChange={(e) => setInvs(invs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
            <Button type="button" variant="ghost" size="icon" aria-label="حذف" onClick={() => setInvs(invs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setInvs([...invs, { partner_id: "", amount: "" }])}><Plus className="size-4" /> افزودن شریک</Button>
      </div>
      )}

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground">هزینه‌های جانبی</div>
        {exps.map((r, i) => {
          const up = (k: keyof ExpRow, v: string) => setExps(exps.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
          return (
            <div key={i} className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-2">
              <Input placeholder="عنوان" value={r.title} onChange={(e) => up("title", e.target.value)} />
              <Input placeholder="مبلغ" inputMode="numeric" value={r.amount} onChange={(e) => up("amount", e.target.value)} />
              <JalaliDateField value={r.date} onChange={(v) => up("date", v)} />
              <div className="flex gap-1">
                <Input placeholder="توضیح" value={r.description} onChange={(e) => up("description", e.target.value)} />
                <Button type="button" variant="ghost" size="icon" aria-label="حذف" onClick={() => setExps(exps.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={() => setExps([...exps, { title: "", amount: "", date: today(), description: "" }])}><Plus className="size-4" /> افزودن هزینه</Button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div><div className="text-muted-foreground">مجموع سرمایه</div>{toman(capital)}</div>
        <div><div className="text-muted-foreground">مجموع هزینه‌ها</div>{toman(expTotal)}</div>
        <div><div className="text-muted-foreground">بهای تمام‌شده</div>{toman(purchase + expTotal)}</div>
      </div>
      <p className="text-[11px] text-muted-foreground">بهای تمام‌شده = قیمت خرید + هزینه‌ها. سرمایه شرکا منبع تأمین همین مبلغ است و دوباره شمرده نمی‌شود.</p>
    </div>
  );
}
