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
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      const isAdmin = !!roles?.some((r) => r.role === "admin");
      return { user: u.user, isAdmin };
    },
  });
}

export type PermKey =
  | "view_all_cars"
  | "create_car"
  | "edit_car"
  | "add_expense"
  | "add_payment"
  | "manage_settlements"
  | "view_all_partners";
export type Perms = Record<PermKey, boolean>;

export const PERM_LABELS: { key: PermKey; label: string }[] = [
  { key: "view_all_cars", label: "مشاهده همه خودروها" },
  { key: "create_car", label: "ثبت خودروی جدید" },
  { key: "edit_car", label: "ویرایش خودرو و سرمایه‌ها" },
  { key: "add_expense", label: "ثبت و ویرایش هزینه" },
  { key: "add_payment", label: "ثبت پرداخت و تراکنش" },
  { key: "manage_settlements", label: "مدیریت تسویه‌حساب‌ها" },
  { key: "view_all_partners", label: "مشاهده اطلاعات سایر شرکا" },
];

const NO_PERMS: Perms = {
  view_all_cars: false,
  create_car: false,
  edit_car: false,
  add_expense: false,
  add_payment: false,
  manage_settlements: false,
  view_all_partners: false,
};
const ALL_PERMS: Perms = {
  view_all_cars: true,
  create_car: true,
  edit_car: true,
  add_expense: true,
  add_payment: true,
  manage_settlements: true,
  view_all_partners: true,
};

/** Current user's role + partner permissions. Admins implicitly have every permission. */
export function usePerms() {
  const me = useMe();
  const isAdmin = !!me.data?.isAdmin;
  const q = useQuery({
    queryKey: ["my-perms"],
    enabled: !!me.data && !isAdmin,
    queryFn: async (): Promise<Perms> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return NO_PERMS;
      const { data: partner } = await supabase.from("partners").select("id").eq("user_id", u.user.id).maybeSingle();
      if (!partner) return NO_PERMS;
      const { data } = await supabase.from("partner_permissions").select("*").eq("partner_id", partner.id).maybeSingle();
      if (!data) return NO_PERMS;
      return {
        view_all_cars: data.can_view_all_cars,
        create_car: data.can_create_car,
        edit_car: data.can_edit_car,
        add_expense: data.can_add_expense,
        add_payment: data.can_add_payment,
        manage_settlements: data.can_manage_settlements,
        view_all_partners: data.can_view_all_partners,
      };
    },
  });
  return {
    isAdmin,
    perms: isAdmin ? ALL_PERMS : (q.data ?? NO_PERMS),
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
