import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Props = { partnerId: string };
type Flags = {
  can_view_customers: boolean;
  can_view_customer_finance: boolean;
  can_manage_customers: boolean;
  can_view_brokerage: boolean;
  can_view_hawala: boolean;
  can_view_custody: boolean;
};
const DEFAULTS: Flags = {
  can_view_customers: false,
  can_view_customer_finance: false,
  can_manage_customers: false,
  can_view_brokerage: false,
  can_view_hawala: false,
  can_view_custody: false,
};
const LABELS: { key: keyof Flags; label: string }[] = [
  { key: "can_view_customers", label: "مشاهده مشتریانِ مجاز" },
  { key: "can_view_customer_finance", label: "مشاهده اطلاعات مالی مشتری" },
  { key: "can_manage_customers", label: "مدیریت مشتریانِ مجاز" },
  { key: "can_view_brokerage", label: "مشاهده معاملات کارگزاری" },
  { key: "can_view_hawala", label: "مشاهده حواله‌ها" },
  { key: "can_view_custody", label: "مشاهده وجوه امانیِ مشتریانِ مجاز" },
];
const db = supabase as any;

export function PartnerFeaturePermissions({ partnerId }: Props) {
  const [open, setOpen] = useState(false);
  const [flags, setFlags] = useState<Flags>(DEFAULTS);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void db.from("partner_permissions").select(Object.keys(DEFAULTS).join(",")).eq("partner_id", partnerId).maybeSingle().then(({ data, error }: any) => {
      if (!active) return;
      if (error) { toast.error(error.message); return; }
      setFlags({ ...DEFAULTS, ...(data ?? {}) });
    });
    return () => { active = false; };
  }, [open, partnerId]);

  async function save() {
    setBusy(true);
    // Update only the six new columns so existing car/payment/settlement permissions are preserved.
    const { data: existing, error: readError } = await db
      .from("partner_permissions")
      .select("partner_id")
      .eq("partner_id", partnerId)
      .maybeSingle();
    if (readError) {
      setBusy(false);
      toast.error(readError.message);
      return;
    }
    const result = existing
      ? await db.from("partner_permissions").update(flags).eq("partner_id", partnerId)
      : await db.from("partner_permissions").insert({ partner_id: partnerId, ...flags });
    setBusy(false);
    if (result.error) { toast.error(result.error.message); return; }
    toast.success("مجوزهای مشتری، حواله و کارگزاری ذخیره شد");
    setOpen(false);
  }

  return <div className="mt-2">
    <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setOpen((v) => !v)}>
      {open ? "بستن مجوزهای مالی جدید" : "مجوزهای مشتری، حواله و کارگزاری"}
    </Button>
    {open && <div className="mt-3 space-y-3 rounded-lg border p-3">
      {LABELS.map(({ key, label }) => <label key={key} className="flex items-center justify-between gap-3 text-sm">{label}<Switch checked={flags[key]} onCheckedChange={(checked) => setFlags((old) => ({ ...old, [key]: checked }))} /></label>)}
      <Button type="button" className="w-full" disabled={busy} onClick={() => void save()}>{busy ? "در حال ذخیره…" : "ذخیره مجوزهای جدید"}</Button>
    </div>}
  </div>;
}
