import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RESOURCES = [
  "cars",
  "partners",
  "transactions",
  "customers",
  "receivables",
  "fund_transfers",
] as const;

const ROLES = ["finance_manager", "sales", "limited"] as const;
type StaffRole = (typeof ROLES)[number];
type Resource = (typeof RESOURCES)[number];
type PermissionRow = {
  resource: Resource;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

type AuthContext = {
  userId: string;
  supabase: {
    from: (table: string) => any;
  };
};

function getAuth(context: unknown): AuthContext {
  const auth = context as AuthContext;
  if (!auth?.userId || !auth?.supabase) throw new Error("نشست معتبر نیست. دوباره وارد شوید.");
  return auth;
}

async function requireAdmin(context: unknown) {
  const auth = getAuth(context);
  const { data, error } = await auth.supabase
    .from("user_roles")
    .select("user_id")
    .eq("user_id", auth.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error("بررسی مجوز مدیر انجام نشد.");
  if (!data) throw new Error("فقط مدیر اصلی اجازه مدیریت کاربران را دارد.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { auth, admin: supabaseAdmin as any };
}

function validateRole(value: unknown): StaffRole {
  if (typeof value !== "string" || !ROLES.includes(value as StaffRole)) {
    throw new Error("نقش کاربری معتبر نیست.");
  }
  return value as StaffRole;
}

function validatePermissions(value: unknown): PermissionRow[] {
  if (!Array.isArray(value) || value.length !== RESOURCES.length) {
    throw new Error("جدول مجوزها ناقص است.");
  }
  const seen = new Set<string>();
  const rows = value.map((item: any) => {
    if (!item || !RESOURCES.includes(item.resource) || seen.has(item.resource)) {
      throw new Error("بخش تکراری یا نامعتبر در مجوزها وجود دارد.");
    }
    seen.add(item.resource);
    for (const key of ["can_view", "can_create", "can_edit", "can_delete"] as const) {
      if (typeof item[key] !== "boolean") throw new Error("مقادیر مجوزها باید روشن یا خاموش باشند.");
    }
    return {
      resource: item.resource as Resource,
      can_view: item.can_view,
      can_create: item.can_create,
      can_edit: item.can_edit,
      can_delete: item.can_delete,
    };
  });
  if (seen.size !== RESOURCES.length) throw new Error("تمام بخش‌ها باید در جدول مجوزها مشخص شوند.");
  return rows;
}


function currentAppOrigin(): string {
  const request = getRequest();
  const host = (request.headers.get("host") || "").split(",")[0].trim();
  const proto = (
    request.headers.get("x-forwarded-proto") ||
    new URL(request.url).protocol.replace(":", "")
  ).split(",")[0].trim().toLowerCase();

  if (!host || proto !== "https") {
    throw new Error("آدرس امن برنامه از درخواست قابل تشخیص نیست.");
  }

  let base: URL;
  try {
    base = new URL(`${proto}://${host}`);
  } catch {
    throw new Error("آدرس برنامه معتبر نیست.");
  }

  if (base.host.toLowerCase() !== host.toLowerCase()) {
    throw new Error("مبدأ درخواست معتبر نیست.");
  }

  const origin = request.headers.get("origin");
  if (origin && new URL(origin).origin !== base.origin) {
    throw new Error("مبدأ درخواست با میزبان برنامه مطابقت ندارد.");
  }

  return base.origin;
}

export const listStaffUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { admin } = await requireAdmin(context);
    const users: any[] = [];
    for (let page = 1; page <= 20; page += 1) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error("دریافت فهرست حساب‌ها از سرویس احراز هویت انجام نشد.");
      users.push(...(data?.users ?? []));
      if (!data?.users || data.users.length < 200) break;
    }

    const [{ data: accessRows, error: accessError }, { data: permissionRows, error: permissionError }, { data: partners, error: partnersError }] = await Promise.all([
      admin.from("staff_access").select("user_id,staff_role,is_active,linked_partner_id,created_at,updated_at"),
      admin.from("staff_permissions").select("user_id,resource,can_view,can_create,can_edit,can_delete"),
      admin.from("partners").select("*"),
    ]);
    if (accessError || permissionError || partnersError) throw new Error("دریافت اطلاعات مدیریت کاربران انجام نشد.");

    const authById = new Map(users.map((user) => [user.id, user]));
    const permsByUser = new Map<string, PermissionRow[]>();
    for (const row of permissionRows ?? []) {
      const current = permsByUser.get(row.user_id) ?? [];
      current.push(row);
      permsByUser.set(row.user_id, current);
    }
    const partnerById = new Map<string, any>((partners ?? []).map((partner: any) => [String(partner.id), partner] as [string, any]));

    const usersList = (accessRows ?? []).map((row: any) => {
      const user = authById.get(row.user_id);
      const linked = row.linked_partner_id ? partnerById.get(row.linked_partner_id) : null;
      const label = linked
        ? String(linked.name ?? linked.full_name ?? linked.company_name ?? linked.title ?? `شریک ${String(linked.id).slice(0, 8)}`)
        : null;
      return {
        userId: row.user_id,
        email: user?.email ?? "—",
        fullName: String(user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? ""),
        createdAt: row.created_at,
        invitedAt: user?.invited_at ?? null,
        emailConfirmedAt: user?.email_confirmed_at ?? null,
        staffRole: row.staff_role as StaffRole,
        isActive: Boolean(row.is_active),
        linkedPartnerId: row.linked_partner_id as string | null,
        linkedPartnerLabel: label,
        permissions: permsByUser.get(row.user_id) ?? [],
      };
    }).sort((a: any, b: any) => String(a.email).localeCompare(String(b.email)));
    const partnerOptions = (partners ?? []).map((partner: any) => ({
      id: partner.id as string,
      label: String(partner.name ?? partner.full_name ?? partner.company_name ?? partner.title ?? `شریک ${String(partner.id).slice(0, 8)}`),
      linked: Boolean(partner.user_id),
    }));
    return { users: usersList, partners: partnerOptions };
  });

