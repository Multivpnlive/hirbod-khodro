
CREATE TYPE public.app_role AS ENUM ('admin', 'partner');
CREATE TYPE public.car_status AS ENUM ('available', 'reserved', 'sold');
CREATE TYPE public.txn_type AS ENUM ('receipt', 'payment', 'expense', 'settlement');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE TABLE public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  phone text,
  user_id uuid,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partners TO authenticated;
GRANT ALL ON public.partners TO service_role;
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.my_partner_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.partners WHERE user_id = auth.uid()
$$;

CREATE TABLE public.cars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand text NOT NULL,
  model text NOT NULL,
  year integer,
  color text,
  plate text,
  purchase_price numeric(16,0) NOT NULL DEFAULT 0,
  sale_price numeric(16,0),
  status public.car_status NOT NULL DEFAULT 'available',
  purchase_date date NOT NULL DEFAULT current_date,
  sale_date date,
  notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cars TO authenticated;
GRANT ALL ON public.cars TO service_role;
ALTER TABLE public.cars ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.car_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  title text NOT NULL,
  amount numeric(16,0) NOT NULL DEFAULT 0,
  expense_date date NOT NULL DEFAULT current_date,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.car_expenses TO authenticated;
GRANT ALL ON public.car_expenses TO service_role;
ALTER TABLE public.car_expenses ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.car_investments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES public.cars(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  amount numeric(16,0) NOT NULL CHECK (amount >= 0),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (car_id, partner_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.car_investments TO authenticated;
GRANT ALL ON public.car_investments TO service_role;
ALTER TABLE public.car_investments ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.txn_type NOT NULL,
  amount numeric(16,0) NOT NULL CHECK (amount >= 0),
  txn_date date NOT NULL DEFAULT current_date,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  car_id uuid REFERENCES public.cars(id) ON DELETE SET NULL,
  description text,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.transactions TO authenticated;
GRANT ALL ON public.transactions TO service_role;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- Policies: profiles
CREATE POLICY "own profile read" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- user_roles: read own (admin reads all); no client writes
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- partners
CREATE POLICY "admin all partners" ON public.partners FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads self" ON public.partners FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- cars
CREATE POLICY "admin all cars" ON public.cars FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads invested cars" ON public.cars FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.car_investments ci WHERE ci.car_id = cars.id AND ci.partner_id IN (SELECT public.my_partner_ids())));

-- car_expenses
CREATE POLICY "admin all expenses" ON public.car_expenses FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads invested car expenses" ON public.car_expenses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.car_investments ci WHERE ci.car_id = car_expenses.car_id AND ci.partner_id IN (SELECT public.my_partner_ids())));

-- car_investments: partner sees only own rows
CREATE POLICY "admin all investments" ON public.car_investments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads own investments" ON public.car_investments FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_partner_ids()));

-- transactions: partner sees only own rows
CREATE POLICY "admin all transactions" ON public.transactions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "partner reads own transactions" ON public.transactions FOR SELECT TO authenticated
  USING (partner_id IN (SELECT public.my_partner_ids()));

-- Partner share summary: total investment per car without exposing other partners
CREATE OR REPLACE FUNCTION public.my_car_shares()
RETURNS TABLE (car_id uuid, my_investment numeric, total_investment numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ci.car_id, SUM(ci.amount) AS my_investment,
    (SELECT SUM(x.amount) FROM public.car_investments x WHERE x.car_id = ci.car_id) AS total_investment
  FROM public.car_investments ci
  WHERE ci.partner_id IN (SELECT id FROM public.partners WHERE user_id = auth.uid())
  GROUP BY ci.car_id
$$;
REVOKE EXECUTE ON FUNCTION public.my_car_shares() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.my_car_shares() TO authenticated;

-- Signup: profile + role (first user = admin) + link partner by email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'partner');
  END IF;
  UPDATE public.partners SET user_id = NEW.id
    WHERE user_id IS NULL AND email IS NOT NULL AND lower(email) = lower(NEW.email);
  RETURN NEW;
END $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- When admin adds a partner with an email of an existing user, link it
CREATE OR REPLACE FUNCTION public.link_partner_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS NOT NULL AND NEW.email <> '' THEN
    SELECT id INTO NEW.user_id FROM public.profiles WHERE lower(email) = lower(NEW.email) LIMIT 1;
  ELSE
    NEW.user_id := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER partners_link_user BEFORE INSERT OR UPDATE OF email ON public.partners
  FOR EACH ROW EXECUTE FUNCTION public.link_partner_user();

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.link_partner_user() FROM anon, authenticated, public;

-- Demo data (is_demo = true, kept separate from real data)
INSERT INTO public.partners (id, name, phone, is_demo) VALUES
 ('00000000-0000-0000-0000-0000000000a1','علی رضایی (نمونه)','09120000001',true),
 ('00000000-0000-0000-0000-0000000000a2','مریم کریمی (نمونه)','09120000002',true),
 ('00000000-0000-0000-0000-0000000000a3','حسین محمدی (نمونه)','09120000003',true);

INSERT INTO public.cars (id, brand, model, year, color, plate, purchase_price, sale_price, status, purchase_date, sale_date, is_demo) VALUES
 ('00000000-0000-0000-0000-0000000000c1','تویوتا','کمری',2018,'سفید','۱۲ ب ۳۴۵ ایران ۱۰',3500000000,4100000000,'sold','2026-05-02','2026-06-20',true),
 ('00000000-0000-0000-0000-0000000000c2','هیوندای','سوناتا',2017,'مشکی','۴۵ ج ۶۷۸ ایران ۲۰',2800000000,3050000000,'sold','2026-06-10','2026-07-28',true),
 ('00000000-0000-0000-0000-0000000000c3','کیا','اسپورتیج',2019,'نقره‌ای','۷۸ د ۹۱۲ ایران ۳۰',3200000000,2950000000,'sold','2026-07-05','2026-08-30',true),
 ('00000000-0000-0000-0000-0000000000c4','پژو','۲۰۷',2023,'خاکستری','۲۳ س ۴۵۶ ایران ۴۰',950000000,NULL,'available','2026-09-12',NULL,true),
 ('00000000-0000-0000-0000-0000000000c5','مزدا','۳',2016,'قرمز','۳۴ ط ۵۶۷ ایران ۵۰',1900000000,2150000000,'reserved','2026-09-25',NULL,true);

INSERT INTO public.car_expenses (car_id, title, amount, expense_date, is_demo) VALUES
 ('00000000-0000-0000-0000-0000000000c1','کارشناسی و تعویض روغن',45000000,'2026-05-10',true),
 ('00000000-0000-0000-0000-0000000000c1','صافکاری',80000000,'2026-05-20',true),
 ('00000000-0000-0000-0000-0000000000c2','لاستیک نو',60000000,'2026-06-15',true),
 ('00000000-0000-0000-0000-0000000000c3','تعمیر گیربکس',150000000,'2026-07-20',true),
 ('00000000-0000-0000-0000-0000000000c4','کارواش و پولیش',8000000,'2026-09-15',true),
 ('00000000-0000-0000-0000-0000000000c5','سرویس کامل',35000000,'2026-09-28',true);

INSERT INTO public.car_investments (car_id, partner_id, amount, is_demo) VALUES
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a1',2000000000,true),
 ('00000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-0000000000a2',1500000000,true),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a2',1400000000,true),
 ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000a3',1400000000,true),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a1',1600000000,true),
 ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-0000000000a3',1600000000,true),
 ('00000000-0000-0000-0000-0000000000c4','00000000-0000-0000-0000-0000000000a1',950000000,true),
 ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a2',1000000000,true),
 ('00000000-0000-0000-0000-0000000000c5','00000000-0000-0000-0000-0000000000a3',900000000,true);

INSERT INTO public.transactions (type, amount, txn_date, partner_id, car_id, description, is_demo) VALUES
 ('receipt',2000000000,'2026-05-01','00000000-0000-0000-0000-0000000000a1',NULL,'واریز سرمایه',true),
 ('receipt',1500000000,'2026-05-01','00000000-0000-0000-0000-0000000000a2',NULL,'واریز سرمایه',true),
 ('payment',3500000000,'2026-05-02',NULL,'00000000-0000-0000-0000-0000000000c1','خرید کمری',true),
 ('receipt',4100000000,'2026-06-20',NULL,'00000000-0000-0000-0000-0000000000c1','فروش کمری',true),
 ('expense',12000000,'2026-07-01',NULL,NULL,'اجاره پارکینگ',true),
 ('settlement',300000000,'2026-07-05','00000000-0000-0000-0000-0000000000a2',NULL,'تسویه سود معامله کمری',true),
 ('receipt',3050000000,'2026-07-28',NULL,'00000000-0000-0000-0000-0000000000c2','فروش سوناتا',true);
