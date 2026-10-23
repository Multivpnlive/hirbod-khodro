import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  formatJalaliShort,
  isoToJalali,
  jalaliMonthLabel,
  jalaliMonthLength,
  jalaliToIso,
  parseIsoLocal,
  todayIso,
} from "@/lib/jalali";

const WEEKDAYS = ["ش", "ی", "د", "س", "چ", "پ", "ج"]; // شنبه تا جمعه

/**
 * انتخابگر تاریخ شمسی. مقدار خروجی همیشه ISO میلادی «YYYY-MM-DD» است تا
 * ساختار پایگاه داده و داده‌های فعلی بدون تغییر بمانند.
 * در فرم، مقدار از طریق input مخفی با همان name ارسال می‌شود.
 */
export function JalaliDateField({
  name,
  value,
  defaultValue,
  onChange,
  placeholder = "انتخاب تاریخ",
}: {
  name?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (iso: string) => void;
  placeholder?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const iso = controlled ? value! : inner;
  const [open, setOpen] = useState(false);

  const base = iso || todayIso();
  const init = isoToJalali(base);
  const [view, setView] = useState({ jy: init.jy, jm: init.jm });

  const set = (v: string) => {
    if (!controlled) setInner(v);
    onChange?.(v);
  };

  const move = (delta: number) => {
    let { jy, jm } = view;
    jm += delta;
    if (jm > 12) { jm = 1; jy += 1; }
    if (jm < 1) { jm = 12; jy -= 1; }
    setView({ jy, jm });
  };

  const days = useMemo(() => {
    const len = jalaliMonthLength(view.jy, view.jm);
    const first = jalaliToIso(view.jy, view.jm, 1);
    // getDay: 0=یکشنبه … 6=شنبه → شروع هفته از شنبه
    const offset = (parseIsoLocal(first).getDay() + 1) % 7;
    return { len, offset };
  }, [view]);

  const sel = iso ? isoToJalali(iso) : null;
  const todayJ = isoToJalali(todayIso());
  const faDay = new Intl.NumberFormat("fa-IR", { useGrouping: false });

  return (
    <div>
      {name && <input type="hidden" name={name} value={iso} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="h-9 w-full justify-start gap-2 font-normal">
            <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !iso && "text-muted-foreground")}>
              {iso ? formatJalaliShort(iso) : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3 pointer-events-auto" align="start" dir="rtl">
          <div className="flex items-center justify-between mb-2">
            <Button type="button" variant="ghost" size="icon" aria-label="ماه بعد" onClick={() => move(1)}>
              <ChevronRight className="size-4" />
            </Button>
            <div className="font-bold text-sm">{jalaliMonthLabel(view.jy, view.jm)}</div>
            <Button type="button" variant="ghost" size="icon" aria-label="ماه قبل" onClick={() => move(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {WEEKDAYS.map((w) => (
              <div key={w} className="text-[11px] text-muted-foreground py-1">{w}</div>
            ))}
            {Array.from({ length: days.offset }).map((_, i) => (
              <div key={"e" + i} />
            ))}
            {Array.from({ length: days.len }).map((_, i) => {
              const jd = i + 1;
              const isSel = sel && sel.jy === view.jy && sel.jm === view.jm && sel.jd === jd;
              const isToday = todayJ.jy === view.jy && todayJ.jm === view.jm && todayJ.jd === jd;
              return (
                <button
                  key={jd}
                  type="button"
                  onClick={() => { set(jalaliToIso(view.jy, view.jm, jd)); setOpen(false); }}
                  className={cn(
                    "h-8 rounded-md text-sm tabular-nums hover:bg-accent",
                    isSel && "bg-primary text-primary-foreground hover:bg-primary",
                    !isSel && isToday && "border border-primary",
                  )}
                >
                  {faDay.format(jd)}
                </button>
              );
            })}
          </div>
          <div className="flex justify-between mt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => { const t = todayIso(); set(t); const j = isoToJalali(t); setView({ jy: j.jy, jm: j.jm }); setOpen(false); }}>
              امروز
            </Button>
            {iso && (
              <Button type="button" variant="ghost" size="sm" onClick={() => { set(""); setOpen(false); }}>
                پاک کردن
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
