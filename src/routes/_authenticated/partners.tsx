import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Link2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AdminOnly, PageHeader } from "@/components/AppShell";
import { useAllData } from "@/lib/data";
import { partnerSummary } from "@/lib/summary";
import { toman } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DemoTag, Field } from "@/components/form-bits";

export const Route = createFileRoute("/_authenticated/partners")({
  head: () => ({ meta: [{ title: "شرکا | هیربد خودرو" }] }),
  component: () => (
    <AdminOnly>
      <Partners />
    </AdminOnly>
  ),
});

function Partners() {
  const d = useAllData();
  return (
    <div>
      <PageHeader title="شرکا" action={<AddPartner />} />
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {d.partners.map((p) => {
          const s = partnerSummary(p.id, d);
          return (
            <div key={p.id} className="card-elevated p-4">
              <div className="flex items-center justify-between">
                <div className="font-bold">{p.name} <DemoTag show={p.is_demo} /></div>
                {p.user_id && <span className="flex items-center gap-1 text-xs text-success"><Link2 className="size-3" /> حساب متصل</span>}
              </div>
              <div className="text-xs text-muted-foreground mt-1" dir="ltr">{p.email || p.phone}</div>
              <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                <div><div className="text-xs text-muted-foreground">سرمایه در معاملات</div>{toman(s.capital)}</div>
                <div><div className="text-xs text-muted-foreground">تعداد معامله</div>{s.deals}</div>
                <div><div className="text-xs text-muted-foreground">سهم سود/زیان</div><span className={s.profit >= 0 ? "text-success" : "text-destructive"}>{toman(s.profit)}</span></div>
                <div><div className="text-xs text-muted-foreground">مانده قابل تسویه</div><b>{toman(s.due)}</b></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
    if (error) return toast.error(error.message);
    toast.success("شریک اضافه شد");
    qc.invalidateQueries({ queryKey: ["all-data"] });
    setOpen(false);
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus className="size-4" /> شریک جدید</Button></DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader><DialogTitle>افزودن شریک</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Field label="نام"><Input name="name" required /></Field>
          <Field label="ایمیل (برای دسترسی شریک به حساب خودش)"><Input name="email" type="email" dir="ltr" /></Field>
          <Field label="تلفن"><Input name="phone" dir="ltr" /></Field>
          <Button className="w-full">ذخیره</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
