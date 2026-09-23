// =============================================================================
// flow/palette.ts — Registro de nós do builder: categorias, tipos, campos,
// ícones e schemas Zod usados pelo painel de configuração (RHF + Zod).
// =============================================================================

import { z } from "zod"
import type { LucideIcon } from "lucide-react"
import {
  Play, Webhook, UserPlus, Tag, Timer, MessageSquare, Mail, MessageCircle, BellRing,
  GitBranch, Split, Hourglass, Repeat, BadgePlus, BadgeMinus, LayoutList, PenLine,
  Send, ClipboardList, Headphones, Server, Database, Workflow, Flag, Zap, FileText,
  Plug, MousePointerClick,
} from "lucide-react"
import type { FlowCategory, FlowNodeType, FieldValue, BranchHandle } from "./types"

// ---------- Categorias ----------

export interface FlowCategoryDef {
  key: FlowCategory
  label: string
  icon: LucideIcon
  color: string // hex da faixa lateral / acento
}

export const CATEGORIES: FlowCategoryDef[] = [
  { key: "gatilho", label: "Gatilho", icon: Zap, color: "#22c55e" },
  { key: "conteudo", label: "Conteúdo", icon: FileText, color: "#06b6d4" },
  { key: "logica", label: "Lógica", icon: GitBranch, color: "#f59e0b" },
  { key: "acao", label: "Ação", icon: MousePointerClick, color: "#3b82f6" },
  { key: "integracao", label: "Integração", icon: Plug, color: "#a855f7" },
  { key: "fluxo", label: "Fluxo", icon: Workflow, color: "#71717a" },
]

export function categoriaDe(tipo: FlowNodeType): FlowCategoryDef {
  return CATEGORIES.find((c) => c.key === NODE_TYPES[tipo].category) ?? CATEGORIES[5]
}

// ---------- Opções de selects (mock) ----------

export const TAGS_MOCK = ["Interesse Alto", "Cliente", "Locação", "Venda", "Anúncio", "Distrato"]
export const SEGMENTOS_MOCK = ["Segmento A — Quentes", "Segmento B — Mornos", "Segmento C — Frios"]
export const CAMPOS_LEAD = ["status", "temperatura", "cidade", "origem", "empreendimento_interesse", "valor_maximo"]
export const OPERADORES = [
  { value: "equals", label: "igual a" },
  { value: "not_equals", label: "diferente de" },
  { value: "contains", label: "contém" },
  { value: "not_contains", label: "não contém" },
  { value: "greater_than", label: "maior que" },
  { value: "less_than", label: "menor que" },
]
export const CANAIS_NOTIF = ["Slack", "Telegram", "E-mail"]
export const METODOS_HTTP = ["GET", "POST"]
export const UNIDADES_TEMPO = ["minutos", "horas", "dias"]
export const CORRETORES_MOCK = ["Patricia", "Gabriel", "João", "Aline", "Diego", "Levi"]
export const DEPARTAMENTOS = ["Vendas", "Locação", "Financeiro"]
export const TEMPLATES_EMAIL = ["Boas-vindas", "Follow-up de imóvel", "Aniversário do lead"]

// ---------- Campos de configuração ----------

export type FieldKind = "text" | "textarea" | "number" | "select" | "json" | "percent"

export interface FieldDef {
  key: string
  kind: FieldKind
  label: string
  placeholder?: string
  help?: string
  mono?: boolean
  options?: string[]
  required?: boolean
  default?: FieldValue
  suffix?: string
}

export interface NodeTypeDef {
  type: FlowNodeType
  label: string
  category: FlowCategory
  description: string
  isStart?: boolean
  isEnd?: boolean
  branching?: "condicao" | "split"
  fields: FieldDef[]
  supportsVariables?: boolean
}

export const CAMPO_DE_TEXT = { key: "value", kind: "text", label: "Valor", required: true } as const

