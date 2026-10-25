import { parseIsoLocal } from "@/lib/jalali";

const nf = new Intl.NumberFormat("fa-IR");
export const fmt = (v: number | null | undefined) => nf.format(Math.round(Number(v ?? 0)));
export const toman = (v: number | null | undefined) => `${fmt(v)} تومان`;
export const pct = (v: number) => `${new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 }).format(v * 100)}٪`;
export const faYear = (y: number | null | undefined) =>
  y ? new Intl.NumberFormat("fa-IR", { useGrouping: false }).format(y) : "—";
export const faDate = (d: string | null | undefined) =>
  d ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(parseIsoLocal(d)) : "—";
export const faMonth = (d: string) =>
  new Intl.DateTimeFormat("fa-IR", { month: "short", year: "2-digit" }).format(parseIsoLocal(d));

export const statusLabel: Record<string, string> = {
  available: "موجود",
  reserved: "رزرو",
  sold: "فروخته‌شده",
};
export const txnLabel: Record<string, string> = {
  receipt: "دریافت",
  payment: "پرداخت",
  expense: "هزینه",
  settlement: "تسویه شریک",
};
