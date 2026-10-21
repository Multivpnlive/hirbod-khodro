import { createFileRoute, Link } from "@tanstack/react-router";
import { Car, ShieldCheck, PieChart, Users } from "lucide-react";
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
  return (
    <div className="min-h-screen bg-hero text-primary-foreground">
      <div className="mx-auto max-w-5xl px-6 py-16 md:py-28">
        <div className="text-sm opacity-80">هیربد خودرو</div>
        <h1 className="mt-4 text-4xl md:text-6xl font-black leading-tight">
          حساب هر معامله،
          <br />
          <span className="text-accent">سهم هر شریک.</span>
        </h1>
        <p className="mt-6 max-w-xl opacity-85 leading-8">
          خریدوفروش خودرو، سرمایه‌گذاری و تسویه‌حساب شرکا را یک‌جا مدیریت کنید؛ سود و زیان هر خودرو خودکار محاسبه و بین شرکا تقسیم می‌شود.
        </p>
        <div className="mt-8 flex gap-3">
          <Button asChild size="lg" className="bg-accent text-accent-foreground hover:bg-accent/90">
            <Link to="/auth">ورود / ثبت‌نام</Link>
          </Button>
        </div>
        <div className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div key={f.t} className="rounded-xl border border-primary-foreground/15 bg-primary-foreground/5 p-5">
              <f.icon className="size-6 text-accent" />
              <div className="mt-3 font-bold">{f.t}</div>
              <div className="mt-1 text-sm opacity-75">{f.d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
