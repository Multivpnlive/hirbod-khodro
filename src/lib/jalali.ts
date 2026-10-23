// تبدیل تاریخ میلادی ↔ هجری شمسی (الگوریتم استاندارد جلالی، خالص و بدون وابستگی به منطقه زمانی)

const div = (a: number, b: number) => Math.floor(a / b);
const mod = (a: number, b: number) => a - Math.floor(a / b) * b;

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy: number) {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

function g2d(gy: number, gm: number, gd: number) {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function d2g(jdn: number) {
  let j = 4 * jdn + 139361631;
  j += div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return { gy, gm, gd };
}

function j2d(jy: number, jm: number, jd: number) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

function d2j(jdn: number) {
  const gy = d2g(jdn).gy;
  let jy = gy - 621;
  const r = jalCal(jy);
  const jdn1f = g2d(gy, 3, r.march);
  let k = jdn - jdn1f;
  if (k >= 0) {
    if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
}

export type JalaliDate = { jy: number; jm: number; jd: number };

export const toJalali = (gy: number, gm: number, gd: number): JalaliDate => d2j(g2d(gy, gm, gd));
export const toGregorian = (jy: number, jm: number, jd: number) => d2g(j2d(jy, jm, jd));
export const isJalaliLeap = (jy: number) => jalCal(jy).leap === 0;
export const jalaliMonthLength = (jy: number, jm: number) =>
  jm <= 6 ? 31 : jm <= 11 ? 30 : isJalaliLeap(jy) ? 30 : 29;
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
