"use client"

import { useState, useEffect, useMemo } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, ArrowRight, Check, Save, Eye, MessageCircle, Zap, Shield, Clock, AlertTriangle, Settings } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent, Badge, Input, Textarea, Label, Select } from "@/components/ui/primitives"
import { useAutomation } from "@/lib/automation-store"
import { useLeads } from "@/lib/leads-store"
import { useAuth } from "@/lib/auth-context"
import {
  MESSAGE_VARIABLES,
  type Automation,
  type AutomationCondition,
  type AutomationConditionGroup,
  type AutomationWaitConfig,
  type AutomationCancellationRules,
  type AutomationLimitsConfig,
} from "@/lib/automation-types"
import { cn } from "@/lib/utils"

const STEPS = [
  { label: "Informações", icon: Settings },
  { label: "Gatilho", icon: Zap },
  { label: "Condições", icon: AlertTriangle },
  { label: "Espera", icon: Clock },
  { label: "Cancelamento", icon: AlertTriangle },
  { label: "Mensagem", icon: MessageCircle },
  { label: "Supervisão", icon: Shield },
  { label: "Limites", icon: AlertTriangle },
  { label: "Prévia", icon: Eye },
  { label: "Ativar", icon: Check },
]

const CONDITION_FIELDS = [
  { value: "tag_origem", label: "Origem do lead" },
  { value: "status", label: "Etapa do kanban" },
  { value: "temperatura", label: "Temperatura" },
  { value: "has_valid_phone", label: "Possui telefone válido" },
  { value: "is_not_converted", label: "Não foi convertido" },
  { value: "is_not_lost", label: "Não foi perdido" },
  { value: "is_not_archived", label: "Não está arquivado" },
  { value: "automation_not_blocked", label: "Não bloqueado para automações" },
  { value: "not_recently_automated", label: "Não recebeu automação recente" },
]

