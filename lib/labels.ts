import type { LeadStatus, PropertyStatus, Role, ActionType, AccessAction, Origem, Temperatura, AuditTipo, Lead } from "./mock-data"

export const TEMPERATURAS: Temperatura[] = ["quente", "morno", "frio"]
export const TEMP_LABEL: Record<Temperatura, string> = { quente: "Quente", morno: "Morno", frio: "Frio" }
// quente vermelho, morno âmbar, frio azul acinzentado
export const TEMP_VARIANT: Record<Temperatura, string> = { quente: "red", morno: "amber", frio: "slateblue" }

export const AUDIT_TIPO_LABEL: Record<AuditTipo, string> = {
  criacao: "Criação",
  edicao: "Edição",
  etapa: "Mudança de etapa",
  visita: "Visita agendada",
  proposta: "Proposta",
  fechamento: "Fechamento",
  exclusao: "Exclusão",
  responsavel: "Troca de responsável",
  temperatura: "Temperatura",
  qualidade: "Obs. de qualidade",
  justificativa: "Justificativa operacional",
  locacao_criacao: "Criação (Locação)",
  locacao_exclusao: "Exclusão (Locação)",
  locacao_visita: "Visita agendada (Locação)",
}
export const AUDIT_TIPO_VARIANT: Record<AuditTipo, string> = {
  criacao: "green",
  edicao: "blue",
  etapa: "amber",
  visita: "blue",
  proposta: "accent",
  fechamento: "green",
  exclusao: "red",
  responsavel: "slate",
  temperatura: "amber",
  qualidade: "gray",
  justificativa: "red",
  locacao_criacao: "green",
  locacao_exclusao: "red",
  locacao_visita: "blue",
}

// Referência principal do lead (fallback para imovelRef legado)
export function refPrincipal(l: Pick<Lead, "referencias" | "imovelRef">) {
  return l.referencias?.find((r) => r.principal)?.ref ?? l.referencias?.[0]?.ref ?? l.imovelRef ?? ""
}
export function refsTexto(l: Pick<Lead, "referencias" | "imovelRef">) {
  const list = l.referencias?.map((r) => r.ref) ?? []
  return list.length ? list.join(", ") : l.imovelRef || ""
}

// Tag do fluxo automático: carimbada ao entrar em automação (reativação de base
// ou manual), removida ao sair para humano/perdido. A IA usa referencias como
// "tags" (leadAptoParaResposta) — com essa tag o agente responde quem está na automação.
export const TAG_AUTOMACAO = "automacao"
// Tags de estágio do ciclo (a IA usa referencias como alvo — leadAptoParaResposta):
// respondeu/não-respondeu à reativação, em follow-up. Namespace do fluxo; ao
// sair para humano/perdido, todas saem (semTagsFluxo). Slugs sem acento.
export const TAG_RESPONDEU_AUTOMACAO = "respondeu-automacao"
export const TAG_NAO_RESPONDEU_AUTOMACAO = "nao-respondeu-automacao"
export const TAG_FOLLOWUP = "followup"
export const TAGS_FLUXO = [TAG_AUTOMACAO, TAG_RESPONDEU_AUTOMACAO, TAG_NAO_RESPONDEU_AUTOMACAO, TAG_FOLLOWUP]
type RefLike = string | { ref?: unknown } | null | undefined
export function refNome(r: RefLike): string {
  return String(typeof r === "string" ? r : r?.ref ?? "").toLowerCase().trim()
}
export function temRef(refs: unknown, nome: string): boolean {
  return Array.isArray(refs) && (refs as RefLike[]).some((r) => refNome(r) === nome.toLowerCase())
}
export function comRef<T>(refs: readonly T[] | null | undefined, ref: T): T[] {
  const arr = Array.isArray(refs) ? [...refs] : []
  if (!temRef(arr, refNome(ref as RefLike))) arr.push(ref)
  return arr
}
export function semRef<T>(refs: readonly T[] | null | undefined, nome: string): T[] {
  return (Array.isArray(refs) ? [...refs] : []).filter((r) => refNome(r as RefLike) !== nome.toLowerCase())
}
export function semTagsFluxo<T>(refs: unknown): T[] {
  return (Array.isArray(refs) ? [...refs] : []).filter((r) => !TAGS_FLUXO.includes(refNome(r as RefLike))) as T[]
}
// Entrada (ou reentrada) na automação: zera o ciclo anterior e carimba automacao.
export function comTagsEntradaAutomacao(refs: unknown): { ref: string }[] {
  const base = semTagsFluxo(refs).map((r) => (typeof r === "string" ? { ref: r } : (r as { ref: string })))
  if (!temRef(base, TAG_AUTOMACAO)) base.push({ ref: TAG_AUTOMACAO })
  return base
}

