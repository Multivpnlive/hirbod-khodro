
CREATE TABLE IF NOT EXISTS public.app_branding (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  app_name text NOT NULL DEFAULT 'هیربد خودرو',
  company_name text NOT NULL DEFAULT 'هیربد خودرو',
  logo_url text,
  logo_path text,
  primary_color text NOT NULL DEFAULT '#0e8790'
    CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text NOT NULL DEFAULT '#082f49'
    CHECK (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  contact_phone text,
  contact_email text,
  website text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_branding (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_branding ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.app_branding TO anon, authenticated;
GRANT ALL ON public.app_branding TO service_role;

REVOKE INSERT, UPDATE, DELETE ON public.app_branding
FROM anon, authenticated;

DROP POLICY IF EXISTS app_branding_public_read ON public.app_branding;
CREATE POLICY app_branding_public_read ON public.app_branding
FOR SELECT TO anon, authenticated USING (true);

NOTIFY pgrst, 'reload schema';
