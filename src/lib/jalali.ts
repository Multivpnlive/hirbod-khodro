// تبدیل تاریخ میلادی ↔ هجری شمسی بر پایه کتابخانه jalaali-js
// (همه توابع با اعداد صحیح کار می‌کنند و به منطقه زمانی وابسته نیستند)
import * as jalaali from "jalaali-js";

export type JalaliDate = { jy: number; jm: number; jd: number };

export function toJalali(gy: number, gm: number, gd: number): JalaliDate {
  return jalaali.toJalaali(gy, gm, gd);
}
export function toGregorian(jy: number, jm: number, jd: number) {
  return jalaali.toGregorian(jy, jm, jd);
}
export const isJalaliLeap = (jy: number) => jalaali.isLeapJalaaliYear(jy);
export const jalaliMonthLength = (jy: number, jm: number) => jalaali.jalaaliMonthLength(jy, jm);
export const isValidJalali = (jy: number, jm: number, jd: number) =>
  jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaliMonthLength(jy, jm);

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO "YYYY-MM-DD" (میلادی، همان قالب پایگاه داده) → اجزای شمسی */
export function isoToJalali(iso: string): JalaliDate {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return toJalali(y!, m!, d!);
}

/** اجزای شمسی → ISO "YYYY-MM-DD" میلادی برای ذخیره در پایگاه داده */
export function jalaliToIso(jy: number, jm: number, jd: number) {
  const g = toGregorian(jy, jm, jd);
  return `${g.gy}-${pad(g.gm)}-${pad(g.gd)}`;
}

/** تاریخ امروز به‌صورت ISO محلی — بدون جابه‌جایی یک‌روزه بر اثر UTC */
export function todayIso() {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
}

/** ساخت Date محلی از رشته ISO تاریخ — بدون تفسیر UTC */
export function parseIsoLocal(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

export const JALALI_MONTHS = [
  "فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور",
  "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند",
] as const;

const faNum = new Intl.NumberFormat("fa-IR", { useGrouping: false });

/** نمایش کوتاه شمسی با ارقام فارسی: «۱۴۰۴/۰۷/۰۲» */
export function formatJalaliShort(iso: string | null | undefined) {
  if (!iso) return "";
  const { jy, jm, jd } = isoToJalali(iso);
  return `${faNum.format(jy)}/${faNum.format(jm).padStart(2, "۰")}/${faNum.format(jd).padStart(2, "۰")}`;
}

/** برچسب ماه شمسی: «آبان ۱۴۰۴» */
export function jalaliMonthLabel(jy: number, jm: number) {
  return `${JALALI_MONTHS[jm - 1]} ${faNum.format(jy)}`;
}

/** کلید مرتب‌سازی ماه شمسی از روی ISO: "1404-07" */
export function jalaliMonthKey(iso: string) {
  const { jy, jm } = isoToJalali(iso);
  return `${jy}-${pad(jm)}`;
}
