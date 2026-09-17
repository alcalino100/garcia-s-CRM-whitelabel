-- ============================================================================
-- RASCUNHO Fase 2 — NÃO RODAR AINDA.
-- Só aplicar APÓS o corte para Supabase Auth (JWT com claim workspace_id),
-- pois o app atual usa sessões próprias e seria bloqueado pelo RLS.
-- service_role (server) sempre bypassa; estas policies valem para anon/autenticated.
-- ============================================================================

do $$
declare
  t text;
  tabelas text[] := array[
    'leads', 'usuarios', 'ai_agents', 'automations', 'automation_jobs',
    'automation_logs', 'whatsapp_mensagens', 'whatsapp_instancias',
    'conversations_ia', 'messages_ia', 'notificacoes', 'visitas',
    'pipeline_stages', 'workspace_settings', 'knowledge_bases', 'documents'
  ];
begin
  foreach t in array tabelas loop
    execute format('alter table public.%I enable row level security', t);

    execute format(
      'create policy %I isolado em %I on public.%I for all using (workspace_id = (auth.jwt() ->> ''workspace_id'')) with check (workspace_id = (auth.jwt() ->> ''workspace_id''))',
      'tenant_isolation', t, t);
  end loop;
end $$;
