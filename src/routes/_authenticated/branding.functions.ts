import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { randomUUID } from "node:crypto";

const BUCKET = "branding-assets";
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

function validateHex(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${label} معتبر نیست.`);
  }
  return value;
}

export const saveAppBranding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const v = data as Record<string, unknown>;
    const appName = typeof v.appName === "string" ? v.appName.trim() : "";
    const companyName = typeof v.companyName === "string" ? v.companyName.trim() : "";
    const contactPhone = typeof v.contactPhone === "string" ? v.contactPhone.trim() : "";
    const contactEmail = typeof v.contactEmail === "string" ? v.contactEmail.trim().toLowerCase() : "";
    const website = typeof v.website === "string" ? v.website.trim() : "";
    const logoDataUrl = typeof v.logoDataUrl === "string" ? v.logoDataUrl : "";
    const removeLogo = v.removeLogo === true;

    if (appName.length < 2 || appName.length > 80) {
      throw new Error("نام نرم‌افزار باید بین ۲ تا ۸۰ نویسه باشد.");
    }
    if (companyName.length < 2 || companyName.length > 120) {
      throw new Error("نام شرکت باید بین ۲ تا ۱۲۰ نویسه باشد.");
    }
    if (contactPhone.length > 40) throw new Error("شماره تماس بیش از حد طولانی است.");
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new Error("ایمیل تماس معتبر نیست.");
    }
    if (website) {
      let url: URL;
      try { url = new URL(website); } catch { throw new Error("وب‌سایت معتبر نیست."); }
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("آدرس وب‌سایت باید HTTP یا HTTPS باشد.");
      }
    }
    if (logoDataUrl.length > 3_000_000) throw new Error("حجم لوگو بیش از حد مجاز است.");

    return {
      appName, companyName, contactPhone, contactEmail, website,
      primaryColor: validateHex(v.primaryColor, "رنگ اصلی"),
      secondaryColor: validateHex(v.secondaryColor, "رنگ مکمل"),
      logoDataUrl, removeLogo,
    };
  })
  .handler(async ({ context, data }) => {
    const auth = context as any;
    if (!auth?.userId || !auth?.supabase) {
      throw new Error("نشست معتبر نیست؛ دوباره وارد شوید.");
    }

    const { data: role, error: roleError } = await auth.supabase
      .from("user_roles")
      .select("user_id")
      .eq("user_id", auth.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !role) throw new Error("فقط مدیر اصلی اجازه تغییر برند را دارد.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: current, error: readError } = await admin
      .from("app_branding")
      .select("logo_path,logo_url")
      .eq("id", 1)
      .maybeSingle();

    if (readError) throw new Error("خواندن تنظیمات برند ناموفق بود.");

    let logoPath: string | null = current?.logo_path ?? null;
    let logoUrl: string | null = current?.logo_url ?? null;
    let newlyUploadedPath: string | null = null;

    if (data.logoDataUrl) {
      const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data.logoDataUrl);
      if (!match) throw new Error("فرمت لوگو باید PNG، JPG یا WebP باشد.");

      const mimeType = match[1];
      const bytes = Buffer.from(match[2], "base64");
      if (!bytes.length || bytes.length > MAX_LOGO_BYTES) {
        throw new Error("حجم لوگو باید حداکثر ۲ مگابایت باشد.");
      }

      const valid =
        (mimeType === "image/png" && bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") ||
        (mimeType === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
        (mimeType === "image/webp" && bytes.subarray(0, 4).toString() === "RIFF" &&
          bytes.subarray(8, 12).toString() === "WEBP");

      if (!valid) throw new Error("محتوای فایل با فرمت اعلام‌شده مطابقت ندارد.");

      const { data: bucket } = await admin.storage.getBucket(BUCKET);
      if (!bucket) {
        const { error: createBucketError } = await admin.storage.createBucket(BUCKET, {
          public: true,
          fileSizeLimit: MAX_LOGO_BYTES,
          allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        });
        if (createBucketError) {
          throw new Error("ساخت فضای ذخیره‌سازی لوگو ناموفق بود.");
        }
      }

      const ext = mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
      const path = `logo/${randomUUID()}.${ext}`;
      const safeBytes = new Uint8Array(bytes.length);
      safeBytes.set(bytes);

      const { error: uploadError } = await admin.storage
        .from(BUCKET)
        .upload(path, safeBytes.buffer, {
          contentType: mimeType,
          cacheControl: "3600",
          upsert: false,
        });

      if (uploadError) throw new Error("بارگذاری لوگو ناموفق بود.");

      newlyUploadedPath = path;
      logoPath = path;
      logoUrl = admin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    } else if (data.removeLogo) {
      logoPath = null;
      logoUrl = null;
    }

    const payload = {
      id: 1,
      app_name: data.appName,
      company_name: data.companyName,
      logo_path: logoPath,
      logo_url: logoUrl,
      primary_color: data.primaryColor,
      secondary_color: data.secondaryColor,
      contact_phone: data.contactPhone || null,
      contact_email: data.contactEmail || null,
      website: data.website || null,
      updated_at: new Date().toISOString(),
    };

    const { error: saveError } = await admin
      .from("app_branding")
      .upsert(payload, { onConflict: "id" });

    if (saveError) {
      if (newlyUploadedPath) {
        await admin.storage.from(BUCKET).remove([newlyUploadedPath]);
      }
      throw new Error("ذخیره تنظیمات برند ناموفق بود.");
    }

    if (current?.logo_path && current.logo_path !== logoPath) {
      await admin.storage.from(BUCKET).remove([current.logo_path]);
    }

    return { success: true };
  });