// Constrói o padrão de {nome, config} para um novo nó.
export function defaultConfig(def: NodeTypeDef): Record<string, FieldValue> {
  const cfg: Record<string, FieldValue> = {}
  for (const f of def.fields) {
    if (f.default !== undefined) cfg[f.key] = f.default
    else if (f.kind === "percent") cfg[f.key] = 50
    else if (f.kind === "number") cfg[f.key] = 1
    else if (f.kind === "select" && f.options?.[0]) cfg[f.key] = f.options[0]
    else if (f.kind === "json") cfg[f.key] = "{\n  \n}"
    else cfg[f.key] = ""
  }
  return cfg
}

// ---------- Registro de tipos de nó ----------

export const NODE_TYPES: Record<FlowNodeType, NodeTypeDef> = {
  start: {
    type: "start", label: "Início do Fluxo", category: "gatilho", isStart: true,
    description: "Ponto de entrada obrigatório — define onde o fluxo começa. Apenas 1 por fluxo.",
    fields: [],
  },

  webhook_recebido: {
    type: "webhook_recebido", label: "Webhook Recebido", category: "gatilho",
    description: "Dispara quando um evento externo chega neste webhook.",
    fields: [
      { key: "evento", kind: "select", label: "Evento", options: ["Formulário enviado", "Pagamento confirmado", "Anúncio clicado"], required: true },
      { key: "url_webhook", kind: "text", label: "URL do webhook", mono: true, placeholder: "https://api.exemplo.com/hook" },
    ],
  },

  lead_criado: {
    type: "lead_criado", label: "Lead Criado", category: "gatilho",
    description: "Dispara quando um novo lead entra no CRM.",
    fields: [
      { key: "origem", kind: "select", label: "Origem (opcional)", options: ["Tráfego Pago", "Instagram", "Orgânico", "Indicação"], placeholder: "Qualquer origem" },
    ],
  },

  tag_aplicada: {
    type: "tag_aplicada", label: "Tag Aplicada", category: "gatilho",
    description: "Dispara quando o lead recebe uma tag específica.",
    fields: [
      { key: "tag", kind: "select", label: "Tag", options: TAGS_MOCK, required: true },
    ],
  },

  tempo_decorrido: {
    type: "tempo_decorrido", label: "Tempo Decorrido", category: "gatilho",
    description: "Aguarda X minutos/horas/dias antes de seguir.",
    fields: [
      { key: "quantidade", kind: "number", label: "Quantidade", required: true, default: 1, suffix: "" },
      { key: "unidade", kind: "select", label: "Unidade", options: UNIDADES_TEMPO, required: true, default: "horas" },
    ],
  },

  enviar_mensagem: {
    type: "enviar_mensagem", label: "Enviar Mensagem", category: "conteudo", supportsVariables: true,
    description: "Envia uma mensagem de texto com variáveis de personalização.",
    fields: [
      { key: "mensagem", kind: "textarea", label: "Mensagem", required: true, placeholder: "Olá {{primeiro_nome}}, tudo bem?...", help: "Use {{variaveis}} para personalizar. Veja o preview ao vivo." },
    ],
  },

  enviar_email: {
    type: "enviar_email", label: "Enviar E-mail", category: "conteudo", supportsVariables: true,
    description: "Envia um e-mail a partir de um template com variáveis.",
    fields: [
      { key: "template", kind: "select", label: "Template", options: TEMPLATES_EMAIL, required: true },
      { key: "assunto", kind: "text", label: "Assunto", required: true },
      { key: "corpo", kind: "textarea", label: "Corpo do e-mail", required: true },
    ],
  },

  enviar_whatsapp: {
    type: "enviar_whatsapp", label: "Enviar WhatsApp", category: "conteudo", supportsVariables: true,
    description: "Envia mensagem de WhatsApp pela integração conectada.",
    fields: [
      { key: "mensagem", kind: "textarea", label: "Mensagem", required: true, help: "Enviado pela linha de WhatsApp configurada nas Conexões." },
    ],
  },

  notificacao_interna: {
    type: "notificacao_interna", label: "Notificação Interna", category: "conteudo", supportsVariables: true,
    description: "Avisa o time interno (Slack/Telegram/e-mail).",
    fields: [
      { key: "canal", kind: "select", label: "Canal", options: CANAIS_NOTIF, required: true },
      { key: "mensagem", kind: "textarea", label: "Mensagem", required: true },
    ],
  },

  condicao: {
    type: "condicao", label: "Condição IF/ELSE", category: "logica", branching: "condicao",
    description: "Ramifica baseado em um campo do lead, tag ou variável.",
    fields: [
      { key: "campo", kind: "select", label: "Campo do lead", options: CAMPOS_LEAD, required: true },
      { key: "operador", kind: "select", label: "Operador", options: OPERADORES.map((o) => o.value), required: true },
      CAMPO_DE_TEXT,
    ],
  },

  split: {
    type: "split", label: "Split A/B", category: "logica", branching: "split",
    description: "Divide o tráfego em %. A soma dos percursos deve ser 100%.",
    fields: [
      { key: "percurso_a", kind: "percent", label: "Percurso A (%)", required: true, default: 50, suffix: "%" },
      { key: "percurso_b", kind: "percent", label: "Percurso B (%)", required: true, default: 50, suffix: "%" },
    ],
  },

  aguardar_resposta: {
    type: "aguardar_resposta", label: "Aguardar Resposta", category: "logica",
    description: "Pausa o fluxo até o lead responder (com timeout opcional).",
    fields: [
      { key: "timeout", kind: "number", label: "Timeout (min)", default: 1440, suffix: "min" },
    ],
  },

  loop: {
    type: "loop", label: "Loop / Repetir", category: "logica",
    description: "Reexecuta o trecho anterior até X vezes.",
    fields: [
      { key: "vezes", kind: "number", label: "Vezes", required: true, default: 3 },
    ],
  },

  aplicar_tag: {
    type: "aplicar_tag", label: "Aplicar Tag", category: "acao",
    description: "Adiciona uma tag ao lead.",
    fields: [
      { key: "tag", kind: "select", label: "Tag", options: TAGS_MOCK, required: true },
    ],
  },

  remover_tag: {
    type: "remover_tag", label: "Remover Tag", category: "acao",
    description: "Remove uma tag do lead.",
    fields: [
      { key: "tag", kind: "select", label: "Tag", options: TAGS_MOCK, required: true },
    ],
  },

  mover_segmento: {
    type: "mover_segmento", label: "Mover para Segmento", category: "acao",
    description: "Move o lead para um segmento da lista.",
    fields: [
      { key: "segmento", kind: "select", label: "Segmento", options: SEGMENTOS_MOCK, required: true },
    ],
  },

  atualizar_campo: {
    type: "atualizar_campo", label: "Atualizar Campo do Lead", category: "acao",
    description: "Atualiza um campo do CRM.",
    fields: [
      { key: "campo", kind: "select", label: "Campo", options: CAMPOS_LEAD, required: true },
      { key: "valor", kind: "text", label: "Valor", required: true },
    ],
  },

  disparar_webhook: {
    type: "disparar_webhook", label: "Disparar Webhook", category: "acao",
    description: "Faz um POST/GET para uma URL externa com payload JSON.",
    fields: [
      { key: "url", kind: "text", label: "URL", mono: true, required: true, placeholder: "https://api.exemplo.com/v1/x" },
      { key: "metodo", kind: "select", label: "Método", options: METODOS_HTTP, required: true },
      { key: "payload", kind: "json", label: "Payload JSON", mono: true },
    ],
  },

  criar_tarefa: {
    type: "criar_tarefa", label: "Criar Tarefa", category: "acao",
    description: "Cria uma tarefa para o time de vendas.",
    fields: [
      { key: "titulo", kind: "text", label: "Título", required: true },
      { key: "responsavel", kind: "select", label: "Responsável", options: CORRETORES_MOCK, required: true },
      { key: "prioridade", kind: "select", label: "Prioridade", options: ["Baixa", "Média", "Alta"], required: true, default: "Média" },
    ],
  },

  encaminhar_humano: {
    type: "encaminhar_humano", label: "Atendimento Humano", category: "acao",
    description: "Transfere a conversa para o inbox humano.",
    fields: [
      { key: "departamento", kind: "select", label: "Departamento", options: DEPARTAMENTOS, required: true },
      { key: "observacoes", kind: "textarea", label: "Observações para o atendente" },
    ],
  },

  consultar_api: {
    type: "consultar_api", label: "Consultar API Externa", category: "integracao",
    description: "Consome uma API externa (GET/POST) com headers configuráveis.",
    fields: [
      { key: "url", kind: "text", label: "URL", mono: true, required: true },
      { key: "metodo", kind: "select", label: "Método", options: METODOS_HTTP, required: true },
      { key: "headers", kind: "json", label: "Headers (JSON)", mono: true, help: 'Ex.: {"Authorization": "Bearer token"}' },
    ],
  },

  salvar_banco: {
    type: "salvar_banco", label: "Salvar no Banco", category: "integracao",
    description: "Faz insert/update em uma tabela customizada.",
    fields: [
      { key: "tabela", kind: "text", label: "Tabela", mono: true, required: true, placeholder: "eventos_leads" },
      { key: "operacao", kind: "select", label: "Operação", options: ["insert", "update"], required: true },
    ],
  },

  ir_para_fluxo: {
    type: "ir_para_fluxo", label: "Ir para Outro Fluxo", category: "fluxo",
    description: "Redireciona a sessão para outro fluxo.",
    fields: [
      { key: "fluxo_destino", kind: "text", label: "Fluxo destino", placeholder: "Nome do fluxo" },
    ],
  },

  fim: {
    type: "fim", label: "Fim do Fluxo", category: "fluxo", isEnd: true,
    description: "Encerra a automação desta sessão.",
    fields: [],
  },
}

