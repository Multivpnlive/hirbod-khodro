
CREATE TABLE IF NOT EXISTS public.user_appearance_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  theme_preset text NOT NULL DEFAULT 'turquoise'
    CHECK (theme_preset IN ('turquoise', 'blue', 'warm_gray')),
  color_mode text NOT NULL DEFAULT 'dark'
    CHECK (color_mode IN ('light', 'dark')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_appearance_preferences ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE
ON public.user_appearance_preferences TO authenticated;

REVOKE ALL
ON public.user_appearance_preferences FROM anon;

DROP POLICY IF EXISTS appearance_read_own
ON public.user_appearance_preferences;

CREATE POLICY appearance_read_own
ON public.user_appearance_preferences
FOR SELECT TO authenticated
USING (user_id = auth.uid());

DROP POLICY IF EXISTS appearance_insert_own
ON public.user_appearance_preferences;

CREATE POLICY appearance_insert_own
ON public.user_appearance_preferences
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS appearance_update_own
ON public.user_appearance_preferences;

CREATE POLICY appearance_update_own
ON public.user_appearance_preferences
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

NOTIFY pgrst, 'reload schema';
