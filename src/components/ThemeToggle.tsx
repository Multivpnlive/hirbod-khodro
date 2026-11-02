import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  DEFAULT_APPEARANCE,
  appearanceQueryKey,
  applyAppearance,
  persistAppearance,
  useAppearance,
} from "@/lib/appearance";

export function ThemeToggle() {
  const queryClient = useQueryClient();
  const { data } = useAppearance();
  const [busy, setBusy] = useState(false);

  const current = data ?? DEFAULT_APPEARANCE;

  async function toggleTheme() {
    if (busy) return;

    const next = {
      ...current,
      color_mode: current.color_mode === "dark" ? "light" as const : "dark" as const,
    };

    setBusy(true);
    applyAppearance(next);

    try {
      const saved = await persistAppearance(next);
      queryClient.setQueryData(appearanceQueryKey(saved.user_id), saved);
    } catch (error) {
      applyAppearance(current);
      toast.error(
        error instanceof Error
          ? error.message
          : "ذخیره حالت نمایش ناموفق بود."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      className="hirbod-theme-toggle"
      onClick={toggleTheme}
      disabled={busy || !data}
      aria-label={current.color_mode === "dark"
        ? "فعال کردن حالت روشن"
        : "فعال کردن حالت تاریک"}
      title={current.color_mode === "dark"
        ? "تغییر به حالت روشن"
        : "تغییر به حالت تاریک"}
    >
      <span className="hirbod-theme-toggle__icon" aria-hidden="true">
        {current.color_mode === "dark" ? "☼" : "☾"}
      </span>
    </button>
  );
}
