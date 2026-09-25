import { supabase } from "@/lib/supabase/client"
import { LEAD_STATUSES, STATUS_ACCENT, STATUS_LABEL, STATUS_VARIANT } from "@/lib/labels"
import type { LeadStatus } from "@/lib/mock-data"
import { getActiveWorkspaceSlug, MAIN_WORKSPACE } from "@/lib/tenant"

// Fase 2 Master: etapas editáveis por conta (rótulo/cor/ordem/visibilidade +
// chaves custom). Chaves de SISTEMA travadas (automações/IA dependem delas).
// Estratégia sem refactor: ao carregar, MUTAMOS os registros compartilhados
// (STATUS_LABEL/VARIANT/ACCENT + ordem/filtro de LEAD_STATUSES). Todas as telas
// passam a refletir sem nenhuma edição nelas. Chaves nunca mudam (automações).
export interface StageRow {
  key: string
  label: string
  variant: string
  accent: string
  ordem: number
  visivel_corretor: boolean
  ativo: boolean
  workspace_id?: string
}

// Chaves de SISTEMA: automações, worker, webhook e IA comparam esses literais.
// Nunca renomeie/remova via painel (travado na UI). Chaves custom são só vitrine.
export const SYSTEM_STAGE_KEYS: ReadonlySet<string> = new Set([
  "novo",
  "em_atendimento",
  "em_automacao",
  "atendimento_ia",
  "atendimento_humano",
  "em_followup",
  "reuniao agendada",
  "negociando",
  "fechado",
  "perdido",
]);

export function slugifyKey(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 40) || "etapa";
}

// Etapas invisíveis ao corretor (default = comportamento atual do kanban).
// Mutável via banco; o kanban lê este Set em vez de literais.
export const CORRETOR_HIDDEN: Set<string> = new Set(["em_followup", "em_automacao", "atendimento_ia", "perdido"])

function isLeadStatus(k: string): k is LeadStatus {
  return (LEAD_STATUSES as string[]).includes(k)
}

// Aplica overrides do banco (conta ativa). Idempotente; falha silenciosa.
// Conta sem linhas herda a principal (seed sob demanda no Master).
export async function loadStagesOverride(): Promise<boolean> {
  try {
    const ws = getActiveWorkspaceSlug()
    const { data, error } = await supabase.from("pipeline_stages").select("*").eq("workspace_id", ws)
    if (error || !data) return false
    const rows = (data ?? []) as StageRow[]
    if (!rows.length) return false
    for (const r of rows) {
      const k = r.key as LeadStatus
      if (r.label) (STATUS_LABEL as Record<string, string>)[k] = r.label
      if (r.variant) (STATUS_VARIANT as Record<string, string>)[k] = r.variant
      if (r.accent) (STATUS_ACCENT as Record<string, string>)[k] = r.accent
    }
    const byKey = new Map(rows.map((r) => [r.key, r] as const))
    // Base = chaves do código + customs ativas da conta.
    const base: string[] = [...(LEAD_STATUSES as string[])]
    for (const r of rows) {
      if (!r.ativo) continue
      if (!base.includes(r.key)) base.push(r.key)
    }
    const ordenadas = base.sort((a, b) => (byKey.get(a)?.ordem ?? 99) - (byKey.get(b)?.ordem ?? 99))
    const ativas = ordenadas.filter((s) => byKey.get(s)?.ativo !== false)
    LEAD_STATUSES.length = 0
    LEAD_STATUSES.push(...(ativas as LeadStatus[]))
    CORRETOR_HIDDEN.clear()
    for (const r of rows) if (!r.visivel_corretor) CORRETOR_HIDDEN.add(r.key)
    return true
  } catch {
    return false
  }
}

