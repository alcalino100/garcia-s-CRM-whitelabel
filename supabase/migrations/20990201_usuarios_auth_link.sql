-- Corte Auth: vínculo usuarios <-> auth.users (Supabase Auth).
-- Aditivo e seguro: coluna anulável, sem FK cross-schema, sem backfill.
-- O espelho é preenchido no login (app/api/auth/login/route.ts). Rode quando quiser.
alter table public.usuarios
  add column if not exists auth_user_id uuid unique;
