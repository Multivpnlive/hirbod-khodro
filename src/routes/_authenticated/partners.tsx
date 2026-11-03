import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PermOnly, PageHeader } from "@/components/AppShell";
import { useAllData, usePerms, type Partner } from "@/lib/data";
import { partnerSummary } from "@/lib/summary";
import { toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Field } from "@/components/form-bits";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "شرکا | هیربد خودرو" }] }),
  component: () => (
    <PermOnly perm="view_all_partners">
      <Partners />
    </PermOnly>
  ),
});

type PartnerRow = Partner & { is_active?: boolean };

function Partners() {
  const d = useAllData();
  const { isAdmin, can } = usePerms();
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<PartnerRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const allPartners = (d.partners ?? []) as PartnerRow[];
  const activePartners = allPartners.filter((p) => p.is_active !== false);
  const inactivePartners = allPartners.filter((p) => p.is_active === false);
  const displayed = showInactive ? inactivePartners : activePartners;

  async function changeStatus(partner: PartnerRow, active: boolean) {
    if (partner.is_owner) {
      toast.error("پرونده شریک مالک قابل حذف یا غیرفعال‌سازی نیست.");
      return;
    }

    const message = active
      ? `شریک «${partner.name}» دوباره فعال شود؟`
      : `شریک «${partner.name}» از فهرست فعال حذف شود؟ سوابق مالی او حفظ خواهد شد.`;

    if (!window.confirm(message)) return;

    setBusyId(partner.id);
    const { error } = await (supabase as any).rpc("set_partner_active", {
      _partner_id: partner.id,
      _is_active: active,
    });

    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success(active ? "شریک فعال شد." : "شریک غیرفعال شد؛ سوابق مالی حفظ شدند.");
    await qc.invalidateQueries({ queryKey: ["all-data"] });
  }

  const mayCreate = isAdmin || can("partners", "create");
  const mayEdit = isAdmin || can("partners", "edit");
  const mayDelete = isAdmin || can("partners", "delete");

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader title="شرکا" action={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setShowInactive((v) => !v)}>
            {showInactive ? "شرکای فعال" : `شرکای غیرفعال (${inactivePartners.length.toLocaleString("fa-IR")})`}
          </Button>
          {mayCreate && <AddPartner />}
        </div>
      } />

      <div className="text-sm text-muted-foreground">
        {showInactive ? "شرکای غیرفعال" : "شرکای فعال"}:
        {" "}{displayed.length.toLocaleString("fa-IR")}
      </div>

      {d.isLoading ? (
        <div className="rounded-xl border p-6 text-center text-muted-foreground">در حال بارگذاری…</div>
      ) : displayed.length === 0 ? (
        <div className="rounded-xl border p-6 text-center text-muted-foreground">
          {showInactive ? "شریک غیرفعالی وجود ندارد." : "هنوز شریکی ثبت نشده است."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {displayed.map((p) => {
            const s = partnerSummary(p.id, d);
            return (
              <div key={p.id} className="card-elevated space-y-4 p-4">
                <div>
                  <div className="font-bold text-base">{p.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground" dir="ltr">
                    {p.phone || "شماره موبایل ثبت نشده"}
                  </div>
                  {showInactive && (
                    <span className="mt-2 inline-block rounded-full bg-muted px-2 py-1 text-xs">
                      غیرفعال
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3 border-t pt-3 text-sm">
                  <div>
                    <div className="text-xs text-muted-foreground">سرمایه در معاملات</div>
                    {toman(s.capital)}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">تعداد معامله</div>
                    {s.deals.toLocaleString("fa-IR")}
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">سهم سود/زیان</div>
                    <span className={s.profit >= 0 ? "text-success" : "text-destructive"}>
                      {toman(s.profit)}
                    </span>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">مانده بدهی به شریک</div>
                    <b>{toman(s.due)}</b>
                  </div>
                </div>

                {(mayEdit || mayDelete) && !p.is_owner && (
                  <div className="flex flex-wrap gap-2 border-t pt-3">
                    {mayEdit && !showInactive && (
                      <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                        <Pencil className="size-4" /> ویرایش
                      </Button>
                    )}
                    {mayDelete && !showInactive && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive"
                        disabled={busyId === p.id}
                        onClick={() => void changeStatus(p, false)}
                      >
                        <Trash2 className="size-4" /> حذف
                      </Button>
                    )}
                    {mayEdit && showInactive && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === p.id}
                        onClick={() => void changeStatus(p, true)}
                      >
                        <RotateCcw className="size-4" /> فعال‌سازی مجدد
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <EditPartner
          key={editing.id}
          partner={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function AddPartner() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const name = String(f.get("name") ?? "").trim();
    const phone = String(f.get("phone") ?? "").trim();

    if (!name) {
      toast.error("نام شریک الزامی است.");
      return;
    }

    setBusy(true);
    const { error } = await (supabase as any).from("partners").insert({
      name,
      phone: phone || null,
      email: null,
      is_active: true,
      user_id: null,
    });

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("شریک اضافه شد.");
    await qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="size-4" /> شریک جدید</Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>افزودن شریک</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام و نام خانوادگی">
            <Input name="name" required maxLength={160} />
          </Field>
          <Field label="شماره موبایل">
            <Input name="phone" type="tel" dir="ltr" inputMode="tel" />
          </Field>
          <Button className="w-full" disabled={busy}>
            {busy ? "در حال ذخیره…" : "ذخیره شریک"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPartner({
  partner,
  onClose,
}: {
  partner: PartnerRow;
  onClose: () => void;
}) {
  const [name, setName] = useState(partner.name);
  const [phone, setPhone] = useState(partner.phone ?? "");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("نام شریک الزامی است.");
      return;
    }

    setBusy(true);
    const { error } = await (supabase as any)
      .from("partners")
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
      })
      .eq("id", partner.id);

    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("اطلاعات شریک ویرایش شد.");
    await qc.invalidateQueries({ queryKey: ["all-data"] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>ویرایش شریک</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام و نام خانوادگی">
            <Input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} />
          </Field>
          <Field label="شماره موبایل">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr" inputMode="tel" />
          </Field>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={busy}>
              {busy ? "در حال ذخیره…" : "ذخیره تغییرات"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose}>انصراف</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