export const inviteStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const value = data as { email?: unknown; fullName?: unknown; staffRole?: unknown };
    const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";
    const fullName = typeof value?.fullName === "string" ? value.fullName.trim() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("ایمیل معتبر وارد کنید.");
    if (fullName.length < 2 || fullName.length > 120) throw new Error("نام باید بین ۲ تا ۱۲۰ نویسه باشد.");
    return { email, fullName, staffRole: validateRole(value.staffRole) };
  })
  .handler(async ({ context, data }) => {
    const { auth, admin } = await requireAdmin(context);
    const redirectTo = new URL("/reset-password", currentAppOrigin()).toString();

    // generateLink creates the invited Auth user and returns a one-time action link;
    // unlike inviteUserByEmail, it does not attempt to send email through SMTP.
    const { data: generated, error: generateError } = await admin.auth.admin.generateLink({
      type: "invite",
      email: data.email,
      options: {
        data: { full_name: data.fullName },
        redirectTo,
      },
    });
    const userId = generated?.user?.id;
    const tokenHash = generated?.properties?.hashed_token;
    if (generateError || !userId || !tokenHash) {
      const message = generateError?.message ?? "لینک دعوت از سرویس احراز هویت دریافت نشد.";
      if (/already|registered|exists/i.test(message)) {
        throw new Error("این ایمیل قبلاً در سامانه حساب دارد.");
      }
      console.error("[staff-invite] generateLink failed:", generateError?.code ?? "unknown");
      throw new Error("ساخت لینک دعوت ناموفق بود. وضعیت سرویس احراز هویت را بررسی کنید.");
    }

    const { error: accessError } = await admin.from("staff_access").insert({
      user_id: userId,
      staff_role: data.staffRole,
      is_active: true,
      created_by: auth.userId,
    });
    if (accessError) {
      const { error: rollbackError } = await admin.auth.admin.deleteUser(userId);
      if (rollbackError) console.error("[staff-invite] Auth rollback failed:", rollbackError.code ?? "unknown");
      throw new Error("حساب ایجاد شد اما ثبت نقش ناموفق بود؛ ایجاد حساب برگشت داده شد. وضعیت کاربران را بررسی کنید.");
    }
    // The action link is a bearer secret. Return it only to the authenticated admin;
    // never persist it or write it to logs.
    const inviteLink = `${baseUrl.origin}/reset-password#token_hash=${encodeURIComponent(tokenHash)}&type=invite`;
    return { success: true, userId, email: data.email, inviteLink };
  });

