import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type ThemePreset = "turquoise" | "blue" | "warm_gray";
export type ColorMode = "light" | "dark";

export type AppearancePreference = {
  user_id: string | null;
  theme_preset: ThemePreset;
  color_mode: ColorMode;
};

export const DEFAULT_APPEARANCE: AppearancePreference = {
  user_id: null,
  theme_preset: "turquoise",
  color_mode: "dark",
};

export const APPEARANCE_PRESETS = [
  {
    id: "turquoise" as const,
    title: "فیروزه‌ای",
    description: "ترکیب آشنای هیربد؛ مدرن و آرام",
    primary: "#0e9fa3",
    secondary: "#082f49",
    surface: "#e6f7f6",
  },
  {
    id: "blue" as const,
    title: "آبی سازمانی",
    description: "رسمی و حرفه‌ای",
    primary: "#2563eb",
    secondary: "#142c50",
    surface: "#eaf1ff",
  },
  {
    id: "warm_gray" as const,
    title: "خاکستری گرم",
    description: "خنثی و مینیمال با تأکید فیروزه‌ای",
    primary: "#0e9fa3",
    secondary: "#57534e",
    surface: "#f1ede7",
  },
];

export function appearanceQueryKey(userId: string | null) {
  return ["user-appearance", userId] as const;
}

function validPreset(value: unknown): ThemePreset {
  return value === "blue" || value === "warm_gray"
    ? value
    : "turquoise";
}

function validMode(value: unknown): ColorMode {
  return value === "light" ? "light" : "dark";
}

function localKey(userId: string | null) {
  return userId
    ? `hirbod-appearance:${userId}`
    : "hirbod-appearance:anonymous";
}

function readLocal(userId: string | null): AppearancePreference {
  if (typeof window === "undefined") {
    return { ...DEFAULT_APPEARANCE, user_id: userId };
  }

  try {
    const raw = window.localStorage.getItem(localKey(userId));
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        user_id: userId,
        theme_preset: validPreset(parsed.theme_preset),
        color_mode: validMode(parsed.color_mode),
      };
    }

    return {
      user_id: userId,
      theme_preset: "turquoise",
      color_mode: validMode(window.localStorage.getItem("hirbod-theme")),
    };
  } catch {
    return { ...DEFAULT_APPEARANCE, user_id: userId };
  }
}

export function applyAppearance(value: AppearancePreference) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = validMode(value.color_mode);
  root.dataset.palette = validPreset(value.theme_preset);
}

async function loadAppearance(
  userId: string | null
): Promise<AppearancePreference> {
  const local = readLocal(userId);

  if (!userId) {
    applyAppearance(local);
    return local;
  }

  const { data, error } = await (supabase as any)
    .from("user_appearance_preferences")
    .select("theme_preset,color_mode")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;

  const result: AppearancePreference = {
    user_id: userId,
    theme_preset: validPreset(data?.theme_preset ?? local.theme_preset),
    color_mode: validMode(data?.color_mode ?? local.color_mode),
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem(localKey(userId), JSON.stringify(result));
  }

  applyAppearance(result);
  return result;
}

export async function persistAppearance(
  value: AppearancePreference
): Promise<AppearancePreference> {
  // Anonymous users only save a browser-local preference.
  // Authenticated users save their preference to their own database row.
  const userId = value.user_id ?? null;

  const result: AppearancePreference = {
    user_id: userId,
    theme_preset: validPreset(value.theme_preset),
    color_mode: validMode(value.color_mode),
  };

  if (userId) {
    const { data, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    const sessionUserId = data.session?.user?.id ?? null;
    if (sessionUserId !== userId) {
      throw new Error("نشست ورود معتبر نیست؛ لطفاً دوباره وارد حساب شوید.");
    }

    const { error } = await (supabase as any)
      .from("user_appearance_preferences")
      .upsert({
        user_id: userId,
        theme_preset: result.theme_preset,
        color_mode: result.color_mode,
        updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });

    if (error) throw error;
  }

  if (typeof window !== "undefined") {
    const serialized = JSON.stringify(result);

    // Keep the user's own preference and a browser-local guest preference.
    // The guest copy lets the login page retain the last selected appearance.
    window.localStorage.setItem(localKey(userId), serialized);
    window.localStorage.setItem(localKey(null), serialized);
    window.localStorage.setItem("hirbod-theme", result.color_mode);
  }

  applyAppearance(result);
  return result;
}

export function useAppearance() {
  const [userId, setUserId] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;

    // getSession works without an authenticated user.
    // getUser can return "Auth session missing" on the login page.
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setUserId(null);
          return;
        }
        setUserId(data.session?.user?.id ?? null);
      })
      .catch(() => {
        if (alive) setUserId(null);
      });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUserId(session?.user?.id ?? null);
      }
    );

    return () => {
      alive = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const query = useQuery({
    queryKey: appearanceQueryKey(userId ?? null),
    queryFn: () => loadAppearance(userId ?? null),
    enabled: userId !== undefined,
    staleTime: 60_000,
    refetchOnMount: "always",
    retry: 1,
  });

  useEffect(() => {
    if (query.data) {
      applyAppearance(query.data);
    } else if (userId !== undefined) {
      applyAppearance(readLocal(userId));
    }
  }, [query.data, userId]);

  return query;
}
