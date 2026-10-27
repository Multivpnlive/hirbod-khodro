export function toEnglishDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬،]/g, "")
    .replace(/٫/g, ".")
    .replace(/,/g, "");
}

export function amountValue(value: FormDataEntryValue | null): number {
  const n = Number(toEnglishDigits(String(value ?? "")).trim());
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function faMoney(value: unknown): string {
  return `${Math.round(Number(value ?? 0)).toLocaleString("fa-IR")} تومان`;
}

export function faNumber(value: unknown): string {
  return Math.round(Number(value ?? 0)).toLocaleString("fa-IR");
}

export function errorText(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message ?? "خطای نامشخص");
  }
  return String(error ?? "خطای نامشخص");
}