export const saveStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const value = data as {
      userId?: unknown; staffRole?: unknown; isActive?: unknown;
      linkedPartnerId?: unknown; permissions?: unknown;
    };
    if (typeof value?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.userId)) {
      throw new Error("شناسه کاربر معتبر نیست.");
    }
    if (typeof value.isActive !== "boolean") throw new Error("وضعیت حساب معتبر نیست.");
    const linkedPartnerId = value.linkedPartnerId === null || value.linkedPartnerId === "" || value.linkedPartnerId === undefined
      ? null : String(value.linkedPartnerId);
    if (linkedPartnerId && !/^[0-9a-f-]{36}$/i.test(linkedPartnerId)) throw new Error("شناسه شریک معتبر نیست.");
    return {
      userId: value.userId,
      staffRole: validateRole(value.staffRole),
      isActive: value.isActive,
      linkedPartnerId,
      permissions: validatePermissions(value.permissions),
    };
  })
  .handler(async ({ context, data }) => {
    const { auth, admin } = await requireAdmin(context);
    if (data.userId === auth.userId) throw new Error("مدیر اصلی را نمی‌توان از بخش کارکنان تغییر داد.");
    const { data: targetAdmin, error: roleError } = await admin
      .from("user_roles").select("user_id").eq("user_id", data.userId).eq("role", "admin").maybeSingle();
    if (roleError) throw new Error("بررسی نقش حساب مقصد انجام نشد.");
    if (targetAdmin) throw new Error("حساب مدیر اصلی از این بخش قابل تغییر نیست.");

    const { data: target, error: targetError } = await admin
      .from("staff_access").select("user_id").eq("user_id", data.userId).maybeSingle();
    if (targetError || !target) throw new Error("حساب کارمند پیدا نشد.");

    const { error: saveError } = await admin.rpc("admin_save_staff_user", {
      _user_id: data.userId,
      _staff_role: data.staffRole,
      _is_active: data.isActive,
      _permissions: data.permissions,
      _linked_partner_id: data.linkedPartnerId,
    });
    if (saveError) throw new Error(saveError.message || "ذخیره نقش و مجوزها انجام نشد.");

    const { error: banError } = await admin.auth.admin.updateUserById(data.userId, {
      ban_duration: data.isActive ? "none" : "876000h",
    });
    if (banError) {
      // The database access flag remains authoritative, so an auth-provider failure cannot restore RLS access.
      throw new Error("مجوزهای دیتابیس ذخیره شد، اما تغییر وضعیت ورود در سرویس احراز هویت ناموفق بود. وضعیت حساب را دوباره بررسی کنید.");
    }
    return { success: true };
  });


