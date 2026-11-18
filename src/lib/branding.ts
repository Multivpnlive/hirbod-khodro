import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AppBranding = {
  app_name: string;
  company_name: string;
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  contact_phone: string | null;
  contact_email: string | null;
  website: string | null;
};

export const DEFAULT_BRANDING: AppBranding = {
  app_name: "هیربد خودرو",
  company_name: "هیربد خودرو",
  logo_url: null,
  primary_color: "#0e8790",
  secondary_color: "#082f49",
  contact_phone: null,
  contact_email: null,
  website: null,
};

function publicLogoPath(path: string): string {
  return `/storage/v1/object/public/branding-assets/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function useBranding() {
  const query = useQuery({
    queryKey: ["app-branding"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("app_branding")
        .select("app_name,company_name,logo_url,logo_path,primary_color,secondary_color,contact_phone,contact_email,website")
        .eq("id", 1)
        .maybeSingle();

      if (error) throw error;
      return {
        ...DEFAULT_BRANDING,
        ...(data ?? {}),
        // Older saves stored the server-only 127.0.0.1 URL. Always render
        // through the current installation's same-origin public storage path.
        logo_url: data?.logo_path ? publicLogoPath(data.logo_path) : data?.logo_url ?? null,
      } as AppBranding;
    },
    staleTime: 60_000,
    retry: 1,
  });

  const branding = query.data ?? DEFAULT_BRANDING;

  return {
    branding,
    isLoading: query.isLoading,
    error: query.error,
  };
}
