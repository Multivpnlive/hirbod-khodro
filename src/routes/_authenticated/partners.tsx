import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Link2, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PermOnly, PageHeader } from "@/components/AppShell";
import { PartnerFeaturePermissions } from "@/components/PartnerFeaturePermissions";
import { PERM_LABELS, useAllData, usePerms, type Partner, type Perms } from "@/lib/data";
import { partnerSummary } from "@/lib/summary";
import { toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

function Partners() {
  const d = useAllData();
  const { isAdmin } = usePerms();
  return (
    <div>
      <PageHeader title="شرکا" action={isAdmin ? <AddPartner /> : undefined} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {d.partners.map((p) => {
          const s = partnerSummary(p.id, d);
          return (
            <div key={p.id} className="card-elevated p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold">{p.name}</div>
                {p.user_id && (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Link2 className="size-3" /> حساب متصل
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1" dir="ltr">
                {p.email || p.phone}
              </div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div>
                  <div className="text-xs text-muted-foreground">سرمایه در معاملات</div>
                  {toman(s.capital)}
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">تعداد معامله</div>
                  {s.deals}
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
              {isAdmin && (
                <div className="mt-4 border-t pt-3">
                  <PermissionsEditor partner={p} />
                  <PartnerFeaturePermissions partnerId={p.id} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const EMPTY_PERMS: Perms = {
  view_all_cars: false,
  create_car: false,
  edit_car: false,
  add_expense: false,
  add_payment: false,
  manage_settlements: false,
  view_all_partners: false,
};

function PermissionsEditor({ partner }: { partner: Partner }) {
  const [open, setOpen] = useState(false);
  const [perms, setPerms] = useState<Perms>(EMPTY_PERMS);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();

  async function load() {
    const { data } = await supabase
      .from("partner_permissions")
      .select("*")
      .eq("partner_id", partner.id)
      .maybeSingle();
    setPerms(
      data
        ? {
            view_all_cars: data.can_view_all_cars,
            create_car: data.can_create_car,
            edit_car: data.can_edit_car,
            add_expense: data.can_add_expense,
            add_payment: data.can_add_payment,
            manage_settlements: data.can_manage_settlements,
            view_all_partners: data.can_view_all_partners,
          }
        : EMPTY_PERMS,
    );
  }

  async function save() {
    setBusy(true);
    const { error } = await supabase.from("partner_permissions").upsert(
      {
        partner_id: partner.id,
        can_view_all_cars: perms.view_all_cars,
        can_create_car: perms.create_car,
        can_edit_car: perms.edit_car,
        can_add_expense: perms.add_expense,
        can_add_payment: perms.add_payment,
        can_manage_settlements: perms.manage_settlements,
        can_view_all_partners: perms.view_all_partners,
      },
      { onConflict: "partner_id" },
    );
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("مجوزها ذخیره شد");
    qc.invalidateQueries({ queryKey: ["my-perms"] });
    setOpen(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) load();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full">
          <ShieldCheck className="size-4" /> مجوزهای دسترسی
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>مجوزهای {partner.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {PERM_LABELS.map(({ key, label }) => (
            <label key={key} className="flex items-center justify-between gap-3 text-sm">
              {label}
              <Switch
                checked={perms[key]}
                onCheckedChange={(v) => setPerms((s) => ({ ...s, [key]: v }))}
              />
            </label>
          ))}
          <Button className="w-full" onClick={save} disabled={busy}>
            ذخیره مجوزها
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddPartner() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const { error } = await supabase.from("partners").insert({
      name: String(f.get("name")),
      email: String(f.get("email") || "").trim() || null,
      phone: String(f.get("phone") || ""),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("شریک اضافه شد");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" /> شریک جدید
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>افزودن شریک</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام">
            <Input name="name" required />
          </Field>
          <Field label="ایمیل (برای دسترسی شریک به حساب خودش)">
            <Input name="email" type="email" dir="ltr" />
          </Field>
          <Field label="تلفن">
            <Input name="phone" dir="ltr" />
          </Field>
          <Button className="w-full">ذخیره</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
