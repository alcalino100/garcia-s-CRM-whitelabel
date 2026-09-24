import { createClient } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config"

function db() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

// Janela de agendamento: seg–sex, 08:00–18:00, blocos de 30min (America/Sao_Paulo).
const DIAS_UTEIS = [1, 2, 3, 4, 5]
const INICIO_MIN = 8 * 60
const FIM_MIN = 18 * 60
const BLOCO_MIN = 30

function hojeBRT(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date())
}

function somarDias(diaISO: string, n: number): string {
  const [y, m, d] = diaISO.split("-").map(Number)
  return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10)
}

function diaDow(diaISO: string): number {
  return new Date(`${diaISO}T12:00:00Z`).getUTCDay()
}

function proximosDiasUteis(qtd: number): string[] {
  const out: string[] = []
  let base = hojeBRT()
  while (out.length < qtd) {
    base = somarDias(base, 1)
    if (DIAS_UTEIS.includes(diaDow(base))) out.push(base)
  }
  return out
}

// Horários ocupados num dia (visitas marcadas). Retorna ["09:00", ...].
export async function horariosOcupados(diaISO: string): Promise<string[]> {
  try {
    const { data } = await db().from("visitas").select("horario").eq("data", diaISO).limit(200)
    return ((data ?? []) as { horario: string }[]).map((v) => String(v.horario || "").slice(0, 5)).filter(Boolean)
  } catch {
    return []
  }
}

export function slotsLivres(ocupados: string[]): string[] {
  const livres: string[] = []
  for (let m = INICIO_MIN; m + BLOCO_MIN <= FIM_MIN; m += BLOCO_MIN) {
    const h = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
    if (!ocupados.includes(h)) livres.push(h)
  }
  return livres
}

// Consulta disponibilidade: próximos dias úteis com horários livres.
export async function consultarDisponibilidade(dias = 5): Promise<{ dia: string; livres: string[] }[]> {
  const out: { dia: string; livres: string[] }[] = []
  for (const dia of proximosDiasUteis(Math.min(Math.max(dias, 1), 10))) {
    const livres = slotsLivres(await horariosOcupados(dia))
    if (livres.length) out.push({ dia, livres })
  }
  return out
}

// Marca ou REMARCA (upsert por lead): se o lead já tem visita futura, atualiza
// data/horário em vez de duplicar. Move para "visita agendada" + log + obs.
export async function agendarOuRemarcar(params: {
  leadId: string
  data: string
  horario: string
  corretorId?: string
  observacoes?: string
}): Promise<{ ok: boolean; acao?: "marcada" | "remarcada"; erro?: string }> {
  const { leadId, data, horario } = params
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return { ok: false, erro: "Data inválida (use AAAA-MM-DD)." }
  if (!/^\d{2}:\d{2}$/.test(horario)) return { ok: false, erro: "Horário inválido (use HH:MM)." }
  try {
    const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
    const { data: existentes } = await db().from("visitas").select("id").eq("lead_id", leadId).gte("data", hoje).order("data", { ascending: true }).limit(5)
    const lista = (existentes ?? []) as { id: string }[]
    let acao: "marcada" | "remarcada" = "marcada"
    if (lista.length) {
      const { error } = await db().from("visitas").update({
        data, horario: horario.slice(0, 5),
        ...(params.corretorId ? { corretor_id: params.corretorId } : {}),
        ...(params.observacoes ? { observacoes: params.observacoes } : {}),
      }).eq("id", lista[0].id)
      if (error) throw new Error(error.message)
      acao = "remarcada"
    } else {
      const { error } = await db().from("visitas").insert({
        lead_id: leadId, data, horario: horario.slice(0, 5),
        corretor_id: params.corretorId ?? null,
        referencias: "",
        observacoes: params.observacoes ?? "",
      })
      if (error) throw new Error(error.message)
    }
    const dataBR = data.split("-").reverse().slice(0, 2).join("/")
    try {
      const { data: lead } = await db().from("leads").select("observacoes").eq("id", leadId).maybeSingle()
      const obs = String((lead as { observacoes?: unknown } | null)?.observacoes ?? "")
      const linha = `📅 [${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] Visita ${acao} pela IA: ${dataBR} às ${horario.slice(0, 5)}.`
      await db().from("leads").update({
        status: "visita agendada",
        observacoes: `${obs.trim()}\n${linha}`.trim().slice(-6000),
        atualizado_em: new Date().toISOString(),
      }).eq("id", leadId)
      await db().from("automation_logs").insert({
        lead_id: leadId,
        event_type: "ia_visita_agendada",
        event_title: `Visita ${acao} pela IA (${dataBR} ${horario.slice(0, 5)})`,
        event_description: linha,
        actor_type: "ia",
      })
    } catch { /* trilha best-effort */ }
    return { ok: true, acao }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}
