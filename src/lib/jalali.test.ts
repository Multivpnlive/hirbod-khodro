import { describe, expect, it } from "vitest";
import {
  formatJalaliShort,
  isJalaliLeap,
  isValidJalali,
  jalaliMonthKey,
  jalaliMonthLabel,
  jalaliMonthLength,
  jalaliToIso,
  isoToJalali,
  parseIsoLocal,
  toGregorian,
  toJalali,
} from "./jalali";

describe("تبدیل میلادی ↔ شمسی", () => {
  it("نوروز ۱۴۰۴ = ۲۰۲۵-۰۳-۲۱", () => {
    expect(toJalali(2025, 3, 21)).toEqual({ jy: 1404, jm: 1, jd: 1 });
    expect(toGregorian(1404, 1, 1)).toEqual({ gy: 2025, gm: 3, gd: 21 });
  });
  it("نوروز ۱۴۰۵ = ۲۰۲۶-۰۳-۲۱", () => {
    expect(jalaliToIso(1405, 1, 1)).toBe("2026-03-21");
    expect(isoToJalali("2026-03-21")).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });
  it("سال ۱۴۰۳ کبیسه است و اسفند ۳۰ روز دارد", () => {
    expect(isJalaliLeap(1403)).toBe(true);
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(isValidJalali(1403, 12, 30)).toBe(true);
    expect(jalaliToIso(1403, 12, 30)).toBe("2025-03-20");
  });
  it("سال ۱۴۰۴ کبیسه نیست و اسفند ۲۹ روز دارد", () => {
    expect(isJalaliLeap(1404)).toBe(false);
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(isValidJalali(1404, 12, 30)).toBe(false);
    expect(jalaliToIso(1404, 12, 29)).toBe("2026-03-20");
  });
  it("مرز سال: روز بعد از پایان اسفند، نوروز است", () => {
    expect(isoToJalali("2026-03-20")).toEqual({ jy: 1404, jm: 12, jd: 29 });
    expect(isoToJalali("2026-03-21")).toEqual({ jy: 1405, jm: 1, jd: 1 });
  });
  it("رفت‌وبرگشت برای بازه طولانی (شامل چند سال کبیسه) بدون خطاست", () => {
    for (let gy = 1990; gy <= 2035; gy++) {
      for (const gm of [1, 3, 6, 9, 12]) {
        const gd = gm === 3 ? 21 : 15;
        const j = toJalali(gy, gm, gd);
        expect(toGregorian(j.jy, j.jm, j.jd)).toEqual({ gy, gm, gd });
      }
    }
  });
  it("ماه‌های شش‌ماهه اول ۳۱ روز و شش‌ماهه دوم ۳۰ روز دارند", () => {
    expect(jalaliMonthLength(1404, 1)).toBe(31);
    expect(jalaliMonthLength(1404, 6)).toBe(31);
    expect(jalaliMonthLength(1404, 7)).toBe(30);
    expect(jalaliMonthLength(1404, 11)).toBe(30);
  });
});

describe("قالب‌بندی و ابزارهای نمایش", () => {
  it("نمایش کوتاه با ارقام فارسی", () => {
    expect(formatJalaliShort("2026-10-23")).toBe("۱۴۰۵/۰۸/۰۱");
  });
  it("برچسب ماه شمسی فارسی است", () => {
    expect(jalaliMonthLabel(1405, 8)).toBe("آبان ۱۴۰۵");
  });
  it("کلید ماه شمسی قابل مرتب‌سازی است", () => {
    expect(jalaliMonthKey("2026-10-23")).toBe("1405-08");
    expect(jalaliMonthKey("2027-01-20")).toBe("1405-10");
  });
  it("تفسیر ISO به‌صورت محلی بدون جابه‌جایی یک‌روزه", () => {
    const d = parseIsoLocal("2025-01-01");
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate()]).toEqual([2025, 1, 1]);
    const e = parseIsoLocal("2026-12-31");
    expect([e.getFullYear(), e.getMonth() + 1, e.getDate()]).toEqual([2026, 12, 31]);
  });
});
