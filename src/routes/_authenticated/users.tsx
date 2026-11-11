import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MailPlus, RefreshCw, Save, ShieldCheck, Users, UserRound, Link2, Copy, KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/AppShell";
import { useMe } from "@/lib/data";
import type { StaffResource } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inviteStaffUser, listStaffUsers, saveStaffUser, createStaffRenewalLink, updateStaffIdentity, deleteStaffUser } from "./users.functions";

type StaffRole = "finance_manager" | "sales" | "limited";
type Resource = StaffResource;
type PermissionRow = { resource: Resource; can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean };
type StaffUser = {
  userId: string; email: string; fullName: string; createdAt: string;
  invitedAt: string | null; emailConfirmedAt: string | null;
  staffRole: StaffRole; isActive: boolean; linkedPartnerId: string | null;
  linkedPartnerLabel: string | null; permissions: PermissionRow[];
};

const ROLE_LABELS: Record<StaffRole, string> = {
  finance_manager: "مدیر مالی",
  sales: "فروشنده",
  limited: "کاربر محدود",
};
const RESOURCES: { key: Resource; label: string }[] = [
  { key: "cars", label: "خودروها" },
  { key: "partners", label: "شرکا" },
  { key: "transactions", label: "تراکنش‌ها" },
  { key: "customers", label: "مشتریان" },
  { key: "receivables", label: "مطالبات فروش" },
  { key: "fund_transfers", label: "انتقال وجه" },
];
const ACTIONS = [
  { key: "can_view", label: "مشاهده" },
  { key: "can_create", label: "ثبت" },
  { key: "can_edit", label: "ویرایش" },
  { key: "can_delete", label: "حذف" },
] as const;
type PermissionKey = (typeof ACTIONS)[number]["key"];

function emptyPermissions(): PermissionRow[] {
  return RESOURCES.map(({ key }) => ({
    resource: key, can_view: false, can_create: false, can_edit: false, can_delete: false,
  }));
}

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "مدیریت کاربران | هیربد خودرو" }] }),
  component: UsersPage,
});

