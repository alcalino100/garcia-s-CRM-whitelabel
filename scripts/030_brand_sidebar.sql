-- Marca v3: cores da sidebar (identidade por cliente, sem fork de código).
-- Rode UMA VEZ no SQL Editor. Seguro re-rodar.
alter table public.workspace_settings
  add column if not exists sidebar_bg text not null default '#54595f',
  add column if not exists sidebar_fg text not null default '#d4d4d8',
  add column if not exists sidebar_accent text not null default '#45494e';
