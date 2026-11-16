import { Bell, CheckCheck } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export function NotificationBell() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="topbar-icon-button" aria-label="اعلان‌ها" title="اعلان‌ها">
          <Bell className="size-[18px]" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="notification-panel w-72 p-4" align="start" sideOffset={10} dir="rtl">
        <div className="flex items-start gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <CheckCheck className="size-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-bold">اعلان‌ها</h2>
            <p className="mt-1 text-xs leading-6 text-muted-foreground">
              در حال حاضر اعلان تازه‌ای برای نمایش وجود ندارد.
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
