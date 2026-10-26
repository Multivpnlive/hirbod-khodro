import { Link, Navigate, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { LayoutDashboard, Car, Users, Wallet, FileBarChart, User, LogOut } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, usePerms, type PermKey } from "@/lib/data";
import { Button } from "@/components/ui/button";

const adminNav = [
  { to: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
  { to: "/cars", label: "خودروها", icon: Car },
  { to: "/partners", label: "شرکا", icon: Users },
  { to: "/transactions", label: "تراکنش‌ها", icon: Wallet },
  { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const { perms } = usePerms();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const nav = me?.isAdmin
    ? [...adminNav]
    : [
        { to: "/dashboard", label: "داشبورد", icon: LayoutDashboard },
        { to: "/cars", label: "خودروها", icon: Car },
        ...(perms.view_all_partners ? [{ to: "/partners", label: "شرکا", icon: Users }] : []),
        { to: "/transactions", label: "تراکنش‌ها", icon: Wallet },
        { to: "/reports", label: "گزارش‌ها", icon: FileBarChart },
        { to: "/my", label: "حساب من", icon: User },
      ];

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
        <button onClick={signOut} aria-label="خروج"><LogOut className="size-5" /></button>
      </header>

      <main className="flex-1 min-w-0 p-4 md:p-8 pb-24 md:pb-8">
        {children}
      </main>

      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-20 bg-card border-t grid"
        style={{ gridTemplateColumns: `repeat(${nav.length}, minmax(0, 1fr))` }}
      >
        {nav.map((n) => (
          <Link
            key={n.to}
            to={n.to}
            className="flex flex-col items-center gap-1 py-2 text-[11px] text-muted-foreground"
            activeProps={{ className: "text-primary font-bold" }}
          >
            <n.icon className="size-5" />
            {n.label}
          </Link>
        ))}
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