async function seedWorkspace(ws: string): Promise<void> {
  try {
    const { data: tem } = await supabase.from("pipeline_stages").select("key").eq("workspace_id", ws).limit(1)
    if ((tem ?? []).length) return
    const { data: base } = await supabase.from("pipeline_stages").select("*").eq("workspace_id", MAIN_WORKSPACE)
    const linhas = (((base ?? []) as StageRow[]).filter((r) => isLeadStatus(r.key))).map((r) => ({
      key: r.key,
      label: r.label,
      variant: r.variant,
      accent: r.accent,
      ordem: r.ordem,
      visivel_corretor: r.visivel_corretor,
      ativo: r.ativo,
      workspace_id: ws,
    }))
    if (linhas.length) await supabase.from("pipeline_stages").insert(linhas)
  } catch { /* best-effort */ }
}

export async function listStages(ws?: string): Promise<{ ok: boolean; rows: StageRow[]; faltaTabela: boolean }> {
  try {
    const conta = ws ?? getActiveWorkspaceSlug()
    if (conta !== MAIN_WORKSPACE) await seedWorkspace(conta)
    const { data, error } = await supabase.from("pipeline_stages").select("*").eq("workspace_id", conta).order("ordem")
    if (error) {
      const faltaTabela = String(error.message || "").toLowerCase().includes("does not exist")
        || String((error as { code?: string }).code || "") === "42P01"
      return { ok: false, rows: [], faltaTabela }
    }
    return { ok: true, rows: (data ?? []) as StageRow[], faltaTabela: false }
  } catch {
    return { ok: false, rows: [], faltaTabela: false }
  }
}

export async function saveStage(row: StageRow, ws?: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    const conta = ws ?? getActiveWorkspaceSlug()
    const { error } = await supabase.from("pipeline_stages").update({
      label: row.label,
      variant: row.variant,
      accent: row.accent,
      ordem: row.ordem,
      visivel_corretor: row.visivel_corretor,
      ativo: row.ativo,
      updated_at: new Date().toISOString(),
    }).eq("key", row.key).eq("workspace_id", conta)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

// Cria etapa custom da conta (vitrine: kanban/filtros; automação ignora).
export async function createStage(label: string, ws?: string): Promise<{ ok: boolean; erro?: string; key?: string }> {
  try {
    const conta = ws ?? getActiveWorkspaceSlug()
    const key = slugifyKey(label)
    if (!key) return { ok: false, erro: "Nome inválido." }
    if (SYSTEM_STAGE_KEYS.has(key)) return { ok: false, erro: "Chave reservada do sistema." }
    const { data: existe } = await supabase.from("pipeline_stages").select("key").eq("workspace_id", conta).eq("key", key).limit(1)
    if ((existe ?? []).length) return { ok: false, erro: "Etapa já existe nesta conta." }
    const { data: maxOrdem } = await supabase.from("pipeline_stages").select("ordem").eq("workspace_id", conta).order("ordem", { ascending: false }).limit(1)
    const ordem = (((maxOrdem ?? []) as { ordem: number }[])[0]?.ordem ?? 20) + 1
    const { error } = await supabase.from("pipeline_stages").insert({
      key, label: label.trim(), variant: "slate", accent: "#54595f",
      ordem, visivel_corretor: true, ativo: true, workspace_id: conta,
    })
    if (error) throw new Error(error.message)
    return { ok: true, key }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}

// Renomeia a CHAVE (só não-sistema): migra a etapa + todos os leads da conta.
export async function renameStageKey(oldKey: string, newLabel: string, ws?: string): Promise<{ ok: boolean; erro?: string; key?: string }> {
  try {
    const conta = ws ?? getActiveWorkspaceSlug()
    if (SYSTEM_STAGE_KEYS.has(oldKey)) return { ok: false, erro: "Etapa de sistema: chave travada (edite rótulo/cor)." }
    const key = slugifyKey(newLabel || oldKey)
    if (!key || SYSTEM_STAGE_KEYS.has(key)) return { ok: false, erro: "Nova chave inválida ou reservada." }
    const upd1 = await supabase.from("pipeline_stages").update({ key }).eq("workspace_id", conta).eq("key", oldKey)
    if (upd1.error) throw new Error(upd1.error.message)
    await supabase.from("leads").update({ status: key, atualizado_em: new Date().toISOString() }).eq("workspace_id", conta).eq("status", oldKey)
    return { ok: true, key }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}
