import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ImagePlus, Save, Check } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { useMe } from "@/lib/data";
import { useBranding, DEFAULT_BRANDING } from "@/lib/branding";
import { saveAppBranding } from "./branding.functions";
import {
  APPEARANCE_PRESETS,
  appearanceQueryKey,
  DEFAULT_APPEARANCE,
  applyAppearance,
  persistAppearance,
  useAppearance,
  type ThemePreset,
} from "@/lib/appearance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/branding")({
  head: () => ({ meta: [{ title: "تنظیمات ظاهر" }] }),
  component: AppearanceSettingsPage,
});

function AppearanceSettingsPage() {
  const me = useMe();
  const isAdmin = !!me.data?.isAdmin;
  const { branding, error: brandingError } = useBranding();
  const appearanceQuery = useAppearance();
  const appearance = appearanceQuery.data ?? DEFAULT_APPEARANCE;
  const queryClient = useQueryClient();

  const [selectedPreset, setSelectedPreset] = useState<ThemePreset>("turquoise");

  const [appName, setAppName] = useState("هیربد خودرو");
  const [companyName, setCompanyName] = useState("هیربد خودرو");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);

  useEffect(() => {
    if (appearanceQuery.data) {
      setSelectedPreset(appearanceQuery.data.theme_preset);
    }
  }, [appearanceQuery.data?.theme_preset]);

  useEffect(() => {
    if (!branding) return;
    setAppName(branding.app_name);
    setCompanyName(branding.company_name);
    setContactPhone(branding.contact_phone ?? "");
    setContactEmail(branding.contact_email ?? "");
    setWebsite(branding.website ?? "");
  }, [branding]);

  useEffect(() => {
    applyAppearance({
      ...appearance,
      theme_preset: selectedPreset,
    });
  }, [selectedPreset, appearance.color_mode, appearance.user_id]);

  const appearanceMutation = useMutation({
    mutationFn: () => persistAppearance({
      user_id: appearance.user_id,
      theme_preset: selectedPreset,
      color_mode: appearance.color_mode,
    }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(appearanceQueryKey(saved.user_id), saved);
      toast.success("تم شخصی شما ذخیره شد.");
    },
    onError: (error) => toast.error(
      error instanceof Error ? error.message : "ذخیره تم ناموفق بود."
    ),
  });

  const brandMutation = useMutation({
    mutationFn: () => saveAppBranding({
      data: {
        appName,
        companyName,
        primaryColor: branding?.primary_color ?? DEFAULT_BRANDING.primary_color,
        secondaryColor: branding?.secondary_color ?? DEFAULT_BRANDING.secondary_color,
        contactPhone,
        contactEmail,
        website,
        logoDataUrl,
        removeLogo,
      },
    }),
    onSuccess: async () => {
      toast.success("مشخصات مجموعه ذخیره شد.");
      setLogoDataUrl(null);
      setRemoveLogo(false);
      await queryClient.invalidateQueries({ queryKey: ["app-branding"] });
    },
    onError: (error) => toast.error(
      error instanceof Error ? error.message : "ذخیره مشخصات ناموفق بود."
    ),
  });

  if (me.isLoading) {
    return <div className="p-8">در حال بررسی دسترسی…</div>;
  }

  function chooseLogo(file?: File) {
    if (!file) return;

    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      toast.error("فرمت مجاز لوگو PNG، JPG یا WebP است.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      toast.error("حجم لوگو باید حداکثر ۲ مگابایت باشد.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(String(reader.result));
      setRemoveLogo(false);
    };
    reader.onerror = () => toast.error("خواندن فایل لوگو ناموفق بود.");
    reader.readAsDataURL(file);
  }

  const previewLogo = logoDataUrl || (!removeLogo ? branding?.logo_url : null);

  return (
    <div dir="rtl" className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="تنظیمات ظاهر" />

      <section className="card-elevated space-y-4 p-5 sm:p-7">
        <div>
          <h2 className="text-lg font-bold">تم شخصی من</h2>
          {isAdmin && (
            <p className="mt-1 text-sm leading-7 text-muted-foreground">
              تنظیمات ظاهر برای حساب شما ذخیره می‌شود.
            </p>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {APPEARANCE_PRESETS.map((preset) => {
            const selected = selectedPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() => setSelectedPreset(preset.id)}
                className={`appearance-preset-card rounded-xl border p-4 text-right transition ${
                  selected ? "appearance-preset-selected" : "hover:border-primary/60"
                }`}
                aria-pressed={selected}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="font-bold">{preset.title}</span>
                  {selected && <Check className="size-5 text-primary" />}
                </div>
                <div className="flex gap-2">
                  <span className="h-8 flex-1 rounded-md" style={{ background: preset.primary }} />
                  <span className="h-8 flex-1 rounded-md" style={{ background: preset.secondary }} />
                  <span className="h-8 flex-1 rounded-md border" style={{ background: preset.surface }} />
                </div>
                {isAdmin && (
                  <p className="mt-3 text-xs leading-6 text-muted-foreground">
                    {preset.description}
                  </p>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-4">
          {isAdmin && (
            <span className="text-xs text-muted-foreground">
              تم انتخابی: {APPEARANCE_PRESETS.find(p => p.id === selectedPreset)?.title}
            </span>
          )}
          <Button
            onClick={() => appearanceMutation.mutate()}
            disabled={appearanceMutation.isPending || appearanceQuery.isLoading}
          >
            <Save className="size-4" />
            {appearanceMutation.isPending ? "در حال ذخیره…" : "ذخیره تم شخصی"}
          </Button>
        </div>
      </section>

      {isAdmin && (
        <section className="card-elevated space-y-5 p-5 sm:p-7">
          <div>
            <h2 className="text-lg font-bold">نام و برند مجموعه</h2>
            <p className="mt-1 text-sm leading-7 text-muted-foreground">
              این مشخصات برای همه کاربران همین نصب نمایش داده می‌شود.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {previewLogo ? (
              <img src={previewLogo} alt="پیش‌نمایش لوگو"
                className="size-16 rounded-xl border bg-white object-contain p-1" />
            ) : (
              <div className="grid size-16 place-items-center rounded-xl border bg-muted">
                <Building2 className="size-8 text-muted-foreground" />
              </div>
            )}
            <div>
              <h3 className="font-bold">{companyName || "نام شرکت"}</h3>
              <p className="text-sm text-muted-foreground">{appName || "نام نرم‌افزار"}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand-app-name">نام نرم‌افزار</Label>
              <Input id="brand-app-name" value={appName} maxLength={80}
                onChange={e => setAppName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-company-name">نام شرکت یا مجموعه</Label>
              <Input id="brand-company-name" value={companyName} maxLength={120}
                onChange={e => setCompanyName(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <Label>لوگوی اختصاصی مجموعه</Label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-4 py-2 text-sm hover:bg-muted">
                <ImagePlus className="size-4" />
                انتخاب فایل لوگو
                <input type="file" accept="image/png,image/jpeg,image/webp"
                  className="hidden" onChange={e => chooseLogo(e.target.files?.[0])} />
              </label>
              {branding?.logo_url && (
                <Button type="button" variant="outline" onClick={() => {
                  setLogoDataUrl(null);
                  setRemoveLogo(true);
                }}>
                  حذف لوگو
                </Button>
              )}
            </div>
            <p className="text-xs leading-6 text-muted-foreground">
              PNG، JPG یا WebP؛ حداکثر حجم ۲ مگابایت.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="brand-phone">شماره تماس</Label>
              <Input id="brand-phone" dir="ltr" value={contactPhone}
                onChange={e => setContactPhone(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="brand-email">ایمیل تماس</Label>
              <Input id="brand-email" type="email" dir="ltr" value={contactEmail}
                onChange={e => setContactEmail(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand-website">وب‌سایت</Label>
            <Input id="brand-website" dir="ltr" placeholder="https://example.com"
              value={website} onChange={e => setWebsite(e.target.value)} />
          </div>

          {brandingError && (
            <p className="text-sm text-destructive">
              دریافت مشخصات برند با مشکل مواجه شد.
            </p>
          )}

          <div className="flex justify-end border-t pt-4">
            <Button
              onClick={() => brandMutation.mutate()}
              disabled={brandMutation.isPending ||
                appName.trim().length < 2 || companyName.trim().length < 2}
            >
              <Save className="size-4" />
              {brandMutation.isPending ? "در حال ذخیره…" : "ذخیره مشخصات مجموعه"}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