// ---------- Schemas Zod por tipo de nó ----------

function parseJsn(v: unknown) {
  if (typeof v !== "string" || v.trim() === "") return true
  try { JSON.parse(v); return true } catch { return false }
}

export function buildNodeSchema(def: NodeTypeDef) {
  const configShape: Record<string, z.ZodTypeAny> = {}
  for (const f of def.fields) {
    if (f.kind === "text") {
      configShape[f.key] = f.required
        ? z.string().trim().min(1, `Campo "${f.label}" é obrigatório`)
        : z.string().optional().or(z.literal(""))
    } else if (f.kind === "textarea") {
      configShape[f.key] = f.required ? z.string().min(1, `Campo "${f.label}" é obrigatório`) : z.string().optional().or(z.literal(""))
    } else if (f.kind === "number") {
      configShape[f.key] = z.coerce.number({ error: "Valor numérico" }).min(0)
    } else if (f.kind === "percent") {
      configShape[f.key] = z.coerce.number({ error: "Valor numérico" }).min(0, "Mínimo 0").max(100, "Máximo 100")
    } else if (f.kind === "select") {
      configShape[f.key] = f.required ? z.string().min(1, `Selecione ${f.label.toLowerCase()}`) : z.string().optional().or(z.literal(""))
    } else if (f.kind === "json") {
      configShape[f.key] = z.string().optional().refine(parseJsn, "JSON inválido")
    }
  }

  const base = z.object({
    nome: z.string().trim().min(1, "Nome do nó é obrigatório").max(60, "Máximo de 60 caracteres"),
    config: z.object(configShape),
  })
  if (def.branching === "split") {
    return base.superRefine((val, ctx) => {
      const a = Number(val.config.percurso_a ?? 0)
      const b = Number(val.config.percurso_b ?? 0)
      if (a + b !== 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["config", "percurso_b"], message: "A soma dos percursos deve ser 100%" })
      }
    })
  }
  return base
}

