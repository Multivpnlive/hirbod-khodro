import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Car = Database["public"]["Tables"]["cars"]["Row"];
export type Partner = Database["public"]["Tables"]["partners"]["Row"];
export type Expense = Database["public"]["Tables"]["car_expenses"]["Row"];
export type Investment = Database["public"]["Tables"]["car_investments"]["Row"];
export type Txn = Database["public"]["Tables"]["transactions"]["Row"];
export type PartnerPermissions = Database["public"]["Tables"]["partner_permissions"]["Row"];

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return null;
      const [{ data: roles }, { data: staff }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
        (supabase as any).from("staff_access").select("staff_role,is_active,linked_partner_id").eq("user_id", u.user.id).maybeSingle(),
      ]);
      const isAdmin = !!roles?.some((r) => r.role === "admin");
      return {
        user: u.user,
        isAdmin,
        isStaff: !!staff,
        staffRole: staff?.staff_role ?? null,
        isActive: staff?.is_active !== false,
        linkedPartnerId: staff?.linked_partner_id ?? null,
      };
    },
  });
}

export type PermKey =
  | "view_all_cars"
  | "create_car"
  | "edit_car"
  | "add_expense"
  | "add_payment"
  | "view_transactions"
  | "manage_settlements"
  | "view_all_partners"
  | "view_customers"
  | "view_custody"
  | "view_receivables";
export type Perms = Record<PermKey, boolean>;

export const PERM_LABELS: { key: PermKey; label: string }[] = [
  { key: "view_all_cars", label: "مشاهده خودروها" },
  { key: "create_car", label: "ثبت خودروی جدید" },
  { key: "edit_car", label: "ویرایش خودرو و سرمایه‌ها" },
  { key: "add_expense", label: "ثبت و ویرایش هزینه" },
  { key: "add_payment", label: "ثبت پرداخت و تراکنش" },
  { key: "view_transactions", label: "مشاهده تراکنش‌ها" },
  { key: "manage_settlements", label: "مدیریت تسویه‌حساب‌ها" },
  { key: "view_all_partners", label: "مشاهده شرکا" },
  { key: "view_customers", label: "مشاهده مشتریان" },
  { key: "view_custody", label: "مشاهده انتقال وجه" },
  { key: "view_receivables", label: "مشاهده مطالبات فروش" },
];

const NO_PERMS: Perms = {
  view_all_cars: false,
  create_car: false,
  edit_car: false,
  add_expense: false,
  add_payment: false,
  view_transactions: false,
  manage_settlements: false,
  view_all_partners: false,
  view_customers: false,
  view_custody: false,
  view_receivables: false,
};

const ALL_PERMS: Perms = Object.fromEntries(
  Object.keys(NO_PERMS).map((key) => [key, true]),
) as Perms;

export type StaffResource =
  | "cars" | "partners" | "transactions" | "customers"
  | "receivables" | "fund_transfers";

export type StaffAction = "view" | "create" | "edit" | "delete";
type StaffAccessMap = Record<StaffResource, Record<StaffAction, boolean>>;

const STAFF_RESOURCES: StaffResource[] = [
  "cars", "partners", "transactions", "customers",
  "receivables", "fund_transfers",
];

function emptyStaffAccess(): StaffAccessMap {
  return Object.fromEntries(
    STAFF_RESOURCES.map((resource) => [
      resource,
      { view: false, create: false, edit: false, delete: false },
    ]),
  ) as StaffAccessMap;
}

export function usePerms() {
  const me = useMe();
  const isAdmin = !!me.data?.isAdmin;

  const q = useQuery({
    queryKey: ["my-perms"],
    enabled: !!me.data && !isAdmin,
    queryFn: async (): Promise<{ perms: Perms; staffAccess: StaffAccessMap }> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return { perms: NO_PERMS, staffAccess: emptyStaffAccess() };

      const { data: staff } = await (supabase as any)
        .from("staff_access")
        .select("is_active")
        .eq("user_id", u.user.id)
        .maybeSingle();

      if (staff) {
        if (!staff.is_active) {
          return { perms: NO_PERMS, staffAccess: emptyStaffAccess() };
        }

        const { data: rows, error } = await (supabase as any)
          .from("staff_permissions")
          .select("resource,can_view,can_create,can_edit,can_delete")
          .eq("user_id", u.user.id);

        if (error) throw error;

        const byResource = new Map<string, any>(
          (rows ?? []).map((row: any) => [String(row.resource), row] as [string, any]),
        );
        const get = (resource: string, action: string) =>
          Boolean(byResource.get(resource)?.[action]);

        const staffAccess = emptyStaffAccess();
        for (const resource of STAFF_RESOURCES) {
          staffAccess[resource] = {
            view: get(resource, "can_view"),
            create: get(resource, "can_create"),
            edit: get(resource, "can_edit"),
            delete: get(resource, "can_delete"),
          };
        }

        return {
          perms: {
            view_all_cars: get("cars", "can_view"),
            create_car: get("cars", "can_create"),
            edit_car: get("cars", "can_edit"),
            add_expense: get("cars", "can_create") || get("cars", "can_edit"),
            add_payment: get("transactions", "can_create"),
            view_transactions: get("transactions", "can_view"),
            manage_settlements: get("transactions", "can_edit"),
            view_all_partners: get("partners", "can_view"),
            view_customers: get("customers", "can_view"),
            view_custody: get("fund_transfers", "can_view"),
            view_receivables: get("receivables", "can_view"),
          },
          staffAccess,
        };
      }

      // Partner records are financial records only; they do not grant website access.
      return { perms: NO_PERMS, staffAccess: emptyStaffAccess() };
    },
  });

  return {
    isAdmin,
    perms: isAdmin ? ALL_PERMS : (q.data?.perms ?? NO_PERMS),
    can: (resource: StaffResource, action: StaffAction) =>
      isAdmin || !!q.data?.staffAccess[resource]?.[action],
    isLoading: me.isLoading || (!!me.data && !isAdmin && q.isLoading),
  };
}

/** Loads every table the signed-in user may read. RLS decides what comes back. Demo rows are always excluded. */
export function useAllData() {
  const q = useQuery({
    queryKey: ["all-data"],
    queryFn: async () => {
      const [cars, partners, expenses, investments, txns] = await Promise.all([
        supabase.from("cars").select("*").order("purchase_date", { ascending: false }),
        supabase.from("partners").select("*").order("created_at"),
        supabase.from("car_expenses").select("*").order("expense_date", { ascending: false }),
        supabase.from("car_investments").select("*"),
        supabase.from("transactions").select("*").order("txn_date", { ascending: false }),
      ]);
      const err = cars.error || partners.error || expenses.error || investments.error || txns.error;
      if (err) throw err;
      return {
        cars: cars.data!,
        partners: partners.data!,
        expenses: expenses.data!,
        investments: investments.data!,
        txns: txns.data!,
      };
    },
  });
  const f = <T extends { is_demo: boolean }>(a: T[] | undefined) => (a ?? []).filter((x) => !x.is_demo);
  return {
    ...q,
    cars: f(q.data?.cars),
    partners: f(q.data?.partners),
    expenses: f(q.data?.expenses),
    investments: f(q.data?.investments),
    txns: f(q.data?.txns),
  };
}

export function useMyShares() {
  return useQuery({
    queryKey: ["my-shares"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_car_shares");
      if (error) throw error;
      return data ?? [];
    },
  });
}