export const STATUS_LABEL: Record<LeadStatus, string> = {
  novo: "Novo Lead",
  "em_atendimento": "Em Atendimento",
  "em_automacao": "Em Automação",
  "atendimento_ia": "Atendimento IA",
  "atendimento_humano": "Aguardando Atendimento",
  "em_followup": "Em Follow-up",
  "escolhendo opcoes": "Separando Opções",
  "imovel necessidade": "Imóvel - Necessidade",
  permuta: "Permuta",
  "reuniao agendada": "Reunião Agendada",
  negociando: "Negociando",
  fechado: "Fechado",
  perdido: "Perdido",
}
export const STATUS_VARIANT: Record<LeadStatus, string> = {
  novo: "blue",
  "em_atendimento": "indigo",
  "em_automacao": "sky",
  "atendimento_ia": "cyan",
  "atendimento_humano": "violet",
  "em_followup": "orange",
  "escolhendo opcoes": "slate",
  "imovel necessidade": "teal",
  permuta: "purple",
  "reuniao agendada": "amber",
  negociando: "accent",
  fechado: "green",
  perdido: "gray",
}
// cor de acento (topo da coluna do kanban)
export const STATUS_ACCENT: Record<LeadStatus, string> = {
  novo: "#0ea5e9",
  "em_atendimento": "#4f46e5",
  "em_automacao": "#06b6d4",
  "atendimento_ia": "#22d3ee",
  "atendimento_humano": "#7c3aed",
  "em_followup": "#f97316",
  "escolhendo opcoes": "#54595f",
  "imovel necessidade": "#0d9488",
  permuta: "#9333ea",
  "reuniao agendada": "#f59e0b",
  negociando: "#b22222",
  fechado: "#16a34a",
  perdido: "#a1a1aa",
}
export const LEAD_STATUSES: LeadStatus[] = [
  "novo",
  "em_atendimento",
  "em_automacao",
  "atendimento_ia",
  "atendimento_humano",
  "em_followup",
  "escolhendo opcoes",
  "reuniao agendada",
  "negociando",
  "fechado",
  "imovel necessidade",
  "permuta",
  "perdido",
]
// Mapeia status legados do banco para os atuais
export function normalizeStatus(s: string): LeadStatus {
  if (s === "em atendimento") return "escolhendo opcoes"
  if (s === "em followup") return "em_followup"
  if (s === "proposta enviada") return "negociando"
  return (LEAD_STATUSES as string[]).includes(s) ? (s as LeadStatus) : "novo"
}

// Normaliza telefone para comparação (só dígitos, sem prefixo de país "55").
// Isso garante que "5518996106482" e "18 99610-6482" sejam tratados como iguais.
export function normalizePhone(phone: string) {
  const d = (phone || "").replace(/\D/g, "")
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d
}

// ---- Follow-up obrigatório por etapa ----
// Prazo para exigir justificativa por falta de movimentação: 2 dias completos.
// Etapas que exigem follow-up (Fechado e Perdido não exigem).

// Motivos de exclusão de lead (com "Outro" ao final para detalhe livre)
export const MOTIVOS_EXCLUSAO = [
  "Lead duplicado",
  "Dados incorretos / inválidos",
  "Cadastro de teste",
  "Solicitação do cliente (LGPD)",
  "Spam / não é lead",
  "Outro",
] as const

export const PROP_LABEL: Record<PropertyStatus, string> = { disponivel: "Disponível", vendido: "Vendido", alugado: "Alugado" }
export const PROP_VARIANT: Record<PropertyStatus, string> = { disponivel: "green", vendido: "gray", alugado: "blue" }

export const ROLE_VARIANT: Record<Role, string> = {
  corretor: "default",
  gestor: "accent",
  gestor_master: "slateblue",
  corretor_vendas: "blue",
  gestor_vendas: "accent",
  corretor_locacao: "teal",
  gestor_locacao: "indigo",
}

export const ACTION_LABEL: Record<ActionType, string> = { criacao: "Criação", edicao: "Edição", exclusao: "Exclusão" }
export const ACTION_VARIANT: Record<ActionType, string> = { criacao: "green", edicao: "blue", exclusao: "red" }

export const ACCESS_LABEL: Record<AccessAction, string> = {
  login: "Login",
  logout: "Logout",
  "tentativa falha": "Tentativa falha",
  "visualizacao lead sensivel": "Visualização de lead",
}

export const ORIGEM_VARIANT: Record<Origem, string> = {
  Instagram: "accent",
  Indicação: "teal",
  "Tráfego Pago": "blue",
  WhatsApp: "green",
  Marketplace: "purple",
  Outro: "gray",
}

export function brl(v?: number) {
  if (v == null) return "—"
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
}
export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}
export function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
export function fmtDayLabel(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })
}
export function fmtDuracao(seg?: number) {
  if (!seg || seg < 60) return "—"
  const h = Math.floor(seg / 3600)
  const m = Math.round((seg % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}min`
  return `${m}min`
}
