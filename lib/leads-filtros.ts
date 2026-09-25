import { LEAD_STATUSES, STATUS_LABEL } from "@/lib/labels"
import { ORIGENS, type LeadStatus, type Origem } from "@/lib/mock-data"

// Filtros da lista de leads persistidos na URL (fonte da verdade).
// Keys fixas, slugs amigáveis (sem encoding excessivo) para origem/status.
export const FILTRO_KEYS = ["corretor", "origem", "status", "data_inicio", "data_fim"] as const
export type FiltroKey = (typeof FILTRO_KEYS)[number]

export const ORIGEM_SLUG: Record<Origem, string> = {
  Instagram: "instagram",
  Indicação: "indicacao",
  "Tráfego Pago": "trafego-pago",
  WhatsApp: "whatsapp",
  Marketplace: "marketplace",
  Outro: "outro",
}
export const SLUG_ORIGEM: Record<string, Origem> = Object.fromEntries(
  (Object.entries(ORIGEM_SLUG) as [Origem, string][]).map(([o, s]) => [s, o as Origem]),
) as Record<string, Origem>

export const STATUS_SLUG: Record<LeadStatus, string> = {
  novo: "novo",
  "em_atendimento": "em-atendimento",
  "em_automacao": "em-automacao",
  "atendimento_ia": "atendimento-ia",
  "atendimento_humano": "atendimento-humano",
  em_followup: "em-followup",
  "escolhendo opcoes": "escolhendo-opcoes",
  "reuniao agendada": "reuniao-agendada",
  negociando: "negociando",
  fechado: "fechado",
  "imovel necessidade": "imovel-necessidade",
  permuta: "permuta",
  perdido: "perdido",
}
export const SLUG_STATUS: Record<string, LeadStatus> = Object.fromEntries(
  (Object.entries(STATUS_SLUG) as [LeadStatus, string][]).map(([s, slug]) => [slug, s as LeadStatus]),
) as Record<string, LeadStatus>

export interface FiltrosLeads {
  corretor: string
  origem: Origem | "todas"
  status: LeadStatus | "todos"
  dataInicio: string
  dataFim: string
}

export const FILTROS_DEFAULT: FiltrosLeads = {
  corretor: "todos",
  origem: "todas",
  status: "todos",
  dataInicio: "",
  dataFim: "",
}

export function lerFiltros(sp: URLSearchParams): FiltrosLeads {
  const origemSlug = sp.get("origem")
  const statusSlug = sp.get("status")
  return {
    corretor: sp.get("corretor") ?? "todos",
    origem: origemSlug && SLUG_ORIGEM[origemSlug] ? SLUG_ORIGEM[origemSlug] : "todas",
    status: statusSlug && SLUG_STATUS[statusSlug] ? SLUG_STATUS[statusSlug] : "todos",
    dataInicio: sp.get("data_inicio") ?? "",
    dataFim: sp.get("data_fim") ?? "",
  }
}

// Reconstrói a query string apenas com os filtros presentes (usado nos links da ficha e no Voltar).
export function queryFiltros(sp: URLSearchParams): string {
  const ativos: string[] = []
  for (const k of FILTRO_KEYS) {
    const v = sp.get(k)
    if (v) ativos.push(`${k}=${encodeURIComponent(v)}`)
  }
  return ativos.length ? `?${ativos.join("&")}` : ""
}