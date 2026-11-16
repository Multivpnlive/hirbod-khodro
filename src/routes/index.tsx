import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, ShieldCheck, PieChart, Users } from "lucide-react";
import { useEffect } from "react";
import { useBranding } from "@/lib/branding";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_VERSION } from "@/lib/app-meta";
import { InstallAppButton } from "@/components/ProgressiveWebApp";

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
    <div className="hero-landing relative z-[1] min-h-screen">
      <header className="public-topbar mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <img src={branding.logo_url || "/hirbod-favicon.svg"} alt="" className="size-10 rounded-xl border border-border bg-card object-contain p-1" />
          <div className="min-w-0"><div className="truncate text-sm font-extrabold">{branding.app_name}</div><div className="truncate text-[11px] text-muted-foreground">{branding.company_name}</div></div>
        </div>
        <div className="flex shrink-0 items-center gap-2"><ThemeToggle /><InstallAppButton /><Button asChild variant="outline" size="sm"><Link to="/auth">ورود</Link></Button></div>
      </header>
      <div className="mx-auto max-w-7xl px-5 pb-14 pt-10 sm:px-8 md:pb-20 md:pt-16">
        <section className="public-hero-panel relative overflow-hidden rounded-[2rem] border p-7 sm:p-10 md:p-16">
          <div className="public-hero-orbit public-hero-orbit-one" aria-hidden="true" />
          <div className="public-hero-orbit public-hero-orbit-two" aria-hidden="true" />
          <div className="relative z-10 max-w-3xl">
        <div className="hero-eyebrow flex items-center gap-3 text-sm">راهکار یکپارچه برای مدیریت کسب‌وکار</div>
        <h1 className="hero-title mt-5 text-4xl md:text-6xl font-black leading-tight">
          حساب هر معامله،
          <br />
          <span className="hero-accent">سهم هر شریک.</span>
        </h1>
        <p className="hero-copy mt-6 max-w-xl leading-8">
          خریدوفروش خودرو، سرمایه‌گذاری و تسویه‌حساب شرکا را یک‌جا مدیریت کنید؛ سود و زیان هر خودرو خودکار محاسبه و بین شرکا تقسیم می‌شود.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg" className="hero-cta">
            <Link to="/auth">ورود به سامانه</Link>
          </Button>
        </div>
          </div>
        </section>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.t} className="hero-feature-card rounded-2xl border p-5">
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
        <footer className="public-release-note mt-10 flex items-center justify-between gap-4 border-t pt-5 text-xs text-muted-foreground"><span>{branding.company_name}</span><span>نسخه {APP_VERSION}</span></footer>
      </div>
    </div>
  );
}
