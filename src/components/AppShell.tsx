import { Link, Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LayoutDashboard, Car, Database, Users, Wallet, FileBarChart, LogOut, MoreHorizontal, UserRound, ArrowLeftRight, HandCoins, X, Settings, Palette, Boxes } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, usePerms, type PermKey } from "@/lib/data";
import { useBranding } from "@/lib/branding";
import { NotificationBell } from "@/components/NotificationBell";
import { ThemeToggle } from "@/components/ThemeToggle";
import { APP_RELEASE_DATE, APP_RELEASE_DATE_LABEL, APP_VERSION } from "@/lib/app-meta";
import { InstallAppButton } from "@/components/ProgressiveWebApp";

const coreNav = [
  { to: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
  { to: "/cars", label: "خودروها", icon: Car },
  { to: "/partners", label: "شرکا", icon: Users },
  { to: "/transactions", label: "تراکنش‌ها", icon: Wallet },
  { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
] as const;
const accountNav = [
  { to: "/branding", label: "تنظیمات ظاهر", icon: Palette },
  { to: "/account", label: "حساب کاربری", icon: Settings },
] as const;
const featureNav = [
  { to: "/customers", label: "مشتریان", icon: UserRound },
  { to: "/receivables", label: "مطالبات فروش", icon: HandCoins },
  { to: "/fund-transfers", label: "انتقال وجه", icon: ArrowLeftRight },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { branding } = useBranding();
  const { perms } = usePerms();
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const userName = String(me?.user.user_metadata?.full_name ?? me?.user.email?.split("@")[0] ?? "کاربر");
  const roleLabel = me?.isAdmin ? "مدیر اصلی" : me?.staffRole === "finance_manager" ? "مدیر مالی" : me?.staffRole === "sales" ? "فروشنده" : me?.staffRole === "limited" ? "کاربر محدود" : "شریک مالی";
  const staffFeatureNav = featureNav.filter((item) => {
    if (item.to === "/customers") return perms.view_customers;
    if (item.to === "/receivables") return perms.view_receivables;
    if (item.to === "/fund-transfers") return perms.view_custody;
    return false;
  });
  const hasAnyAccess = Object.values(perms).some(Boolean);
  const nav = me?.isAdmin
    ? [...coreNav, ...featureNav, { to: "/users", label: "مدیریت کاربران", icon: Users }, { to: "/backup", label: "مدیریت پشتیبان‌گیری", icon: Database }, ...accountNav]
    : [
        ...(hasAnyAccess ? [{ to: "/dashboard", label: "داشبورد", icon: LayoutDashboard }] : []),
        ...((perms.view_all_cars || perms.create_car || perms.edit_car) ? [{ to: "/cars", label: "خودروها", icon: Car }] : []),
        ...(perms.view_all_partners ? [{ to: "/partners", label: "شرکا", icon: Users }] : []),
        ...((perms.view_transactions || perms.add_payment || perms.manage_settlements) ? [{ to: "/transactions", label: "تراکنش‌ها", icon: Wallet }] : []),
        ...(hasAnyAccess ? [{ to: "/reports", label: "گزارش‌ها", icon: FileBarChart }] : []),
        ...staffFeatureNav,
        ...accountNav,
      ];
  const desktopNav = nav.filter((n) => n.to !== "/account");
  const mobileNav = nav.filter((n) => ["/dashboard", "/cars", "/partners", "/transactions"].includes(n.to)).slice(0, 4);
  const showMoreActive = [...featureNav, ...accountNav].some((n) => pathname.startsWith(n.to));

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="app-shell relative z-[1] min-h-screen">
      <header className="app-topbar sticky top-0 z-40 h-16">
        <div className="mx-auto flex h-full items-center justify-between gap-3 px-3 sm:px-5 lg:px-7" dir="rtl">
          <div className="flex min-w-0 items-center gap-3">
            <span className="app-topbar-mark" aria-hidden="true">
              {branding.logo_url ? <img src={branding.logo_url} alt="" className="size-8 rounded-lg object-contain" /> : <Boxes className="size-5" />}
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-extrabold sm:text-base">{branding.app_name}</div>
              <div className="hidden text-[11px] text-muted-foreground sm:block">سامانه مدیریت خودرو و امور مالی</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:gap-3" dir="ltr">
            <Link to="/account" className="flex min-w-0 items-center gap-2 rounded-xl px-1.5 py-1 hover:bg-accent/70" dir="rtl" aria-label="حساب کاربری">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                {userName.trim().slice(0, 1) || <UserRound className="size-4" />}
              </span>
              <div className="hidden max-w-40 sm:block">
                <div className="truncate text-xs font-bold">{userName}</div>
                <div className="truncate text-[10px] text-muted-foreground">{roleLabel}</div>
              </div>
            </Link>
            <div className="flex items-center gap-1.5">
              <NotificationBell />
              <ThemeToggle />
              <InstallAppButton />
            </div>
            <button type="button" onClick={signOut} aria-label="خروج" title="خروج" className="topbar-icon-button">
              <LogOut className="size-[18px]" />
            </button>
          </div>
        </div>
      </header>

      <div className="md:flex">
        <aside className="hidden md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground px-4 py-5 gap-4">
          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
            {desktopNav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-sidebar-accent"
                activeProps={{ className: "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary" }}
              >
                <n.icon className="size-4" />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="mt-auto border-t border-sidebar-border pt-4">
            <div className="sidebar-release-card">
              <img
                src={branding.logo_url || "/hirbod-favicon.svg"}
                alt={`لوگوی ${branding.company_name}`}
                className="sidebar-release-logo"
              />
              <div className="mt-2 text-xs font-extrabold">نسخه {APP_VERSION}</div>
              <time className="mt-1 block text-[10px] opacity-70" dateTime={APP_RELEASE_DATE}>
                انتشار {APP_RELEASE_DATE_LABEL}
              </time>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 p-4 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMoreOpen(false)}>
          <section className="mobile-more-panel absolute bottom-0 inset-x-0 rounded-t-2xl border-t p-4 pb-24" onClick={(event) => event.stopPropagation()} dir="rtl" aria-label="سایر بخش‌ها">
            <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-lg">بخش‌های دیگر</h2><button onClick={() => setMoreOpen(false)} className="rounded-lg p-2" aria-label="بستن"><X className="size-5" /></button></div>
            <div className="grid grid-cols-2 gap-2">
              {nav.filter((n) => !mobileNav.some((m) => m.to === n.to)).map((n) => (
                <Link key={n.to} to={n.to} onClick={() => setMoreOpen(false)} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${pathname.startsWith(n.to) ? "mobile-more-active" : ""}`}>
                  <n.icon className="size-5" />{n.label}
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
      <nav className="mobile-bottom-nav md:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-5 border-t" dir="rtl">
        {mobileNav.map((n) => (
          <Link key={n.to} to={n.to} className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground" activeProps={{ className: "mobile-nav-active font-bold" }}>
            <n.icon className="size-5" />{n.label}
          </Link>
        ))}
        <button type="button" onClick={() => setMoreOpen((open) => !open)} className={`flex flex-col items-center gap-1 py-2 text-[11px] ${showMoreActive || moreOpen ? "mobile-nav-active font-bold" : "text-muted-foreground"}`} aria-expanded={moreOpen}>
          <MoreHorizontal className="size-5" />بیشتر
        </button>
      </nav>
    </div>
  );
}

export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-6">
      <h1 className="text-2xl font-extrabold">{title}</h1>
      {action}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" | undefined }) {
  return (
    <div className="card-elevated p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-2 text-lg md:text-xl font-bold ${tone === "pos" ? "text-success" : tone === "neg" ? "text-destructive" : ""}`}>
        {value}
      </div>
    </div>
  );
}

/** Gates a page behind admin role or the relevant staff permission. */
export function PermOnly({ perm, children }: { perm?: PermKey; children: ReactNode }) {
  const { isAdmin, perms, isLoading } = usePerms();
  if (isLoading) return <div className="text-muted-foreground">در حال بارگذاری…</div>;
  if (!isAdmin && !(perm && perms[perm])) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}