// Create a fresh activation/recovery link for an existing staff account.
// A recovery token also confirms an unconfirmed invited account when verified.
export const createStaffRenewalLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const value = data as { userId?: unknown };
    if (typeof value?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.userId)) {
      throw new Error("شناسه کاربر معتبر نیست.");
    }
    return { userId: value.userId };
  })
  .handler(async ({ context, data }) => {
    const { admin } = await requireAdmin(context);

    const { data: access, error: accessError } = await admin
      .from("staff_access")
      .select("user_id,is_active")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (accessError || !access) throw new Error("حساب کارمند پیدا نشد.");
    if (!access.is_active) throw new Error("ابتدا حساب کاربر را فعال کنید.");

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(data.userId);

    const target = userData?.user;
    if (userError || !target?.email) {
      throw new Error("دریافت اطلاعات حساب کاربر ناموفق بود.");
    }

    const redirectTo = new URL("/reset-password", currentAppOrigin()).toString();

    // Recovery verification also confirms an invited user whose email is
    // not yet confirmed, so this works for both pending and active accounts.
    const { data: generated, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "recovery",
        email: target.email,
        options: {
          redirectTo,
        },
      });

    const tokenHash = generated?.properties?.hashed_token;

    if (linkError || !tokenHash) {
      console.error("[staff-link] generation failed:", linkError?.code ?? "unknown");
      throw new Error("ساخت لینک جدید ناموفق بود.");
    }

    const inviteLink =
      `${baseUrl.origin}/reset-password#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;

    return {
      success: true,
      email: target.email,
      inviteLink,
      purpose: target.email_confirmed_at ? "recovery" : "activation",
    };
  });


// Update a staff member's display name and login email.
// Email change is immediately confirmed by an administrator after external
// ownership verification because this installation has no SMTP delivery.
export const updateStaffIdentity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const value = data as {
      userId?: unknown;
      fullName?: unknown;
      email?: unknown;
      confirmEmailOwnership?: unknown;
    };

    const userId = typeof value?.userId === "string" ? value.userId : "";
    const fullName = typeof value?.fullName === "string" ? value.fullName.trim() : "";
    const email = typeof value?.email === "string" ? value.email.trim().toLowerCase() : "";

    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      throw new Error("شناسه کاربر معتبر نیست.");
    }
    if (fullName.length < 2 || fullName.length > 120) {
      throw new Error("نام باید بین ۲ تا ۱۲۰ نویسه باشد.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error("ایمیل معتبر وارد کنید.");
    }
    if (typeof value?.confirmEmailOwnership !== "boolean") {
      throw new Error("وضعیت تأیید ایمیل معتبر نیست.");
    }

    return {
      userId,
      fullName,
      email,
      confirmEmailOwnership: value.confirmEmailOwnership,
    };
  })
  .handler(async ({ context, data }) => {
    const { auth, admin } = await requireAdmin(context);

    if (data.userId === auth.userId) {
      throw new Error("تغییر اطلاعات مدیر اصلی از این بخش مجاز نیست.");
    }

    const { data: access, error: accessError } = await admin
      .from("staff_access")
      .select("user_id")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (accessError || !access) throw new Error("حساب کارمند پیدا نشد.");

    const { data: role, error: roleError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) throw new Error("بررسی نقش حساب ناموفق بود.");
    if (role) throw new Error("حساب مدیر اصلی قابل تغییر نیست.");

    const { data: userData, error: userError } =
      await admin.auth.admin.getUserById(data.userId);

    const target = userData?.user;
    if (userError || !target) throw new Error("حساب کاربر پیدا نشد.");

    const emailChanged =
      data.email.toLowerCase() !== String(target.email ?? "").toLowerCase();

    if (emailChanged && !data.confirmEmailOwnership) {
      throw new Error("برای تغییر ایمیل، ابتدا مالکیت آدرس جدید را تأیید کنید.");
    }

    const attributes: any = {
      user_metadata: {
        ...(target.user_metadata ?? {}),
        full_name: data.fullName,
      },
    };

    if (emailChanged) {
      attributes.email = data.email;
      attributes.email_confirm = true;
    }

    const { error: updateError } =
      await admin.auth.admin.updateUserById(data.userId, attributes);

    if (updateError) {
      if (/already|registered|exists/i.test(updateError.message ?? "")) {
        throw new Error("این ایمیل قبلاً در سامانه استفاده شده است.");
      }
      console.error("[staff-identity] update failed:", updateError.code ?? "unknown");
      throw new Error("به‌روزرسانی اطلاعات کاربر انجام نشد.");
    }

    return { success: true, email: data.email, emailChanged };
  });


// Delete only the staff login account.
// Keep the financial partner record and partner-based history intact.
export const deleteStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => {
    const value = data as { userId?: unknown };
    if (typeof value?.userId !== "string" || !/^[0-9a-f-]{36}$/i.test(value.userId)) {
      throw new Error("شناسه کاربر معتبر نیست.");
    }
    return { userId: value.userId };
  })
  .handler(async ({ context, data }) => {
    const { auth, admin } = await requireAdmin(context);

    if (data.userId === auth.userId) {
      throw new Error("امکان حذف حساب مدیر اصلی وجود ندارد.");
    }

    const { data: role, error: roleError } = await admin
      .from("user_roles")
      .select("user_id")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError) throw new Error("بررسی نقش کاربر ناموفق بود.");
    if (role) throw new Error("حساب مدیر اصلی قابل حذف نیست.");

    const { data: access, error: accessError } = await admin
      .from("staff_access")
      .select("user_id")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (accessError || !access) throw new Error("حساب کارمند پیدا نشد.");

    // partners.user_id has no FK to auth.users in this database.
    // Unlink it first, but never delete the partner or financial rows.
    const { data: partnerRows, error: partnerLookupError } = await admin
      .from("partners")
      .select("id")
      .eq("user_id", data.userId);

    if (partnerLookupError) {
      throw new Error("بررسی اتصال شریک مالی ناموفق بود؛ حساب حذف نشد.");
    }

    const partnerIds = (partnerRows ?? []).map((row: any) => row.id);

    if (partnerIds.length) {
      const { error: detachError } = await admin
        .from("partners")
        .update({ user_id: null })
        .eq("user_id", data.userId);

      if (detachError) {
        throw new Error("قطع اتصال حساب از رکورد شریک مالی ناموفق بود؛ حساب حذف نشد.");
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(data.userId);

    if (deleteError) {
      // Restore the partner login association if Auth deletion failed.
      if (partnerIds.length) {
        const { error: restoreError } = await admin
          .from("partners")
          .update({ user_id: data.userId })
          .in("id", partnerIds);

        if (restoreError) {
          console.error("[staff-delete] partner link restore failed:", restoreError.code ?? "unknown");
        }
      }
      throw new Error("حذف حساب از سرویس احراز هویت انجام نشد.");
    }

    return {
      success: true,
      preservedPartnerRecords: partnerIds.length,
    };
  });