export default function NovaAutomacaoPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const editId = searchParams.get("id")
  const { user } = useAuth()
  const { automations, addAutomation, updateAutomation, templates, loadTemplates, updateTemplate } = useAutomation()
  const { users, leads } = useLeads()

  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Form state
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("reativacao")
  const [status, setStatus] = useState<"draft" | "active" | "paused">("draft")
  const [triggerType, setTriggerType] = useState<string>("lead_inactive")
  const [conditions, setConditions] = useState<AutomationConditionGroup>({ mode: "and", rules: [
    { field: "tag_origem", operator: "equals", value: "Tráfego Pago" },
    { field: "status", operator: "equals", value: "novo" },
    { field: "temperatura", operator: "equals", value: "frio" },
    { field: "has_valid_phone", operator: "equals", value: true },
    { field: "is_not_converted", operator: "equals", value: true },
    { field: "is_not_lost", operator: "equals", value: true },
    { field: "is_not_archived", operator: "equals", value: true },
    { field: "automation_not_blocked", operator: "equals", value: true },
    { field: "not_recently_automated", operator: "equals", value: true },
  ]})
  const [waitAmount, setWaitAmount] = useState(10)
  const [waitUnit, setWaitUnit] = useState<"minutes" | "hours" | "days">("minutes")
  const [allowedStartHour, setAllowedStartHour] = useState("08:00")
  const [allowedEndHour, setAllowedEndHour] = useState("18:00")
  const [allowedDays, setAllowedDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [cancellationRules, setCancellationRules] = useState<AutomationCancellationRules>({
    cancel_on_manual_message: true, cancel_on_note: true, cancel_on_stage_change: true,
    cancel_on_responsible_change: true, cancel_on_temperature_change: true,
    cancel_on_tag_removed: true, cancel_on_stage_left: true, cancel_on_became_not_cold: true,
    cancel_on_lead_replied: true, cancel_on_lost: true, cancel_on_converted: true,
    cancel_on_archived: true, cancel_on_automated_paused: true, cancel_on_phone_invalid: true,
  })
  const [messageTemplateId, setMessageTemplateId] = useState<string>(templates[0]?.id ?? "")
  const [messageContent, setMessageContent] = useState("")
  const [supervisionEnabled, setSupervisionEnabled] = useState(true)
  const [supervisorUserId, setSupervisorUserId] = useState<string>("")
  const [keepCurrentAgent, setKeepCurrentAgent] = useState(true)
  const [createAutomaticNote, setCreateAutomaticNote] = useState(true)
  const [limitsConfig, setLimitsConfig] = useState<AutomationLimitsConfig>({
    max_sends_per_lead: 3, max_daily_sends: 50,
    min_interval_between_messages_minutes: 60, block_window_hours: 24,
  })

  // Carregar automação existente para edição
  useEffect(() => {
    if (!editId) return
    const auto = automations.find((a) => a.id === editId)
    if (!auto) return
    setName(auto.name)
    setDescription(auto.description ?? "")
    setCategory(auto.category)
    setStatus(auto.status === "draft" ? "draft" : auto.status === "paused" ? "paused" : "active")
    setTriggerType(auto.trigger_type)
    setConditions(auto.conditions)
    setWaitAmount(auto.wait_config.amount)
    setWaitUnit(auto.wait_config.unit)
    setAllowedStartHour(auto.wait_config.allowed_start_hour ?? "08:00")
    setAllowedEndHour(auto.wait_config.allowed_end_hour ?? "18:00")
    setAllowedDays(auto.wait_config.allowed_days ?? [1, 2, 3, 4, 5])
    setCancellationRules(auto.cancellation_rules)
    setMessageTemplateId(auto.message_template_id ?? "")
    setSupervisionEnabled(auto.supervision_enabled)
    setSupervisorUserId(auto.supervisor_user_id ?? "")
    setKeepCurrentAgent(auto.keep_current_agent)
    setCreateAutomaticNote(auto.create_automatic_note)
    setLimitsConfig(auto.limits_config)
  }, [editId, automations])

  // Load template content
  useEffect(() => {
    if (!messageTemplateId) return
    const tmpl = templates.find((t) => t.id === messageTemplateId)
    if (tmpl) setMessageContent(tmpl.content)
  }, [messageTemplateId, templates])

  // Set supervisor default
  useEffect(() => {
    if (!supervisorUserId) {
      const pati = users.find((u) => u.nome === "Patricia")
      if (pati) setSupervisorUserId(pati.id)
    }
  }, [users, supervisorUserId])

  const previewMessage = useMemo(() => {
    let msg = messageContent
    msg = msg.replaceAll("{{nome_lead}}", "Maria Silva")
    msg = msg.replaceAll("{{primeiro_nome}}", "Maria")
    msg = msg.replaceAll("{{nome_corretor}}", "João Santos")
    msg = msg.replaceAll("{{nome_imobiliaria}}", "Sua Imobiliária")
    msg = msg.replaceAll("{{cidade_lead}}", "Presidente Prudente")
    msg = msg.replaceAll("{{empreendimento_interesse}}", "Residencial Parque")
    msg = msg.replaceAll("{{origem_lead}}", "Tráfego Pago")
    msg = msg.replaceAll("{{telefone_lead}}", "(18) 99999-0000")
    msg = msg.replaceAll("{{data_atual}}", new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }))
    msg = msg.replaceAll("{{hora_atual}}", new Date().toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }))
    return msg
  }, [messageContent])

  const eligibleCount = useMemo(() => {
    return leads.filter((l) =>
      l.status === "novo" && l.origem === "Tráfego Pago" && l.temperatura === "frio"
    ).length
  }, [leads])

  function addCondition() {
    setConditions((prev) => ({
      ...prev,
      rules: [...prev.rules, { field: "status", operator: "equals", value: "" }],
    }))
  }

  function removeCondition(index: number) {
    setConditions((prev) => ({
      ...prev,
      rules: prev.rules.filter((_, i) => i !== index),
    }))
  }

  function updateCondition(index: number, patch: Partial<AutomationCondition>) {
    setConditions((prev) => ({
      ...prev,
      rules: prev.rules.map((r, i) => i === index ? { ...r, ...patch } : r),
    }))
  }

  function toggleDay(day: number) {
    setAllowedDays((prev) => prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort())
  }

  async function handleSave(newStatus: "draft" | "active") {
    setSaving(true)
    const slug = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")

    const data: Omit<Automation, "id" | "created_at" | "updated_at" | "deleted_at"> = {
      organization_id: "00000000-0000-0000-0000-000000000000",
      name, slug, description, category, status: newStatus, priority: 0,
      trigger_type: triggerType as any, trigger_config: {},
      conditions, wait_config: { amount: waitAmount, unit: waitUnit, allowed_start_hour: allowedStartHour, allowed_end_hour: allowedEndHour, allowed_days: allowedDays, timezone: "America/Sao_Paulo" },
      cancellation_rules: cancellationRules,
      message_template_id: messageTemplateId || null,
      whatsapp_connection_id: null,
      supervision_enabled: supervisionEnabled,
      supervisor_user_id: supervisorUserId || null,
      keep_current_agent: keepCurrentAgent,
      create_automatic_note: createAutomaticNote,
      automatic_note_template: "Automação {{nome_automacao}} enviada com sucesso em {{data_atual}} às {{hora_atual}}. Gestor {{nome_gestor}} assumiu a supervisão do lead.",
      limits_config: limitsConfig,
      is_test_mode: false, is_simulation_mode: false,
      created_by: user?.id ?? null, updated_by: user?.id ?? null,
    }

    const result = editId ? await updateAutomation(editId, data) : await addAutomation(data)

    // Salvar conteúdo editado da mensagem no template
    if (result.ok && messageTemplateId && messageContent) {
      const tmpl = templates.find((t) => t.id === messageTemplateId)
      if (tmpl && tmpl.content !== messageContent) {
        await updateTemplate(messageTemplateId, { content: messageContent })
      }
    }

    setSaving(false)
    if (result.ok) router.push("/automacoes/regras")
    else alert(result.error)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-lg p-2 hover:bg-muted"><ArrowLeft className="size-5" /></button>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">{editId ? "Editar" : "Nova"} Automação</h1>
          <p className="text-sm text-muted-foreground">Configure a automação de reativação de leads</p>
        </div>
      </div>

      {/* Stepper */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-1 overflow-x-auto">
            {STEPS.map((s, i) => (
              <button key={i} onClick={() => setStep(i)}
                className={cn(
                  "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition",
                  i === step ? "bg-primary text-primary-foreground" : i < step ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                )}
              >
                {i < step ? <Check className="size-3.5" /> : <s.icon className="size-3.5" />}
                {s.label}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Informações Gerais</h2>
              <div>
                <Label>Nome da Automação *</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Reativação de Leads Frios" />
              </div>
              <div>
                <Label>Descrição</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva o objetivo desta automação..." rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Categoria</Label>
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="reativacao">Reativação</option>
                    <option value="follow_up">Follow-up</option>
                    <option value="nurture">Nurture</option>
                  </Select>
                </div>
                <div>
                  <Label>Status Inicial</Label>
                  <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
                    <option value="draft">Rascunho</option>
                    <option value="active">Ativar imediatamente</option>
                  </Select>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Gatilho</h2>
              <p className="text-sm text-muted-foreground">Define quando a automação começa a avaliar leads</p>
              <div>
                <Label>Tipo de Gatilho</Label>
                <Select value={triggerType} onChange={(e) => setTriggerType(e.target.value)}>
                  <option value="lead_inactive">Lead permanece sem interação</option>
                  <option value="lead_created">Lead criado</option>
                  <option value="lead_entered_stage">Lead entrou em etapa</option>
                  <option value="lead_received_tag">Lead recebeu tag</option>
                </Select>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <p>O gatilho <strong>"Lead permanece sem interação"</strong> verifica periodicamente os leads que atendem às condições e cria jobs na fila quando o lead fica inativo pelo tempo configurado.</p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-lg font-semibold">Condições</h2>
                <div className="flex items-center gap-2">
                  <Badge variant={conditions.mode === "and" ? "blue" : "amber"}>
                    {conditions.mode === "and" ? "AND (todas)" : "OR (qualquer)"}
                  </Badge>
                  <button onClick={() => setConditions((p) => ({ ...p, mode: p.mode === "and" ? "or" : "and" }))}
                    className="text-xs font-medium text-primary hover:underline">
                    Alternar
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                {conditions.rules.map((rule, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg border border-border/60 p-3">
                    <Select value={rule.field} onChange={(e) => updateCondition(i, { field: e.target.value })} className="w-48">
                      {CONDITION_FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </Select>
                    <Select value={rule.operator} onChange={(e) => updateCondition(i, { operator: e.target.value as any })} className="w-36">
                      <option value="equals">É igual a</option>
                      <option value="not_equals">Não é igual a</option>
                      <option value="greater_than">Maior que</option>
                      <option value="less_than">Menor que</option>
                    </Select>
                    {typeof rule.value === "boolean" ? (
                      <Select value={String(rule.value)} onChange={(e) => updateCondition(i, { value: e.target.value === "true" })} className="w-32">
                        <option value="true">Sim</option>
                        <option value="false">Não</option>
                      </Select>
                    ) : typeof rule.value === "number" ? (
                      <Input type="number" value={rule.value} onChange={(e) => updateCondition(i, { value: parseInt(e.target.value) || 0 })} className="w-32" />
                    ) : (
                      <Input value={String(rule.value)} onChange={(e) => updateCondition(i, { value: e.target.value })} className="flex-1" placeholder="Valor..." />
                    )}
                    <button onClick={() => removeCondition(i)} className="rounded p-1 text-red-500 hover:bg-red-50 text-xs">✕</button>
                  </div>
                ))}
              </div>
              <button onClick={addCondition} className="text-sm font-medium text-primary hover:underline">+ Adicionar condição</button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Período de Espera</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Esperar por</Label>
                  <div className="flex gap-2">
                    <Input type="number" value={waitAmount} onChange={(e) => setWaitAmount(parseInt(e.target.value) || 1)} className="w-24" />
                    <Select value={waitUnit} onChange={(e) => setWaitUnit(e.target.value as any)}>
                      <option value="minutes">Minutos</option>
                      <option value="hours">Horas</option>
                      <option value="days">Dias</option>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Horário inicial permitido</Label>
                  <Input type="time" value={allowedStartHour} onChange={(e) => setAllowedStartHour(e.target.value)} />
                </div>
                <div>
                  <Label>Horário final permitido</Label>
                  <Input type="time" value={allowedEndHour} onChange={(e) => setAllowedEndHour(e.target.value)} />
                </div>
              </div>
              <div>
                <Label>Dias da semana permitidos</Label>
                <div className="mt-1 flex gap-2">
                  {["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((d, i) => (
                    <button key={i} onClick={() => toggleDay(i)}
                      className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition",
                        allowedDays.includes(i) ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:bg-muted"
                      )}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Regras de Cancelamento</h2>
              <p className="text-sm text-muted-foreground">Se qualquer uma dessas ações ocorrer antes do envio, o job é cancelado automaticamente</p>
              <div className="space-y-2">
                {Object.entries(cancellationRules).map(([key, value]) => (
                  <label key={key} className="flex items-center gap-3 rounded-lg border border-border/60 p-3">
                    <input type="checkbox" checked={!!value}
                      onChange={(e) => setCancellationRules((prev) => ({ ...prev, [key]: e.target.checked }))}
                      className="size-4 rounded border-gray-300" />
                    <span className="text-sm">{formatCancelRule(key)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Mensagem</h2>
              <div>
                <Label>Template de Mensagem</Label>
                <Select value={messageTemplateId} onChange={(e) => setMessageTemplateId(e.target.value)}>
                  <option value="">Selecionar template...</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </div>
              <div>
                <Label>Conteúdo da Mensagem</Label>
                <Textarea value={messageContent} onChange={(e) => setMessageContent(e.target.value)} rows={8} placeholder="Digite a mensagem..." />
              </div>
              <div>
                <Label>Variáveis disponíveis</Label>
                <div className="mt-1 flex flex-wrap gap-1">
                  {MESSAGE_VARIABLES.map((v) => (
                    <button key={v.key} onClick={() => setMessageContent((prev) => prev + `{{${v.key}}}`)}
                      className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
                      {`{{${v.key}}}`}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <Label>Prévia da Mensagem</Label>
                <div className="mt-1 rounded-lg border border-border bg-muted/30 p-4 text-sm whitespace-pre-wrap">
                  {previewMessage || "Selecione um template ou digite uma mensagem..."}
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Supervisão</h2>
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={supervisionEnabled} onChange={(e) => setSupervisionEnabled(e.target.checked)} className="size-4 rounded" />
                <span className="text-sm font-medium">Aplicar supervisão após envio bem-sucedido</span>
              </label>
              {supervisionEnabled && (
                <>
                  <div>
                    <Label>Gestor Supervisor</Label>
                    <Select value={supervisorUserId} onChange={(e) => setSupervisorUserId(e.target.value)}>
                      <option value="">Selecionar...</option>
                      {users.filter((u) => u.role.includes("gestor")).map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                    </Select>
                  </div>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={keepCurrentAgent} onChange={(e) => setKeepCurrentAgent(e.target.checked)} className="size-4 rounded" />
                    <span className="text-sm">Manter corretor atual (não substituir responsável)</span>
                  </label>
                  <label className="flex items-center gap-3">
                    <input type="checkbox" checked={createAutomaticNote} onChange={(e) => setCreateAutomaticNote(e.target.checked)} className="size-4 rounded" />
                    <span className="text-sm">Criar observação automática no histórico</span>
                  </label>
                </>
              )}
            </div>
          )}

          {step === 7 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Limites e Segurança</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Máx. envios por lead</Label>
                  <Input type="number" value={limitsConfig.max_sends_per_lead ?? 3} onChange={(e) => setLimitsConfig((p) => ({ ...p, max_sends_per_lead: parseInt(e.target.value) || 3 }))} />
                </div>
                <div>
                  <Label>Máx. envios diários</Label>
                  <Input type="number" value={limitsConfig.max_daily_sends ?? 50} onChange={(e) => setLimitsConfig((p) => ({ ...p, max_daily_sends: parseInt(e.target.value) || 50 }))} />
                </div>
                <div>
                  <Label>Intervalo mínimo (min)</Label>
                  <Input type="number" value={limitsConfig.min_interval_between_messages_minutes ?? 60} onChange={(e) => setLimitsConfig((p) => ({ ...p, min_interval_between_messages_minutes: parseInt(e.target.value) || 60 }))} />
                </div>
                <div>
                  <Label>Janela de bloqueio (horas)</Label>
                  <Input type="number" value={limitsConfig.block_window_hours ?? 24} onChange={(e) => setLimitsConfig((p) => ({ ...p, block_window_hours: parseInt(e.target.value) || 24 }))} />
                </div>
              </div>
            </div>
          )}

          {step === 8 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Prévia e Resumo</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">Condições ({conditions.rules.length})</h3>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {conditions.rules.map((r, i) => (
                      <li key={i}>• {CONDITION_FIELDS.find((f) => f.value === r.field)?.label ?? r.field} {r.operator} {String(r.value)}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <h3 className="text-sm font-semibold">Configurações</h3>
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <li>• Espera: {waitAmount} {waitUnit === "minutes" ? "minutos" : waitUnit === "hours" ? "horas" : "dias"}</li>
                    <li>• Horário: {allowedStartHour} - {allowedEndHour}</li>
                    <li>• Dias: {allowedDays.map((d) => ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"][d]).join(", ")}</li>
                    <li>• Supervisão: {supervisionEnabled ? "Sim" : "Não"}</li>
                    <li>• Max envios/lead: {limitsConfig.max_sends_per_lead}</li>
                  </ul>
                </div>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm"><strong>Leads elegíveis estimados:</strong> {eligibleCount} leads atendem às condições atuais</p>
              </div>
              <div className="rounded-lg border border-border p-4">
                <h3 className="text-sm font-semibold">Prévia da Mensagem</h3>
                <div className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{previewMessage || "Nenhuma mensagem configurada"}</div>
              </div>
            </div>
          )}

          {step === 9 && (
            <div className="space-y-4">
              <h2 className="font-display text-lg font-semibold">Revisão e Ativação</h2>
              <div className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{name || "Sem nome"}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{description || "Sem descrição"}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Badge variant={conditions.rules.length > 0 ? "green" : "red"}>
                    {conditions.rules.length} condições
                  </Badge>
                  <Badge variant="blue">{waitAmount} {waitUnit}</Badge>
                  <Badge variant={supervisionEnabled ? "green" : "gray"}>
                    Supervisão: {supervisionEnabled ? "Sim" : "Não"}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                <AlertTriangle className="mb-1 inline size-4" /> Ao ativar, a automação começará a avaliar leads imediatamente. Leads elegíveis receberão mensagens conforme a configuração.
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Navegação */}
      <div className="flex items-center justify-between">
        <button onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:opacity-40">
          <ArrowLeft className="size-4" /> Anterior
        </button>
        <div className="flex gap-2">
          {step === STEPS.length - 1 ? (
            <>
              <button onClick={() => handleSave("draft")} disabled={saving || !name}
                className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:opacity-40">
                <Save className="size-4" /> Salvar Rascunho
              </button>
              <button onClick={() => handleSave("active")} disabled={saving || !name}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-40">
                <Zap className="size-4" /> Ativar Automação
              </button>
            </>
          ) : (
            <button onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
              Próximo <ArrowRight className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function formatCancelRule(key: string): string {
  const map: Record<string, string> = {
    cancel_on_manual_message: "Corretor enviou mensagem manual",
    cancel_on_note: "Corretor adicionou observação",
    cancel_on_stage_change: "Lead mudou de etapa no kanban",
    cancel_on_responsible_change: "Corretor responsável alterado",
    cancel_on_temperature_change: "Temperatura do lead alterada",
    cancel_on_tag_removed: "Tag removida do lead",
    cancel_on_stage_left: "Lead saiu da etapa Novo Lead",
    cancel_on_became_not_cold: "Lead deixou de ser Frio",
    cancel_on_lead_replied: "Lead respondeu mensagem",
    cancel_on_lost: "Lead marcado como perdido",
    cancel_on_converted: "Lead foi convertido",
    cancel_on_archived: "Lead foi arquivado",
    cancel_on_automated_paused: "Automação pausada para o lead",
    cancel_on_phone_invalid: "Telefone deixou de ser válido",
  }
  return map[key] ?? key
}
