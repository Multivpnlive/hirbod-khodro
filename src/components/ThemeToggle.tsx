import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, Palette } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DEFAULT_APPEARANCE,
  appearanceQueryKey,
  applyAppearance,
  persistAppearance,
  useAppearance,
} from "@/lib/appearance";

const themeOptions = [
  {
    id: "light",
    title: "روشن",
    description: "پریزم روشن",
    theme_preset: "turquoise" as const,
    color_mode: "light" as const,
    background: "linear-gradient(135deg, #eef0ff, #e4f5ff)",
    accent: "#6258e8",
  },
  {
    id: "dark",
    title: "تاریک",
    description: "حالت تیره",
    theme_preset: "turquoise" as const,
    color_mode: "dark" as const,
    background: "linear-gradient(135deg, #111827, #25334a)",
    accent: "#6be3e5",
  },
  {
    id: "blue",
    title: "آبی سازمانی",
    description: "زمینه آبی روشن",
    theme_preset: "blue" as const,
    color_mode: "light" as const,
    background: "linear-gradient(135deg, #e7efff, #f8fbff)",
    accent: "#2872e8",
  },
  {
    id: "warm_gray",
    title: "خاکستری گرم",
    description: "زمینه خنثی و گرم",
    theme_preset: "warm_gray" as const,
    color_mode: "light" as const,
    background: "linear-gradient(135deg, #e9e3da, #faf8f4)",
    accent: "#9c8065",
  },
] as const;

function selectedThemeId(themePreset: string, colorMode: string) {
  if (themePreset === "blue") return "blue";
  if (themePreset === "warm_gray") return "warm_gray";
  return colorMode === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  const queryClient = useQueryClient();
  const { data } = useAppearance();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const current = data ?? DEFAULT_APPEARANCE;
  const selectedId = selectedThemeId(current.theme_preset, current.color_mode);

  async function chooseTheme(option: (typeof themeOptions)[number]) {
    if (busy) return;

    const next = {
      ...current,
      theme_preset: option.theme_preset,
      color_mode: option.color_mode,
    };

    setBusy(true);
    applyAppearance(next);

    try {
      const saved = await persistAppearance(next);
      queryClient.setQueryData(appearanceQueryKey(saved.user_id), saved);
      setOpen(false);
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
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="theme-selector-trigger"
          disabled={busy || !data}
          aria-label="انتخاب پوسته"
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`پوسته فعلی: ${themeOptions.find((option) => option.id === selectedId)?.title ?? "روشن"}`}
        >
          <Palette className="size-[18px]" aria-hidden="true" />
          <span className="hidden sm:inline">پوسته</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="theme-selector-panel w-64 p-2" align="start" sideOffset={10} dir="rtl">
        <div className="px-2 pb-2 pt-1">
          <div className="text-sm font-bold">انتخاب پوسته</div>
          <div className="mt-0.5 text-xs text-muted-foreground">رنگ پس‌زمینه و فضای برنامه</div>
        </div>
        <div className="space-y-1">
          {themeOptions.map((option) => {
            const selected = selectedId === option.id;
            return (
              <button
                key={option.id}
                type="button"
                className={`theme-selector-option ${selected ? "is-selected" : ""}`}
                onClick={() => void chooseTheme(option)}
                disabled={busy}
                aria-pressed={selected}
              >
                <span className="theme-selector-preview" style={{ background: option.background }} aria-hidden="true">
                  <span style={{ background: option.accent }} />
                  <span />
                </span>
                <span className="min-w-0 flex-1 text-right">
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{option.description}</span>
                </span>
                {selected && <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Loads a saved appearance on routes that do not render the authenticated shell. */
export function AppearanceBootstrap() {
  useAppearance();
  return null;
}
