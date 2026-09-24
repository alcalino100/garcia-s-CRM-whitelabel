import { NextResponse } from "next/server"
import { normalizePhone } from "@/lib/labels"
import { onlyDigits, wsupabase } from "@/lib/whatsapp/server"
import { renderMessage } from "@/lib/automation-services"
import { sendWhatsAppText } from "@/lib/whatsapp/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

// Follow-up de IA parada ("no-show"): conversa IA ativa com lead em
// atendimento_ia sem mensagem DO LEAD há X dias → move para em_followup e
// envia a mensagem de follow-up. Respondeu → webhook devolve p/ IA (regra
// existente). Anti-loop: 1 por lead a cada 14 dias.
// Cron diário (10h BRT). IMPORTANTE: branch sem publicar (desenvolver com calma).
const DIAS_PARADA = 2
const DIAS_ANTI_LOOP = 14
const LIMITE = 100

const UUID_RE = /^[0-9a-f-]{36}$/i

export async function GET(request: Request) {
  const url = new URL(request.url)
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get("authorization")
    const qs = url.searchParams.get("secret")
    const ok = auth === `Bearer ${secret}` || qs === secret
    if (!ok) return NextResponse.json({ ok: false, erro: "não autorizado" }, { status: 401 })
  }
  const dry = url.searchParams.get("dry") === "1"
  const dias = Math.max(1, Number(url.searchParams.get("dias") ?? DIAS_PARADA) || DIAS_PARADA)
  const corte = new Date(Date.now() - dias * 86400000)

  // Conversas IA ativas no WhatsApp.
  const { data: convs, error } = await wsupabase
    .from("conversations_ia")
    .select("id,ai_id,contact_id,external_id,channel,last_user_message_at")
    .eq("channel", "whatsapp")
    .eq("ai_responding", true)
    .limit(2000)
  if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
  const lista = ((convs ?? []) as {
    id: string; ai_id: string; contact_id: string; external_id: string | null;
    last_user_message_at: string | null;
  }[]).filter((c) => UUID_RE.test(c.contact_id || ""))
  if (!lista.length) return NextResponse.json({ ok: true, avaliadas: 0, followups: 0, dry })

  const ids = lista.map((c) => c.id)
  const leadIds = Array.from(new Set(lista.map((c) => c.contact_id)))

  const [{ data: leads }, { data: ultimas }, { data: agentes }] = await Promise.all([
    wsupabase.from("leads").select("id,nome,telefone,origem,status,corretor_id,observacoes,referencias").in("id", leadIds).limit(2000),
    wsupabase.from("messages_ia").select("conversation_id,role,created_at").in("conversation_id", ids).eq("role", "user").order("created_at", { ascending: false }).limit(5000),
    wsupabase.from("ai_agents").select("id,name,config").limit(50),
  ])
  const leadPorId = new Map(((leads ?? []) as { id: string }[]).map((l) => [l.id, l] as const))
  const ultimaDoLead = new Map<string, number>()
  for (const m of ((ultimas ?? []) as { conversation_id: string; created_at: string }[])) {
    if (!ultimaDoLead.has(m.conversation_id)) ultimaDoLead.set(m.conversation_id, new Date(m.created_at).getTime())
  }

  // Template de follow-up (da automação de follow-up ativa, se houver).
  let templateConteudo: string | null = null
  try {
    const { data: autoFu } = await wsupabase.from("automations").select("message_template_id").eq("trigger_type", "no_response_followup").eq("status", "active").is("deleted_at", null).limit(1).maybeSingle()
    const tid = (autoFu as { message_template_id?: string } | null)?.message_template_id
    if (tid) {
      const { data: tpl } = await wsupabase.from("automation_message_templates").select("content").eq("id", tid).maybeSingle()
      templateConteudo = String((tpl as { content?: unknown } | null)?.content ?? "") || null
    }
  } catch { /* sem template: só move, sem enviar */ }

  let followups = 0
  const pulados: Record<string, number> = { sem_lead: 0, fora_etapa: 0, com_resposta: 0, anti_loop: 0 }
  const detalhes: { lead: string; conversa: string }[] = []

  for (const c of lista.slice(0, LIMITE)) {
    const lead = leadPorId.get(c.contact_id) as {
      id: string; nome: string; telefone: string; origem: string; status: string;
      corretor_id: string | null; observacoes: string; referencias: { ref: string }[] | null;
    } | undefined
    if (!lead) { pulados.sem_lead++; continue }
    if (lead.status !== "atendimento_ia") { pulados.fora_etapa++; continue }
    const ultimaMsg = ultimaDoLead.get(c.id) ?? 0
    const ultimaRef = c.last_user_message_at ? new Date(c.last_user_message_at).getTime() : 0
    const ultimoLead = Math.max(ultimaMsg, ultimaRef)
    if (ultimoLead > corte.getTime()) { pulados.com_resposta++; continue }

    // Anti-loop: já teve follow-up de parada nos últimos 14 dias?
    const ha14d = new Date(Date.now() - DIAS_ANTI_LOOP * 86400000).toISOString()
    const { data: recente } = await wsupabase.from("automation_logs").select("id")
      .eq("lead_id", lead.id).eq("event_type", "ia_stall_followup")
      .gte("created_at", ha14d).limit(1)
    if ((recente ?? []).length) { pulados.anti_loop++; continue }

    // Instância do agente dono da conversa (para enviar pela via certa).
    let instanceName: string | null = null
    try {
      const ag = ((agentes ?? []) as { id: string; config: unknown }[]).find((a) => a.id === c.ai_id)
      const cfg = (ag?.config ?? {}) as { testInstance?: string; rules?: { whitelistInstances?: string[] } }
      const lista = [cfg.testInstance, ...((cfg.rules?.whitelistInstances) ?? [])].filter(Boolean) as string[]
      instanceName = lista[0] ?? null
    } catch { /* sem instância: move sem enviar */ }

    let corretorNome = ""
    if (lead.corretor_id) {
      const { data: cor } = await wsupabase.from("usuarios").select("nome").eq("id", lead.corretor_id).maybeSingle()
      corretorNome = String((cor as { nome?: unknown } | null)?.nome ?? "")
    }
    const obsLinha = `🔁 [${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}] IA sem resposta do lead há ${dias}d+ (no-show) → follow-up enviado; foi para "Em Follow-up". Se responder, a IA reassume.`
    const refs = Array.isArray(lead.referencias) ? [...lead.referencias] : []
    if (!refs.some((r) => String(typeof r === "string" ? r : (r as { ref?: unknown })?.ref ?? "").toLowerCase() === "followup")) {
      refs.push({ ref: "followup" })
    }

    let enviada = false
    let textoEnviado = ""
    if (!dry && templateConteudo && instanceName) {
      try {
        textoEnviado = renderMessage(templateConteudo, {
          lead: { nome: lead.nome, telefone: lead.telefone, origem: lead.origem },
          corretor: { nome: corretorNome },
          imobiliaria: "nossa imobiliária",
        })
        const env = await sendWhatsAppText(instanceName, lead.telefone, textoEnviado)
        enviada = env.ok
        if (env.ok) {
          try {
            await wsupabase.from("whatsapp_mensagens").insert({
              instance_name: instanceName,
              telefone: onlyDigits(lead.telefone),
              corpo: textoEnviado,
              lead_id: lead.id,
              de_mim: true,
              veio_de_anuncio: false,
              mensagem_id: env.keyId ?? null,
            })
          } catch { /* vitrine best-effort */ }
        }
      } catch { /* envio best-effort */ }
    }

    if (!dry) {
      const obs = `${(lead.observacoes ?? "").trim()}\n${obsLinha}`.trim().slice(-6000)
      const { error: upErr } = await wsupabase.from("leads")
        .update({ status: "em_followup", observacoes: obs, referencias: refs, atualizado_em: new Date().toISOString() })
        .eq("id", lead.id)
      if (upErr) continue
      try {
        await wsupabase.from("automation_logs").insert({
          lead_id: lead.id,
          event_type: "ia_stall_followup",
          event_title: `IA parada (no-show) — follow-up: ${lead.nome}`,
          event_description: `Sem mensagem do lead há ${dias}d+ em atendimento IA. Movido para follow-up${enviada ? " com mensagem enviada" : " (sem envio: sem template/instância)"}.`,
          actor_type: "system",
        })
      } catch { /* best-effort */ }
    }
    followups++
    detalhes.push({ lead: lead.nome, conversa: c.id })
  }

  return NextResponse.json({ ok: true, avaliadas: lista.length, followups, pulados, dry, detalhes: detalhes.slice(0, 50) })
}
