import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;

    if (authError || !user) {
      throw redirect({ to: "/auth" });
    }

    const [
      { data: roles, error: rolesError },
      { data: staff, error: staffError },
      { data: permissions, error: permissionsError },
    ] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id),
      (supabase as any)
        .from("staff_access")
        .select("is_active")
        .eq("user_id", user.id)
        .maybeSingle(),
      (supabase as any)
        .from("staff_permissions")
        .select("can_view,can_create,can_edit,can_delete")
        .eq("user_id", user.id),
    ]);

    const isAdmin =
      !rolesError && !!roles?.some((r) => r.role === "admin");

    const hasPermission =
      !staffError &&
      !permissionsError &&
      staff?.is_active === true &&
      !!permissions?.some(
        (p: any) =>
          p.can_view === true ||
          p.can_create === true ||
          p.can_edit === true ||
          p.can_delete === true
      );

    if (!isAdmin && !hasPermission) {
      await supabase.auth.signOut();
      throw redirect({ to: "/auth" });
    }
  },
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
