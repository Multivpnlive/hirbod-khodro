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
      const [{ data: roles }, { data: staff }, { data: partner }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", u.user.id),
        (supabase as any).from("staff_access").select("staff_role,is_active,linked_partner_id").eq("user_id", u.user.id).maybeSingle(),
        supabase.from("partners").select("id").eq("user_id", u.user.id).maybeSingle(),
      ]);
      const isAdmin = !!roles?.some((r) => r.role === "admin");
      return {
        user: u.user,
        isAdmin,
        isStaff: !!staff,
        staffRole: staff?.staff_role ?? null,
        isActive: staff?.is_active !== false,
        isPartner: !!partner,
        linkedPartnerId: staff?.linked_partner_id ?? partner?.id ?? null,
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
  | "view_brokerage"
  | "view_hawala"
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
  { key: "view_brokerage", label: "مشاهده کارگزاری" },
  { key: "view_hawala", label: "مشاهده حواله‌ها" },
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
  view_brokerage: false,
  view_hawala: false,
  view_custody: false,
  view_receivables: false,
};
const ALL_PERMS: Perms = Object.fromEntries(
  Object.keys(NO_PERMS).map((key) => [key, true]),
) as Perms;

/** Admins have all access. Staff rights are read from staff_permissions; linked partner rights remain separate. */
export function usePerms() {
  const me = useMe();
  const isAdmin = !!me.data?.isAdmin;
  const q = useQuery({
    queryKey: ["my-perms"],
    enabled: !!me.data && !isAdmin,
    queryFn: async (): Promise<Perms> => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) return NO_PERMS;

      const { data: staff } = await (supabase as any)
        .from("staff_access")
        .select("is_active")
        .eq("user_id", u.user.id)
        .maybeSingle();
      if (staff) {
        if (!staff.is_active) return NO_PERMS;
        const { data: rows, error } = await (supabase as any)
          .from("staff_permissions")
          .select("resource,can_view,can_create,can_edit,can_delete")
          .eq("user_id", u.user.id);
        if (error) throw error;
        const byResource = new Map<string, any>((rows ?? []).map((row: any) => [String(row.resource), row] as [string, any]));
        const get = (resource: string, action: string) => Boolean(byResource.get(resource)?.[action]);
        const { data: linkedPartner } = await supabase.from("partners").select("id").eq("user_id", u.user.id).maybeSingle();
        const { data: partnerPermissions } = linkedPartner
          ? await supabase.from("partner_permissions").select("*").eq("partner_id", linkedPartner.id).maybeSingle()
          : { data: null };
        return {
          view_all_cars: get("cars", "can_view") || !!partnerPermissions?.can_view_all_cars,
          create_car: get("cars", "can_create") || !!partnerPermissions?.can_create_car,
          edit_car: get("cars", "can_edit") || !!partnerPermissions?.can_edit_car,
          add_expense: get("cars", "can_create") || get("cars", "can_edit") || !!partnerPermissions?.can_add_expense,
          add_payment: get("transactions", "can_create") || !!partnerPermissions?.can_add_payment,
          view_transactions: get("transactions", "can_view") || !!partnerPermissions?.can_add_payment || !!partnerPermissions?.can_manage_settlements,
          manage_settlements: get("transactions", "can_edit") || !!partnerPermissions?.can_manage_settlements,
          view_all_partners: get("partners", "can_view") || !!partnerPermissions?.can_view_all_partners,
          view_customers: get("customers", "can_view") || !!partnerPermissions?.can_view_customers,
          view_brokerage: get("brokerage", "can_view") || !!partnerPermissions?.can_view_brokerage,
          view_hawala: get("hawalas", "can_view") || !!partnerPermissions?.can_view_hawala,
          view_custody: get("fund_transfers", "can_view") || !!partnerPermissions?.can_view_custody,
          view_receivables: get("receivables", "can_view") || !!partnerPermissions?.can_view_customer_finance,
        };
      }

      const { data: partner } = await supabase.from("partners").select("id").eq("user_id", u.user.id).maybeSingle();
      if (!partner) return NO_PERMS;
      const { data, error } = await supabase.from("partner_permissions").select("*").eq("partner_id", partner.id).maybeSingle();
      if (error) throw error;
      if (!data) return NO_PERMS;
      return {
        view_all_cars: data.can_view_all_cars,
        create_car: data.can_create_car,
        edit_car: data.can_edit_car,
        add_expense: data.can_add_expense,
        add_payment: data.can_add_payment,
        view_transactions: true,
        manage_settlements: data.can_manage_settlements,
        view_all_partners: data.can_view_all_partners,
        view_customers: data.can_view_customers,
        view_brokerage: data.can_view_brokerage,
        view_hawala: data.can_view_hawala,
        view_custody: data.can_view_custody,
        view_receivables: data.can_view_customer_finance,
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
