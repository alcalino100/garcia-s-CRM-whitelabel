// =============================================================================
// automation-types.ts — Tipos do módulo de Automações de Leads
// =============================================================================

// ---------- Configurações globais ----------
export interface AutomationGlobalSettings {
  id: string
  organization_id: string
  default_timezone: string
  default_supervisor_user_id: string | null
  default_start_hour: string
  default_end_hour: string
  default_allowed_days: number[]
  default_max_daily_sends: number
  default_max_sends_per_lead: number
  default_min_interval_minutes: number
  default_retry_limit: number
  default_retry_interval_minutes: number
  system_enabled: boolean
  created_at: string
  updated_at: string
}

// ---------- Templates de mensagem ----------
export type AutomationChannel = "whatsapp"
export type AutomationContentType = "text" | "image" | "document" | "audio" | "video" | "template"
export type AutomationTemplateStatus = "active" | "inactive"

export interface AutomationMessageTemplate {
  id: string
  organization_id: string
  name: string
  channel: AutomationChannel
  content_type: AutomationContentType
  content: string
  variables: string[]
  media_url: string | null
  whatsapp_template_name: string | null
  status: AutomationTemplateStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

// ---------- Automações (regras) ----------
export type AutomationStatus = "draft" | "active" | "paused" | "inactive"
export type AutomationTriggerType =
  | "lead_created"
  | "lead_entered_stage"
  | "lead_received_tag"
  | "lead_inactive"
  | "lead_temperature_changed"

export type ConditionOperator =
  | "equals"
  | "not_equals"
  | "contains"
  | "not_contains"
  | "greater_than"
  | "less_than"

export interface AutomationCondition {
  field: string
  operator: ConditionOperator
  value: string | number | boolean
}

export interface AutomationConditionGroup {
  mode: "and" | "or"
  rules: AutomationCondition[]
}

export interface AutomationWaitConfig {
  amount: number
  unit: "minutes" | "hours" | "days"
  allowed_start_hour?: string
  allowed_end_hour?: string
  allowed_days?: number[]
  timezone?: string
}

export interface AutomationCancellationRules {
  cancel_on_manual_message?: boolean
  cancel_on_note?: boolean
  cancel_on_stage_change?: boolean
  cancel_on_responsible_change?: boolean
  cancel_on_temperature_change?: boolean
  cancel_on_tag_removed?: boolean
  cancel_on_stage_left?: boolean
  cancel_on_became_not_cold?: boolean
  cancel_on_lead_replied?: boolean
  cancel_on_lost?: boolean
  cancel_on_converted?: boolean
  cancel_on_archived?: boolean
  cancel_on_automated_paused?: boolean
  cancel_on_phone_invalid?: boolean
}

export interface AutomationLimitsConfig {
  max_sends_per_lead?: number
  max_daily_sends?: number
  min_interval_between_messages_minutes?: number
  block_window_hours?: number
  pause_on_failure_rate?: number
}

export interface Automation {
  id: string
  organization_id: string
  name: string
  slug: string
  description: string | null
  category: string
  status: AutomationStatus
  priority: number
  trigger_type: AutomationTriggerType
  trigger_config: Record<string, unknown>
  conditions: AutomationConditionGroup
  wait_config: AutomationWaitConfig
  cancellation_rules: AutomationCancellationRules
  message_template_id: string | null
  whatsapp_connection_id: string | null
  supervision_enabled: boolean
  supervisor_user_id: string | null
  keep_current_agent: boolean
  create_automatic_note: boolean
  automatic_note_template: string
  limits_config: AutomationLimitsConfig
  is_test_mode: boolean
  is_simulation_mode: boolean
  created_by: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

// ---------- Status da fila ----------
export type AutomationJobStatus =
  | "pending_validation"
  | "scheduled"
  | "processing"
  | "sent"
  | "delivered"
  | "read"
  | "responded"
  | "failed"
  | "cancelled_human"
  | "cancelled_condition"
  | "cancelled_manual"
  | "paused"
  | "blocked_hour"
  | "blocked_limit"
  | "retrying"
  | "supervision_pending"
  | "supervision_applied"
  | "supervision_failed"

export const AUTOMATION_JOB_STATUS_LABEL: Record<AutomationJobStatus, string> = {
  pending_validation: "Aguardando validação",
  scheduled: "Agendado",
  processing: "Em processamento",
  sent: "Enviado",
  delivered: "Entregue",
  read: "Lido",
  responded: "Respondido",
  failed: "Falhou",
  cancelled_human: "Cancelado por interação humana",
  cancelled_condition: "Cancelado por condição inválida",
  cancelled_manual: "Cancelado manualmente",
  paused: "Pausado",
  blocked_hour: "Bloqueado por horário",
  blocked_limit: "Bloqueado por limite",
  retrying: "Aguardando nova tentativa",
  supervision_pending: "Supervisão pendente",
  supervision_applied: "Supervisão aplicada",
  supervision_failed: "Falha na supervisão",
}

export const AUTOMATION_JOB_STATUS_VARIANT: Record<AutomationJobStatus, string> = {
  pending_validation: "amber",
  scheduled: "blue",
  processing: "indigo",
  sent: "green",
  delivered: "green",
  read: "green",
  responded: "teal",
  failed: "red",
  cancelled_human: "slate",
  cancelled_condition: "gray",
  cancelled_manual: "red",
  paused: "slateblue",
  blocked_hour: "amber",
  blocked_limit: "red",
  retrying: "amber",
  supervision_pending: "purple",
  supervision_applied: "green",
  supervision_failed: "red",
}

export type SupervisionStatus = "pending" | "applied" | "failed" | null

// ---------- Job da fila ----------
export interface AutomationJob {
  id: string
  organization_id: string
  automation_id: string
  lead_id: string
  assigned_agent_id: string | null
  supervisor_user_id: string | null
  status: AutomationJobStatus
  scheduled_at: string
  validated_at: string | null
  processing_started_at: string | null
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  responded_at: string | null
  cancelled_at: string | null
  failed_at: string | null
  next_retry_at: string | null
  attempts: number
  max_attempts: number
  cancellation_reason: string | null
  failure_reason: string | null
  failure_code: string | null
  cancellation_event_id: string | null
  message_content_rendered: string | null
  provider_message_id: string | null
  provider_response: Record<string, unknown> | null
  last_human_interaction_at: string | null
  eligible_at: string | null
  locked_at: string | null
  locked_by: string | null
  supervision_status: SupervisionStatus
  supervision_applied_at: string | null
  supervision_error: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ---------- Logs ----------
export type AutomationEventType =
  | "lead_evaluated"
  | "lead_eligible"
  | "lead_not_eligible"
  | "job_created"
  | "job_scheduled"
  | "job_revalidated"
  | "job_cancelled"
  | "message_prepared"
  | "message_sent"
  | "message_delivered"
  | "message_read"
  | "lead_responded"
  | "send_failed"
  | "retry_created"
  | "supervision_requested"
  | "supervision_applied"
  | "supervision_failed"
  | "automation_paused"
  | "automation_activated"
  | "config_changed"
  | "test_executed"

export type AutomationActorType = "system" | "user" | "corretor" | "worker"

export interface AutomationLog {
  id: string
  organization_id: string
  automation_id: string | null
  job_id: string | null
  lead_id: string | null
  event_type: AutomationEventType
  event_title: string
  event_description: string | null
  previous_status: AutomationJobStatus | null
  new_status: AutomationJobStatus | null
  actor_type: AutomationActorType
  actor_user_id: string | null
  related_user_id: string | null
  payload: Record<string, unknown>
  created_at: string
}

// ---------- Configurações por lead ----------
export interface LeadAutomationSettings {
  id: string
  lead_id: string
  organization_id: string
  automation_paused: boolean
  automation_paused_reason: string | null
  automation_paused_at: string | null
  automation_paused_by: string | null
  do_not_contact: boolean
  do_not_contact_reason: string | null
  last_automation_sent_at: string | null
  total_automation_messages_sent: number
  created_at: string
  updated_at: string
}

// ---------- Dashboard / Métricas ----------
export interface AutomationDashboardMetrics {
  active_automations: number
  leads_analyzed_today: number
  leads_eligible_today: number
  messages_scheduled: number
  messages_sent_today: number
  messages_delivered: number
  messages_read: number
  leads_responded: number
  cancelled_by_human: number
  send_failures: number
  supervisions_applied: number
  response_rate: number
  cancel_rate: number
  failure_rate: number
  avg_time_to_first_interaction: number
}

export interface AutomationDailyMetric {
  date: string
  eligible: number
  sent: number
  responded: number
  cancelled: number
}

export interface AutomationFunnelStep {
  label: string
  value: number
}

// ---------- Variáveis da mensagem ----------
export const MESSAGE_VARIABLES: { key: string; label: string; example: string }[] = [
  { key: "nome_lead", label: "Nome completo do lead", example: "Maria Silva" },
  { key: "primeiro_nome", label: "Primeiro nome", example: "Maria" },
  { key: "nome_corretor", label: "Nome do corretor", example: "João Santos" },
  { key: "nome_imobiliaria", label: "Nome da imobiliária", example: "Sua Imobiliária" },
  { key: "cidade_lead", label: "Cidade do lead", example: "Presidente Prudente" },
  { key: "empreendimento_interesse", label: "Empreendimento de interesse", example: "Residencial Parque" },
  { key: "origem_lead", label: "Origem do lead", example: "Tráfego Pago" },
  { key: "telefone_lead", label: "Telefone do lead", example: "(18) 99999-0000" },
  { key: "link_atendimento", label: "Link de atendimento", example: "https://..." },
  { key: "data_atual", label: "Data atual", example: "18/08/2026" },
  { key: "hora_atual", label: "Hora atual", example: "14:30" },
]

// ---------- Status label helpers ----------
export const AUTOMATION_STATUS_LABEL: Record<AutomationStatus, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  inactive: "Inativa",
}

export const AUTOMATION_STATUS_VARIANT: Record<AutomationStatus, string> = {
  draft: "gray",
  active: "green",
  paused: "amber",
  inactive: "red",
}

export const EVENT_TYPE_LABEL: Record<AutomationEventType, string> = {
  lead_evaluated: "Lead avaliado",
  lead_eligible: "Lead elegível",
  lead_not_eligible: "Lead não elegível",
  job_created: "Job criado",
  job_scheduled: "Job agendado",
  job_revalidated: "Job revalidado",
  job_cancelled: "Job cancelado",
  message_prepared: "Mensagem preparada",
  message_sent: "Mensagem enviada",
  message_delivered: "Mensagem entregue",
  message_read: "Mensagem lida",
  lead_responded: "Lead respondeu",
  send_failed: "Falha no envio",
  retry_created: "Retentativa criada",
  supervision_requested: "Supervisão solicitada",
  supervision_applied: "Supervisão aplicada",
  supervision_failed: "Falha na supervisão",
  automation_paused: "Automação pausada",
  automation_activated: "Automação ativada",
  config_changed: "Configuração alterada",
  test_executed: "Teste executado",
}

export const EVENT_TYPE_VARIANT: Record<AutomationEventType, string> = {
  lead_evaluated: "blue",
  lead_eligible: "green",
  lead_not_eligible: "gray",
  job_created: "blue",
  job_scheduled: "amber",
  job_revalidated: "teal",
  job_cancelled: "slate",
  message_prepared: "blue",
  message_sent: "green",
  message_delivered: "green",
  message_read: "teal",
  lead_responded: "green",
  send_failed: "red",
  retry_created: "amber",
  supervision_requested: "purple",
  supervision_applied: "green",
  supervision_failed: "red",
  automation_paused: "slateblue",
  automation_activated: "green",
  config_changed: "blue",
  test_executed: "indigo",
}
