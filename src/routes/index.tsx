import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, ShieldCheck, PieChart, Users } from "lucide-react";
import { useEffect } from "react";
import { useBranding } from "@/lib/branding";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "هیربد خودرو | مدیریت خریدوفروش خودرو و حسابداری شرکا" },
      { name: "description", content: "ثبت معاملات خودرو، سرمایه شرکا، تقسیم خودکار سود و گزارش‌های مالی." },
      { property: "og:title", content: "هیربد خودرو" },
      { property: "og:description", content: "مدیریت خریدوفروش خودرو، سرمایه‌گذاری و حسابداری شرکا." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const features = [
  { icon: Car, t: "ثبت خودرو و معامله", d: "قیمت خرید، هزینه‌ها، فروش و وضعیت" },
  { icon: Users, t: "سرمایه چند شریک", d: "سهم هر شریک در هر معامله" },
  { icon: PieChart, t: "تقسیم خودکار سود", d: "متناسب با سرمایه در همان معامله" },
  { icon: ShieldCheck, t: "دسترسی امن", d: "هر شریک فقط حساب خودش را می‌بیند" },
];

function Index() {
  const { branding } = useBranding();
  useEffect(() => {
    document.title = branding.app_name;
  }, [branding.app_name]);
  return (
    <div className="hero-landing min-h-screen">
      <div className="mx-auto max-w-5xl px-6 py-16 md:py-28">
        <div className="hero-eyebrow flex items-center gap-3 text-sm">{branding.logo_url && <img src={branding.logo_url} alt="" className="size-10 rounded-lg bg-white object-contain p-1" />}{branding.company_name}</div>
        <h1 className="hero-title mt-4 text-4xl md:text-6xl font-black leading-tight">
          حساب هر معامله،
          <br />
          <span className="hero-accent">سهم هر شریک.</span>
        </h1>
        <p className="hero-copy mt-6 max-w-xl leading-8">
          خریدوفروش خودرو، سرمایه‌گذاری و تسویه‌حساب شرکا را یک‌جا مدیریت کنید؛ سود و زیان هر خودرو خودکار محاسبه و بین شرکا تقسیم می‌شود.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg" className="hero-cta">
            <Link to="/auth">ورود / ثبت‌نام</Link>
          </Button>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.t} className="hero-feature-card rounded-xl border p-5">
              <f.icon className="hero-feature-icon size-6" />
              <div className="hero-feature-title mt-3 font-bold">{f.t}</div>
              <div className="hero-feature-copy mt-1 text-sm">{f.d}</div>
            </div>
          ))}
        </div>
        {(branding.contact_phone || branding.contact_email || branding.website) && (
          <footer className="mt-12 flex flex-wrap gap-4 text-sm text-muted-foreground">
            {branding.contact_phone && <span>تماس: {branding.contact_phone}</span>}
            {branding.contact_email && <span dir="ltr">{branding.contact_email}</span>}
            {branding.website && <a href={branding.website} target="_blank" rel="noreferrer" dir="ltr">{branding.website}</a>}
          </footer>
        )}
      </div>
    </div>
  );
}
