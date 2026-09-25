-- Renomeia a etapa "visita agendada" -> "reuniao agendada" (Trafichub: agência).
-- Seguro re-rodar. Rode no banco do cliente.
update public.leads
set status = 'reuniao agendada', atualizado_em = now()
where status = 'visita agendada';

update public.pipeline_stages
set key = 'reuniao agendada', label = 'Reunião Agendada', updated_at = now()
where key = 'visita agendada';
