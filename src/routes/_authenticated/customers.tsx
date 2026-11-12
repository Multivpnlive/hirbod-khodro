import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/AppShell";
import { usePerms } from "@/lib/data";
import { errorText } from "@/lib/feature-utils";

export const Route = createFileRoute("/_authenticated/customers")({
  head: () => ({ meta: [{ title: "مشتریان | هیربد خودرو" }] }),
  component: CustomersPage,
});

const db = supabase as any;

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  national_id: string | null;
  notes: string | null;
  is_demo: boolean;
};

function CustomersPage() {
  const { isAdmin, can } = usePerms();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [busy, setBusy] = useState(false);

  const mayView = isAdmin || can("customers", "view");
  const mayCreate = isAdmin || can("customers", "create");

  async function load() {
    if (!mayView) return;

    const { data, error } = await db
      .from("customers")
      .select("id,name,phone,national_id,notes,is_demo")
      .eq("is_demo", false)
      .order("created_at", { ascending: false });

    if (error) {
      toast.error(`بارگذاری مشتریان: ${error.message}`);
    } else {
      setCustomers((data ?? []) as Customer[]);
    }
  }

  useEffect(() => {
    void load();
  }, [mayView]);

  async function createCustomer(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!mayCreate) return;

    setBusy(true);
    const form = e.currentTarget;
    const f = new FormData(form);

    const payload = {
      name: String(f.get("name") ?? "").trim(),
      phone: String(f.get("phone") ?? "").trim() || null,
      national_id: String(f.get("national_id") ?? "").trim() || null,
      notes: String(f.get("notes") ?? "").trim() || null,
      is_demo: false,
    };

    if (!payload.name) {
      toast.error("نام مشتری الزامی است");
      setBusy(false);
      return;
    }

    const { error } = await db.from("customers").insert(payload);

    if (error) {
      toast.error(errorText(error));
      setBusy(false);
      return;
    }

    toast.success("مشتری ثبت شد");
    form.reset();
    await load();
    setBusy(false);
  }

  if (!mayView) {
    return (
      <div className="rounded-xl border p-5 text-sm text-muted-foreground">
        شما مجوز مشاهده فهرست مشتریان را ندارید.
      </div>
    );
  }

  return (
    <div className="space-y-5" dir="rtl">
      <PageHeader title="مشتریان" />

      {mayCreate && (
        <form
          onSubmit={createCustomer}
          className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-2"
        >
          <h2 className="font-semibold md:col-span-2">ثبت مشتری جدید</h2>

          <label className="grid gap-1 text-sm">
            نام و نام خانوادگی
            <input
              name="name"
              required
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm">
            تلفن
            <input
              name="phone"
              inputMode="tel"
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm">
            کد ملی
            <input
              name="national_id"
              inputMode="numeric"
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>

          <label className="grid gap-1 text-sm md:col-span-2">
            یادداشت
            <textarea
              name="notes"
              rows={2}
              className="rounded-md border bg-background px-3 py-2"
            />
          </label>

          <button
            disabled={busy}
            className="rounded-lg bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50 md:col-span-2"
          >
            {busy ? "در حال ثبت…" : "ثبت مشتری"}
          </button>
        </form>
      )}

      <section className="space-y-3">
        <h2 className="font-semibold">
          فهرست مشتریان ({customers.length.toLocaleString("fa-IR")})
        </h2>

        {customers.map((c) => (
          <article
            key={c.id}
            className="rounded-xl border bg-card p-4"
          >
            <h3 className="font-semibold">{c.name}</h3>
            <p className="text-sm text-muted-foreground">
              {c.phone || "تلفن ثبت نشده"}
              {c.national_id ? ` · کد ملی ${c.national_id}` : ""}
            </p>
            {c.notes && (
              <p className="mt-1 text-sm">{c.notes}</p>
            )}
          </article>
        ))}

        {customers.length === 0 && (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">
            هنوز مشتری ثبت نشده است.
          </p>
        )}
      </section>
    </div>
  );
}