function UsersPage() {
  const me = useMe();
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ["staff-users"],
    queryFn: () => listStaffUsers(),
    enabled: !!me.data?.isAdmin,
  });
  const [showInvite, setShowInvite] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [inviteLinkTitle, setInviteLinkTitle] = useState("لینک دعوت آماده شد");
  const [inviteLinkInfo, setInviteLinkInfo] = useState("لینک محرمانه را فقط برای همان شخص ارسال کنید.");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [inviteRole, setInviteRole] = useState<StaffRole>("limited");
  const [editing, setEditing] = useState<StaffUser | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [confirmEmailOwnership, setConfirmEmailOwnership] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StaffUser | null>(null);
  const [editRole, setEditRole] = useState<StaffRole>("limited");
  const [editActive, setEditActive] = useState(true);
  const [partnerId, setPartnerId] = useState("");
  const [permissions, setPermissions] = useState<PermissionRow[]>(emptyPermissions);

  const refresh = async () => queryClient.invalidateQueries({ queryKey: ["staff-users"] });
  const inviteMutation = useMutation({
    mutationFn: () => inviteStaffUser({ data: { email, fullName, staffRole: inviteRole } }),
    onSuccess: async (result) => {
      setInviteLink(result.inviteLink);
      setInviteLinkTitle("لینک دعوت آماده شد");
      setInviteLinkInfo("حساب کاربر ساخته شده است. لینک محرمانه و یک‌بارمصرف را فقط برای همان شخص ارسال کنید.");
      setInviteLinkCopied(false);
      toast.success("حساب کاربر ساخته شد؛ لینک دعوت آماده کپی است.");
      setShowInvite(false); setEmail(""); setFullName("");
      await refresh();
    },
    onError: (error) => toast.error(readableError(error)),
  });
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("کاربری برای ویرایش انتخاب نشده است.");
      return saveStaffUser({ data: {
        userId: editing.userId,
        staffRole: editRole,
        isActive: editActive,
        linkedPartnerId: partnerId.trim() || null,
        permissions,
      } });
    },
    onSuccess: async () => {
      toast.success("نقش، وضعیت و مجوزهای کاربر ذخیره شد.");
      setEditing(null);
      await refresh();
    },
    onError: (error) => toast.error(readableError(error)),
  });

  const identityMutation = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error("کاربری برای ویرایش انتخاب نشده است.");
      return updateStaffIdentity({ data: {
        userId: editing.userId,
        fullName: editFullName,
        email: editEmail,
        confirmEmailOwnership,
      } });
    },
    onSuccess: async (result) => {
      toast.success(result.emailChanged
        ? "نام و ایمیل کاربر به‌روزرسانی شد."
        : "نام کاربر به‌روزرسانی شد.");
      setEditing(null);
      await refresh();
    },
    onError: (error) => toast.error(readableError(error)),
  });

  const renewalLinkMutation = useMutation({
    mutationFn: (userId: string) =>
      createStaffRenewalLink({ data: { userId } }),
    onSuccess: (result) => {
      setInviteLink(result.inviteLink);
      setInviteLinkCopied(false);

      if (result.purpose === "activation") {
        setInviteLinkTitle("لینک فعال‌سازی مجدد آماده شد");
        setInviteLinkInfo("این حساب هنوز تأیید نشده است. لینک تازه را فقط برای همان کاربر ارسال کنید.");
      } else {
        setInviteLinkTitle("لینک بازیابی رمز آماده شد");
        setInviteLinkInfo("این حساب قبلاً فعال شده است. لینک بازیابی رمز را فقط برای صاحب حساب ارسال کنید.");
      }
    },
    onError: (error) => toast.error(readableError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => deleteStaffUser({ data: { userId } }),
    onSuccess: async (result) => {
      toast.success(
        result.preservedPartnerRecords
          ? `حساب حذف شد؛ ${result.preservedPartnerRecords} رکورد شریک مالی حفظ شد.`
          : "حساب کاربر حذف شد."
      );
      setDeleteTarget(null);
      await refresh();
    },
    onError: (error) => toast.error(readableError(error)),
  });

  function openEditor(user: StaffUser) {
    setEditing(user);
    setEditFullName(user.fullName || "");
    setEditEmail(user.email === "—" ? "" : user.email);
    setConfirmEmailOwnership(false);
    setEditRole(user.staffRole);
    setEditActive(user.isActive);
    setPartnerId(user.linkedPartnerId ?? "");
    const existing = new Map(user.permissions.map((row) => [row.resource, row]));
    setPermissions(RESOURCES.map(({ key }) => existing.get(key) ?? {
      resource: key, can_view: false, can_create: false, can_edit: false, can_delete: false,
    }));
  }

  function togglePermission(resource: Resource, action: PermissionKey, checked: boolean) {
    setPermissions((rows) => rows.map((row) => row.resource === resource ? { ...row, [action]: checked } : row));
  }

  if (me.isLoading) return <div className="py-10 text-muted-foreground">در حال بررسی دسترسی…</div>;
  if (!me.data?.isAdmin) return <Navigate to="/dashboard" replace />;

  const users = (usersQuery.data?.users ?? []) as StaffUser[];
  const partnerOptions = (usersQuery.data?.partners ?? []) as { id: string; label: string; linked: boolean }[];
  return (
    <div dir="rtl" className="mx-auto max-w-7xl space-y-5">
      <PageHeader title="مدیریت کاربران" action={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => usersQuery.refetch()} disabled={usersQuery.isFetching}>
            <RefreshCw className={`size-4 ${usersQuery.isFetching ? "animate-spin" : ""}`} /> به‌روزرسانی
          </Button>
          <Button onClick={() => setShowInvite(true)}><MailPlus className="size-4" /> دعوت کاربر</Button>
        </div>
      } />

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="کل کاربران مدیریتی" value={String(users.length)} icon={<Users className="size-5" />} />
        <SummaryCard label="حساب‌های فعال" value={String(users.filter((u) => u.isActive).length)} icon={<ShieldCheck className="size-5" />} />
        <SummaryCard label="در انتظار تأیید ایمیل" value={String(users.filter((u) => !u.emailConfirmedAt).length)} icon={<MailPlus className="size-5" />} />
      </div>

      <section className="card-elevated overflow-hidden">
        <div className="border-b p-4 sm:p-5">
          <h2 className="font-bold">حساب‌های کارکنان</h2>
          <p className="mt-1 text-sm text-muted-foreground">حساب مدیر اصلی و حساب‌های مالی شریک در این فهرست قابل تغییر نیستند.</p>
        </div>
        {usersQuery.isLoading ? <div className="p-8 text-center text-muted-foreground">در حال دریافت کاربران…</div> : usersQuery.isError ? (
          <div className="p-8 text-center text-destructive">دریافت فهرست کاربران ناموفق بود. صفحه را به‌روزرسانی کنید.</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">هنوز کارمند جدیدی دعوت نشده است.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr><th className="p-3 text-right">کاربر</th><th className="p-3 text-right">نقش</th><th className="p-3 text-right">وضعیت حساب</th><th className="p-3 text-right">اتصال شریک</th><th className="p-3 text-right">دعوت</th><th className="p-3 text-left">عملیات</th></tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.userId} className="border-t">
                    <td className="p-3"><div className="font-semibold">{user.fullName || "بدون نام"}</div><div className="mt-1 text-xs text-muted-foreground" dir="ltr">{user.email}</div></td>
                    <td className="p-3">{ROLE_LABELS[user.staffRole]}</td>
                    <td className="p-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${user.isActive ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" : "bg-destructive/10 text-destructive"}`}>{user.isActive ? "فعال" : "غیرفعال"}</span></td>
                    <td className="p-3">{user.linkedPartnerLabel ?? (user.linkedPartnerId ? user.linkedPartnerId.slice(0, 8) : "—")}</td>
                    <td className="p-3">{user.emailConfirmedAt ? "تأیید شده" : "در انتظار تأیید"}</td>
                    <td className="p-3 text-left">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => openEditor(user)}>
                          مدیریت
                        </Button>
                        <Button size="sm" variant="outline"
                          onClick={() => renewalLinkMutation.mutate(user.userId)}
                          disabled={renewalLinkMutation.isPending}>
                          <KeyRound className="size-3.5" /> لینک مجدد
                        </Button>
                        <Button size="sm" variant="outline" className="text-destructive"
                          onClick={() => setDeleteTarget(user)}>
                          <Trash2 className="size-3.5" /> حذف
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showInvite && (
        <Modal title="دعوت کاربر جدید" onClose={() => setShowInvite(false)}>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); inviteMutation.mutate(); }}>
            <div className="space-y-2"><Label htmlFor="staff-full-name">نام و نام خانوادگی</Label><Input id="staff-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} maxLength={120} /></div>
            <div className="space-y-2"><Label htmlFor="staff-email">ایمیل</Label><Input id="staff-email" type="email" dir="ltr" value={email} onChange={(event) => setEmail(event.target.value)} required /></div>
            <div className="space-y-2"><Label htmlFor="staff-role">نقش اولیه</Label><select id="staff-role" className="h-10 w-full rounded-md border bg-background px-3" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as StaffRole)}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
            <p className="rounded-lg bg-muted p-3 text-xs leading-6 text-muted-foreground">پس از ساخت حساب، لینک فعال‌سازی نمایش داده می‌شود تا آن را از طریق پیام‌رسان برای کاربر بفرستید. مجوزهای اولیه بر اساس نقش تنظیم می‌شوند و بعداً قابل تغییرند.</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setShowInvite(false)}>انصراف</Button><Button type="submit" disabled={inviteMutation.isPending}><MailPlus className="size-4" />{inviteMutation.isPending ? "در حال ساخت…" : "ساخت لینک دعوت"}</Button></div>
          </form>
        </Modal>
      )}

      {inviteLink && (
        <Modal title={inviteLinkTitle} onClose={() => { setInviteLink(null); setInviteLinkCopied(false); }} wide>
          <div className="space-y-4">
            <p className="text-sm leading-7 text-muted-foreground">{inviteLinkInfo}</p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input dir="ltr" value={inviteLink} readOnly onFocus={(event) => event.currentTarget.select()} className="min-w-0 flex-1" aria-label="لینک محرمانه دعوت" />
              <Button type="button" onClick={async () => {
                try {
                  await navigator.clipboard.writeText(inviteLink);
                  setInviteLinkCopied(true);
                  toast.success("لینک دعوت کپی شد.");
                } catch {
                  toast.error("کپی خودکار انجام نشد؛ لینک را از کادر انتخاب و کپی کنید.");
                }
              }}><Copy className="size-4" />{inviteLinkCopied ? "کپی شد" : "کپی لینک دعوت"}</Button>
            </div>
            <div className="flex justify-end border-t pt-4">
              <Button type="button" variant="outline" onClick={() => { setInviteLink(null); setInviteLinkCopied(false); }}>بستن</Button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`مدیریت دسترسی: ${editing.email}`} onClose={() => setEditing(null)} wide>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); saveMutation.mutate(); }}>
            <section className="space-y-3 rounded-xl border p-4">
              <div>
                <h3 className="font-bold">اطلاعات حساب کاربر</h3>
                <p className="mt-1 text-xs leading-6 text-muted-foreground">
                  تغییر ایمیل از طرف مدیر بلافاصله اعمال می‌شود و ایمیل تأیید ارسال نمی‌شود.
                  پیش از تأیید، مالکیت آدرس جدید را خارج از سامانه بررسی کنید.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="edit-staff-full-name">نام نمایشی</Label>
                  <Input id="edit-staff-full-name" value={editFullName}
                    onChange={(event) => setEditFullName(event.target.value)}
                    required minLength={2} maxLength={120} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-staff-email">ایمیل ورود</Label>
                  <Input id="edit-staff-email" type="email" dir="ltr" value={editEmail}
                    onChange={(event) => setEditEmail(event.target.value)} required />
                </div>
              </div>
              {editing && editEmail.trim().toLowerCase() !== editing.email.toLowerCase() && (
                <label className="flex items-start gap-2 text-xs leading-6">
                  <input type="checkbox" className="mt-1 size-4"
                    checked={confirmEmailOwnership}
                    onChange={(event) => setConfirmEmailOwnership(event.target.checked)} />
                  <span>
                    مالکیت ایمیل جدید را بررسی کرده‌ام و تأیید می‌کنم.
                    می‌دانم تغییر ایمیل بدون ارسال پیام تأیید اعمال می‌شود.
                  </span>
                </label>
              )}
              <div className="flex justify-end">
                <Button type="button" variant="outline"
                  disabled={identityMutation.isPending ||
                    editFullName.trim().length < 2 ||
                    !editEmail.trim() ||
                    (!!editing &&
                      editEmail.trim().toLowerCase() !== editing.email.toLowerCase() &&
                      !confirmEmailOwnership)}
                  onClick={() => identityMutation.mutate()}>
                  {identityMutation.isPending ? "در حال ذخیره…" : "ذخیره نام و ایمیل"}
                </Button>
              </div>
            </section>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="edit-staff-role">نقش سازمانی</Label><select id="edit-staff-role" className="h-10 w-full rounded-md border bg-background px-3" value={editRole} onChange={(event) => setEditRole(event.target.value as StaffRole)}>{Object.entries(ROLE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              <div className="space-y-2"><Label htmlFor="edit-staff-active">وضعیت حساب</Label><select id="edit-staff-active" className="h-10 w-full rounded-md border bg-background px-3" value={editActive ? "active" : "inactive"} onChange={(event) => setEditActive(event.target.value === "active")}><option value="active">فعال</option><option value="inactive">غیرفعال</option></select></div>
            </div>
            <div className="space-y-2"><Label htmlFor="edit-partner-id">اتصال اختیاری به شریک مالی</Label><div className="relative"><Link2 className="absolute right-3 top-3 size-4 text-muted-foreground" /><select id="edit-partner-id" className="h-10 w-full rounded-md border bg-background pr-9 pl-3" value={partnerId} onChange={(event) => setPartnerId(event.target.value)}><option value="">بدون اتصال به شریک</option>{partnerOptions.filter((partner) => !partner.linked || partner.id === partnerId).map((partner) => <option key={partner.id} value={partner.id}>{partner.label}</option>)}</select></div><p className="text-xs text-muted-foreground">هر رکورد شریک فقط به یک حساب متصل می‌شود. شرکایی که قبلاً به حساب دیگری متصل‌اند در فهرست انتخاب نمایش داده نمی‌شوند.</p></div>
            <div className="space-y-3">
              <div><h3 className="font-bold">مجوزهای اختصاصی</h3><p className="mt-1 text-xs text-muted-foreground">هر مجوز مستقل است؛ نقش فقط مقدار اولیه را تعیین می‌کند.</p></div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/50"><tr><th className="p-3 text-right">بخش</th>{ACTIONS.map((action) => <th key={action.key} className="p-3 text-center">{action.label}</th>)}</tr></thead>
                  <tbody>{RESOURCES.map((resource) => {
                    const row = permissions.find((item) => item.resource === resource.key)!;
                    return <tr key={resource.key} className="border-t"><td className="p-3 font-medium">{resource.label}</td>{ACTIONS.map((action) => <td key={action.key} className="p-3 text-center"><input aria-label={`${resource.label}: ${action.label}`} type="checkbox" className="size-4 accent-primary" checked={row[action.key]} onChange={(event) => togglePermission(resource.key, action.key, event.target.checked)} /></td>)}</tr>;
                  })}</tbody>
                </table>
              </div>
            </div>
            <div className="flex flex-wrap justify-between gap-2 border-t pt-4"><Button type="button" variant="outline" onClick={() => setEditing(null)}>انصراف</Button><Button type="submit" disabled={saveMutation.isPending}><Save className="size-4" />{saveMutation.isPending ? "در حال ذخیره…" : "ذخیره تغییرات"}</Button></div>
          </form>
        </Modal>
      )}
      {deleteTarget && (
        <Modal title="حذف حساب کارمند" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm leading-7">
              آیا از حذف حساب ورود <strong>{deleteTarget.fullName || deleteTarget.email}</strong> مطمئن هستید؟
            </p>
            <div className="rounded-lg bg-muted p-3 text-xs leading-6 text-muted-foreground">
              حساب ورود، نشست‌ها و مجوزهای کارمند حذف می‌شوند؛ اما رکورد شریک مالی،
              خودروها و سوابق مالی وابسته به آن حذف نمی‌شوند.
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
                انصراف
              </Button>
              <Button type="button" className="bg-destructive text-destructive-foreground"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteTarget.userId)}>
                {deleteMutation.isPending ? "در حال حذف…" : "حذف حساب"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="card-elevated flex items-center gap-3 p-4"><div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">{icon}</div><div><div className="text-xs text-muted-foreground">{label}</div><div className="mt-1 text-xl font-extrabold">{value}</div></div></div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-3" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section role="dialog" aria-modal="true" aria-label={title} className={`card-elevated max-h-[92vh] w-full overflow-y-auto p-5 sm:p-6 ${wide ? "max-w-4xl" : "max-w-lg"}`}><div className="mb-5 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><UserRound className="size-5 text-primary" /><h2 className="font-bold">{title}</h2></div><button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-muted" aria-label="بستن">×</button></div>{children}</section></div>;
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "عملیات انجام نشد. دوباره تلاش کنید.";
}
