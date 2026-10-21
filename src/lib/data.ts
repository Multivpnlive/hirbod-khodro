import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Car = Database["public"]["Tables"]["cars"]["Row"];
export type Partner = Database["public"]["Tables"]["partners"]["Row"];
export type Expense = Database["public"]["Tables"]["car_expenses"]["Row"];
export type Investment = Database["public"]["Tables"]["car_investments"]["Row"];
export type Txn = Database["public"]["Tables"]["transactions"]["Row"];

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

const KEY = "hirbod-show-demo";
export function useDemoMode() {
  const [showDemo, setShowDemo] = useState(true);
  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v !== null) setShowDemo(v === "1");
    const h = () => setShowDemo(localStorage.getItem(KEY) !== "0");
    window.addEventListener("demo-change", h);
    return () => window.removeEventListener("demo-change", h);
  }, []);
  const set = (v: boolean) => {
    localStorage.setItem(KEY, v ? "1" : "0");
    window.dispatchEvent(new Event("demo-change"));
  };
  return [showDemo, set] as const;
}

/** Loads every table the signed-in user may read. RLS decides what comes back. */
export function useAllData() {
  const [showDemo] = useDemoMode();
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
  const f = <T extends { is_demo: boolean }>(a: T[] | undefined) => (a ?? []).filter((x) => showDemo || !x.is_demo);
  return {
    ...q,
    showDemo,
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
