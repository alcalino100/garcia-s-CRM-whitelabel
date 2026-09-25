-- Fase 2 Master: etapas do pipeline editáveis (rótulo/cor/ordem/visibilidade).
-- SEED IDÊNTICO ao código atual: sem override, nada muda visualmente.
-- Chaves (key) são estáveis e referenciadas por automações — NÃO renomear via painel.
-- Rode UMA VEZ no SQL Editor do Supabase. Seguro re-rodar.
create table if not exists public.pipeline_stages (
  key text primary key,
  label text not null,
  variant text not null default 'slate',
  accent text not null default '#54595f',
  ordem integer not null default 99,
  visivel_corretor boolean not null default true,
  ativo boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.pipeline_stages (key, label, variant, accent, ordem, visivel_corretor, ativo) values
  ('novo', 'Novo Lead', 'blue', '#0ea5e9', 1, true, true),
  ('em_atendimento', 'Em Atendimento', 'indigo', '#4f46e5', 2, true, true),
  ('em_automacao', 'Em Automação', 'sky', '#06b6d4', 3, false, true),
  ('atendimento_ia', 'Atendimento IA', 'cyan', '#22d3ee', 4, false, true),
  ('atendimento_humano', 'Aguardando Atendimento', 'violet', '#7c3aed', 5, true, true),
  ('em_followup', 'Em Follow-up', 'orange', '#f97316', 6, false, true),
  ('escolhendo opcoes', 'Separando Opções', 'slate', '#54595f', 7, true, true),
  ('reuniao agendada', 'Reunião Agendada', 'amber', '#f59e0b', 8, true, true),
  ('negociando', 'Negociando', 'accent', '#b22222', 9, true, true),
  ('fechado', 'Fechado', 'green', '#16a34a', 10, true, true),
  ('imovel necessidade', 'Imóvel - Necessidade', 'teal', '#0d9488', 11, true, true),
  ('permuta', 'Permuta', 'purple', '#9333ea', 12, true, true),
  ('perdido', 'Perdido', 'gray', '#a1a1aa', 13, false, true)
on conflict (key) do nothing;