// ---------- Opções de filtro (tipo do fluxo) ----------

export const FLOW_TIPOS_LABEL: Record<string, string> = {
  Captura: "Captura",
  Qualificacao: "Qualificação",
  Venda: "Venda",
  Nutricao: "Nutrição",
  Reengajamento: "Reengajamento",
}

export const FLOW_STATUS_LABEL: Record<string, string> = {
  ativo: "Ativo",
  inativo: "Inativo",
  rascunho: "Rascunho",
}

export const EDGE_PRIMARY = "#06b6d4" // cyan-500
export const EDGE_ELSE = "#f59e0b" // amber-500

export function corDaAresta(handle?: BranchHandle | null): string {
  return handle === "else" ? EDGE_ELSE : EDGE_PRIMARY
}

// Variáveis de personalização com exemplo para o preview
export const VARIAVEIS_PREVIEW: Record<string, string> = {
  "{{nome_lead}}": "Maria Silva",
  "{{primeiro_nome}}": "Maria",
  "{{nome_corretor}}": "João Santos",
  "{{nome_imobiliaria}}": "Sua Imobiliária",
  "{{cidade_lead}}": "Presidente Prudente",
  "{{origem_lead}}": "Tráfego Pago",
  "{{telefone_lead}}": "(18) 99999-0000",
}

