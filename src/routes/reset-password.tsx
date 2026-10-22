import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "تغییر رمز | هیربد خودرو" },
      { name: "description", content: "تعیین رمز عبور جدید." },
      { property: "og:title", content: "تغییر رمز عبور" },
      { property: "og:description", content: "تعیین رمز عبور جدید در هیربد خودرو." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Reset,
});

function Reset() {
  const [pw, setPw] = useState("");
  const navigate = useNavigate();
  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { toast.error(error.message); return; }
    toast.success("رمز عبور تغییر کرد");
    navigate({ to: "/auth" });
  }
  return (
    <div className="min-h-screen grid place-items-center bg-hero p-4">
      <form onSubmit={save} className="card-elevated w-full max-w-sm p-6 space-y-4">
        <div className="text-xl font-bold">رمز عبور جدید</div>
        <Input type="password" dir="ltr" minLength={6} value={pw} onChange={(e) => setPw(e.target.value)} required />
        <Button className="w-full">ذخیره</Button>
      </form>
    </div>
  );
}
