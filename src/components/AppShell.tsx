import { Link, Navigate, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LayoutDashboard, Car, Users, Wallet, FileBarChart, User, LogOut, MoreHorizontal, UserRound, ArrowLeftRight, ReceiptText, HandCoins, X } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, usePerms, type PermKey } from "@/lib/data";
import { Button } from "@/components/ui/button";

const coreNav = [
  { to: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
  { to: "/cars", label: "خودروها", icon: Car },
  { to: "/partners", label: "شرکا", icon: Users },
  { to: "/transactions", label: "تراکنش‌ها", icon: Wallet },
  { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
] as const;
const featureNav = [
  { to: "/customers", label: "مشتریان", icon: UserRound },
  { to: "/hawalas", label: "حواله‌ها", icon: ReceiptText },
  { to: "/receivables", label: "مطالبات فروش", icon: HandCoins },
  { to: "/fund-transfers", label: "انتقال وجه", icon: ArrowLeftRight },
  { to: "/brokerage", label: "کارگزاری", icon: Wallet },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { perms } = usePerms();
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const qc = useQueryClient();
  const navigate = useNavigate();
  const nav = me?.isAdmin
    ? [...coreNav, ...featureNav]
    : [
        { to: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
        { to: "/cars", label: "خودروها", icon: Car },
        ...(perms.view_all_partners ? [{ to: "/partners", label: "شرکا", icon: Users }] : []),
        { to: "/transactions", label: "تراکنش‌ها", icon: Wallet },
        { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
        { to: "/my", label: "حساب من", icon: User },
        ...featureNav,
      ];
  const mobileNav = nav.filter((n) => ["/dashboard", "/cars", "/partners", "/transactions"].includes(n.to)).slice(0, 4);
  const showMoreActive = featureNav.some((n) => pathname.startsWith(n.to));

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden md:flex md:w-64 shrink-0 flex-col bg-sidebar text-sidebar-foreground p-5 gap-6 sticky top-0 h-screen">
        <div>
          <div className="text-xl font-extrabold">هیربد خودرو</div>
          <div className="text-xs opacity-70 mt-1">{me?.isAdmin ? "مدیر اصلی" : "شریک"}</div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm hover:bg-sidebar-accent"
              activeProps={{ className: "bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary" }}
            >
              <n.icon className="size-4" />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto space-y-4">
          <div className="text-xs opacity-70 truncate" dir="ltr">{me?.user.email}</div>
          <Button variant="secondary" size="sm" className="w-full" onClick={signOut}>
            <LogOut className="size-4" /> خروج
          </Button>
        </div>
      </aside>

      <header className="md:hidden flex items-center justify-between bg-sidebar text-sidebar-foreground px-4 py-3 sticky top-0 z-20">
        <div className="font-extrabold">هیربد خودرو</div>
        <button onClick={signOut} aria-label="خروج" className="rounded-lg p-2 hover:bg-sidebar-accent"><LogOut className="size-5" /></button>
      </header>

      <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8">
        {children}
      </main>

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

/** Gates a page behind admin role or a specific partner permission. */
export function PermOnly({ perm, children }: { perm?: PermKey; children: ReactNode }) {
  const { isAdmin, perms, isLoading } = usePerms();
  if (isLoading) return <div className="text-muted-foreground">در حال بارگذاری…</div>;
  if (!isAdmin && !(perm && perms[perm])) return <Navigate to="/my" replace />;
  return <>{children}</>;
}