export function previewMensagem(template: string): string {
  let out = template
  for (const [k, v] of Object.entries(VARIAVEIS_PREVIEW)) out = out.split(k).join(v)
  return out
}

// Nome padrão de um novo nó baseado no rótulo do tipo.
export function nomeSugerido(tipo: FlowNodeType): string {
  return NODE_TYPES[tipo].label
}

export function nodeTypeLabel(tipo: FlowNodeType): string {
  return NODE_TYPES[tipo].label
}

export const NODE_ICONS: Record<FlowNodeType, LucideIcon> = {
  start: Play,
  webhook_recebido: Webhook,
  lead_criado: UserPlus,
  tag_aplicada: Tag,
  tempo_decorrido: Timer,
  enviar_mensagem: MessageSquare,
  enviar_email: Mail,
  enviar_whatsapp: MessageCircle,
  notificacao_interna: BellRing,
  condicao: GitBranch,
  split: Split,
  aguardar_resposta: Hourglass,
  loop: Repeat,
  aplicar_tag: BadgePlus,
  remover_tag: BadgeMinus,
  mover_segmento: LayoutList,
  atualizar_campo: PenLine,
  disparar_webhook: Send,
  criar_tarefa: ClipboardList,
  encaminhar_humano: Headphones,
  consultar_api: Server,
  salvar_banco: Database,
  ir_para_fluxo: Workflow,
  fim: Flag,
}

// Determina os handles de saída de um nó.
export function handlesSaida(tipo: FlowNodeType, cfg: Record<string, FieldValue>): { id: BranchHandle | "out"; label: string; cor: string }[] {
  const def = NODE_TYPES[tipo]
  if (def.branching === "condicao") {
    return [
      { id: "out", label: "Sim", cor: EDGE_PRIMARY },
      { id: "else", label: "Não", cor: EDGE_ELSE },
    ]
  }
  if (def.branching === "split") {
    const a = Number(cfg?.percurso_a ?? 50)
    const b = Number(cfg?.percurso_b ?? 50)
    return [
      { id: "out", label: `${a}%`, cor: EDGE_PRIMARY },
      { id: "else", label: `${b}%`, cor: EDGE_ELSE },
    ]
  }
  return [{ id: "out", label: "", cor: EDGE_PRIMARY }]
}

export function temSaida(tipo: FlowNodeType): boolean {
  return !NODE_TYPES[tipo].isEnd
}