import { createClient } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config"
import { generateAIResponse } from "./generateResponse"
import { normalizePhone } from "@/lib/labels"
import { sendPresence, sendWhatsAppText } from "@/lib/whatsapp/server"
import { getBoundInstances, getRules, dentroDoHorario, leadAptoParaResposta, nomeApresentacao, regrasParaPrompt, sleep, type AgentRules } from "./rules"
import { consultarDisponibilidade, agendarOuRemarcar } from "./agenda-tools"

// Tools de agenda expostas à IA (quando rules.coordination.agendarVisitas).
const AGENDA_TOOLS = [
  {
    name: "consultar_disponibilidade",
    description: "Consulta os horários livres da agenda (blocos de 30min, seg–sex 08–18h). Chame SEMPRE antes de sugerir data/horário. Retorna dias (AAAA-MM-DD) com horários livres.",
    input_schema: { type: "object", properties: { dias: { type: "number", description: "Quantos dias úteis à frente (1-10, padrão 5)" } } },
  },
  {
    name: "agendar_reuniao",
    description: "Marca a reunião (ou REMARCA se o lead já tiver visita futura — nunca duplica). Chame somente após o lead confirmar dia e horário. Data em AAAA-MM-DD, horário HH:MM.",
    input_schema: {
      type: "object",
      properties: {
        data: { type: "string", description: "Data em AAAA-MM-DD" },
        horario: { type: "string", description: "Horário HH:MM (ex.: 09:30)" },
      },
      required: ["data", "horario"],
    },
  },
]

function suplementoAgendaHoje(): string {
  const agora = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
  return [
    `[AGENDAMENTO — leia com atenção] Hoje é ${agora} (America/Sao_Paulo).`,
    "Você agenda reuniões de qualificação (30min, seg–sex 08–18h).",
    "REGRA DE OURO: NUNCA invente data/horário. SEMPRE chame consultar_disponibilidade antes de sugerir, ofereça 2-3 opções reais, e SÓ chame agendar_reuniao depois que o lead confirmar dia e horário.",
    "Se o lead pedir outra data/horário, consulte de novo e, ao confirmar, chame agendar_reuniao (ela remarca sozinha se já houver visita — avise isso ao lead).",
    "Após agendar, confirme data/hora por extenso na resposta.",
    "NUNCA prometa link de reunião (não há integração de agenda externa): confirme dia e data por extenso e diga que os detalhes chegam por aqui.",
  ].join("\n")
}

function db(){ return createClient(SUPABASE_URL, SUPABASE_KEY) }
const normalize = (v: string) => (v || "").toLowerCase().trim()
// Instâncias onde o pipeline é 100% manual: o lead NUNCA muda de etapa sozinho
// (nem novo→em_atendimento na resposta). Configurável via
// WHATSAPP_MANUAL_PIPELINE_INSTANCES (vírgula). Default: Brayon (não gosta do auto-move).
const MANUAL_PIPELINE_INSTANCES = new Set(
  (process.env.WHATSAPP_MANUAL_PIPELINE_INSTANCES || "brayon-22b51e92").split(",").map((s) => s.trim()).filter(Boolean),
);

// Resolve a IA que responde numa instância. REGRA DE OURO: a instância precisa estar
// vinculada a um agente (config.testInstance ou whitelistInstances) E o agente precisa
// estar ATIVO (is_active) com regras habilitadas (rules.enable). Sem isso, não responde NUNCA.
export async function agenteParaInstancia(instanceName: string | undefined): Promise<any | null> {
  if (!instanceName) return null
  const { data: agentes, error } = await db().from("ai_agents").select("*")
  if (error || !agentes?.length) return null
  const ativos = (agentes as any[]).filter((a) => a.is_active && getRules(a.config).enable)
  return ativos.find((a) => getBoundInstances(a.config).includes(instanceName)) || null
}

// Agente cujo numeroTeste contém o telefone (ativo + regras habilitadas).
// Base do fallback de teste e do diagnóstico visível.
export async function agenteParaNumeroTeste(telefone: string | undefined): Promise<any | null> {
  if (!telefone) return null
  const alvo = normalizePhone(telefone)
  if (!alvo) return null
  try {
    const { data: agentes, error } = await db().from("ai_agents").select("*")
    if (error || !agentes?.length) return null
    const ativos = (agentes as any[]).filter((a) => a.is_active && getRules(a.config).enable)
    return ativos.find((a) => (getRules(a.config).target.numeroTeste || []).some((n) => normalizePhone(String(n || "")) === alvo)) || null
  } catch {
    return null
  }
}

// Log visível de diagnóstico do teste/automação (Admin > Logs / automation_logs).
// Chamado SOMENTE em caminho de teste ou estágio de automação — nunca no
// tráfego normal dos corretores (sem spam de log).
async function logIaDiagnostico({ telefone, instanceName, leadId, evento, titulo, descricao }: { telefone: string; instanceName?: string; leadId?: string; evento: string; titulo: string; descricao: string }): Promise<void> {
  try {
    await db().from("automation_logs").insert({
      lead_id: leadId ?? null,
      event_type: evento,
      event_title: titulo,
      event_description: `${descricao} (tel ${telefone}${instanceName ? ` via ${instanceName}` : ""})`,
      actor_type: "ia",
    })
  } catch { /* best-effort */ }
}

// Acha o lead cujo telefone bate com o contato (mesmo corretor da instância quando possível).
// Busca por variantes no BANCO (ilike) — varredura total quebra acima de 1000 leads.
async function acharLeadVinculado(telefone: string | undefined, instanceName: string | undefined): Promise<any | null> {
  if (!telefone) return null
  const digits = telefone.replace(/\D/g, "")
  if (!digits) return null
  const variantes = Array.from(new Set([digits, digits.startsWith("55") ? digits.slice(2) : `55${digits}`]))
  const { data: candidatos } = await db()
    .from("leads")
    .select("id, telefone, origem, status, corretor_id, referencias")
    .or(variantes.map((v) => `telefone.ilike.%${v}%`).join(","))
    .limit(20)
  const instancia = instanceName
    ? (await db().from("whatsapp_instancias").select("corretor_id").eq("instance_name", instanceName).maybeSingle()).data
    : null
  const corretorId = (instancia as any)?.corretor_id ?? null
  return (candidatos ?? [])
    .filter((l: any) => !corretorId || !l.corretor_id || l.corretor_id === corretorId)
    .find((l: any) => normalizePhone(l.telefone) === normalizePhone(telefone)) ?? null
}

// Resumo da conversa IA gravado nas OBSERVAÇÕES do lead (mantém trilha da primeira
// linha/ações). Chamado quando a conversa pausa (limite, inatividade, virada manual).
async function registrarResumoConversa(convId: string, leadId: string | undefined, motivo: string): Promise<void> {
  if (!convId || !leadId) return
  try {
    const { data: history } = await db().from("messages_ia").select("role,content").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(30)
    if (!history?.length) return
    const trecho = history.slice(0, 14).map((m: any) => `${m.role === "ai" ? "IA" : "Lead"}: ${String(m.content).slice(0, 160)}`).join(" | ")
    const linha = `[Atendimento IA] ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} — ${motivo}. ${trecho}`
    const { data: lead } = await db().from("leads").select("observacoes").eq("id", leadId).maybeSingle()
    const obs = (lead?.observacoes ?? "").trim()
    await db().from("leads").update({ observacoes: (obs ? `${obs}\n${linha}` : linha).slice(0, 6000) }).eq("id", leadId)
  } catch { /* best-effort */ }
}

// Move o lead na pipeline conforme a conversa (novo → em_atendimento) quando o lead
// responde e a conversa é assumida (IA ou manual). Guarda de ranking: só muda de novo.
async function moverLeadPipeline(leadId: string, para: string): Promise<void> {
  try {
    await db().from("leads").update({ status: para, atualizado_em: new Date().toISOString() }).eq("id", leadId).eq("status", "novo")
  } catch { /* best-effort */ }
}

// Janela de memória da conversa: ÚLTIMAS 30 mensagens (ordem cronológica).
// 10 era pouco para qualificação (o lead repete dados e a IA "esquecia").
// Custo: ~2-4k tokens extras por resposta (fração de centavo).
const HISTORICO_LIMITE = 30

// Metas ativas do agente injetadas no prompt (só tipos estruturados; legados
// "goal" fragmentados são ignorados para não poluir o contexto).
async function metasAtivasParaPrompt(aiId: string): Promise<string> {
  try {
    const { data } = await db()
      .from("goals")
      .select("name,type,description,questions,prompt,config")
      .eq("ai_id", aiId)
      .eq("is_active", true)
      .in("type", ["qualification", "booking", "info", "custom"])
      .order("created_at", { ascending: true })
      .limit(10)
    const goals = ((data ?? []) as {
      name: string; type: string; description: string; questions: unknown; prompt: string;
      config: { success_criteria?: unknown; next_step?: string; fallback?: string } | null;
    }[])
      .filter((g) => g.prompt && String(g.prompt).trim().length >= 10)
      .slice(0, 6)
    if (!goals.length) return ""
    const linhas = goals.map((g, i) => {
      const cfg = g.config ?? {}
      const qs = Array.isArray(g.questions) && g.questions.length
        ? ` Perguntas: ${(g.questions as string[]).join(" | ")}.`
        : ""
      const sc = cfg.success_criteria ? ` Sucesso: ${JSON.stringify(cfg.success_criteria)}.` : ""
      const nx = cfg.next_step ? ` Depois: ${cfg.next_step}.` : ""
      const fb = cfg.fallback ? ` Se falhar: ${cfg.fallback}.` : ""
      return `${i + 1}. ${g.name} (${g.type}): ${g.description || ""} Conduta: ${String(g.prompt).trim()}.${qs}${sc}${nx}${fb}`
    })
    return ["[METAS ATIVAS — siga nesta ordem; conclua uma antes de avançar]", ...linhas].join("\n")
  } catch {
    return ""
  }
}

// Chave da conversa IA de um contato: o lead vinculado quando existe, senão o
// telefone. É o que IMPEDE cruzamento entre contatos — cada remetente tem sua
// conversa, seu histórico e suas respostas. Nunca compartilhe/derive essa chave
// de outro dado (instância, agente, etc).
export function chaveConversa(leadIdEfetivo: string | undefined, telefone: string): string {
  return leadIdEfetivo || telefone
}

// STOP automático: gestor/corretor enviou mensagem manualmente na instância. A conversa
// IA daquele contato é PAUSADA (ai_responding=false), leva o lead para em_atendimento e
// registra o resumo nas observações — o atendimento passa a ser manual.
export async function pausarIaMensagemManual({ telefone, instanceName, textoOutbound }: { telefone: string; instanceName?: string; textoOutbound?: string }): Promise<void> {
  try {
    const { data: agentes } = await db().from("ai_agents").select("id,name,config")
    const agente = (agentes ?? []).find((a: any) => getBoundInstances(a.config).includes(instanceName || ""))
    if (!telefone) return
    const lead = await acharLeadVinculado(telefone, instanceName)
    const key = chaveConversa(lead?.id, telefone)
    // Anti-rajada: mesmo contato+texto nos últimos 5min → um pause basta.
    // (Retries da Evolution disparam N eventos por mensagem enviada.)
    if (textoOutbound?.trim()) {
      try {
        const desde = new Date(Date.now() - 5 * 60000).toISOString()
        const { data: repetida } = await db().from("whatsapp_mensagens")
          .select("mensagem_id").eq("instance_name", instanceName ?? "")
          .eq("telefone", telefone).eq("de_mim", true)
          .eq("corpo", textoOutbound.trim()).gte("criado_em", desde).limit(3)
        if ((repetida ?? []).length > 1) return
      } catch { /* segue o fluxo */ }
    }
    // Eco de envio da AUTOMAÇÃO (job sent recente com mesmo texto) não é
    // atendimento manual — ignora sem pausar, mover ou logar.
    if (textoOutbound?.trim() && lead) {
      try {
        const desdeJobs = new Date(Date.now() - 30 * 60000).toISOString()
        const { data: jobs } = await db().from("automation_jobs")
          .select("message_content_rendered").eq("lead_id", lead.id)
          .in("status", ["sent", "delivered", "read"])
          .gte("sent_at", desdeJobs).limit(5)
        const norm = (s: string) => s.toLowerCase().trim()
        const ecoAutomacao = ((jobs ?? []) as { message_content_rendered?: unknown }[])
          .some((j) => norm(String(j.message_content_rendered ?? "")) === norm(textoOutbound))
        if (ecoAutomacao) return
      } catch { /* segue o fluxo */ }
    }
    let convHandoff: string | undefined
    if (agente) {
      const { data: conv } = await db().from("conversations_ia").select("id,ai_responding").eq("ai_id", agente.id).eq("contact_id", key).maybeSingle()
      if (conv?.id) {
        // Eco da própria IA (o envio de uma resposta gera um evento fromMe na Evolution).
        // Se o texto que saiu é igual à última resposta da IA, NÃO é atendimento manual —
        // e não pode pausar a conversa nem mover o lead.
        if (textoOutbound) {
          try {
            const { data: ultima } = await db().from("messages_ia").select("content").eq("conversation_id", conv.id).eq("role", "ai").order("created_at", { ascending: false }).limit(1).maybeSingle()
            if (ultima && (ultima.content || "").trim() === (textoOutbound || "").trim()) return
          } catch { /* comparação é best-effort */ }
        }
        if (conv.ai_responding) await registrarResumoConversa(conv.id, lead?.id, "pausada — atendimento manual pelo corretor")
        await db().from("conversations_ia").update({ ai_responding: false }).eq("id", conv.id)
        convHandoff = conv.id
      }
    }
    if (lead) {
      if (convHandoff) {
        // Assumiu com histórico IA: qualificação + etapa + aviso ao responsável.
        const { finalizarParaHumano } = await import("./qualificacao")
        await finalizarParaHumano({
          leadId: lead.id,
          convId: convHandoff,
          aiId: (agente as { id: string }).id,
          motivo: "atendimento manual pelo corretor",
          telefone,
          instanceName,
        })
      } else if (!MANUAL_PIPELINE_INSTANCES.has(instanceName || "")) {
        // Exceção: instâncias 100% manuais (ex.: Brayon) — nunca move sozinho.
        await moverLeadPipeline(lead.id, "em_atendimento")
      }
    }
    try {
      await db().from("automation_logs").insert({
        lead_id: lead?.id ?? null,
        event_type: "ia_pausada_mensagem_manual",
        event_title: "Atendimento manual iniciado — IA pausada",
        event_description: `Corretor enviou mensagem manual para ${telefone} (${instanceName || "instância"}). Conversa IA pausada e lead movido para em_atendimento.`,
        actor_type: "gestor",
      })
    } catch { /* best-effort */ }
  } catch { /* best-effort */ }
}

// Estimativa de custo USD por 1k tokens (blend in/out; documentado como estimativa).
function custoPor1k(modelo: string): number {
  const m = (modelo || "").toLowerCase()
  if (m.includes("gpt-4o-mini")) return 0.00015
  if (m.includes("gpt-4o")) return 0.0025
  if (m.includes("claude")) return 0.001
  if (m.includes("gemini")) return 0.0002
  return 0.0002
}

// Métrica por resposta (alimenta conversation_analytics → aba Analytics).
async function registrarAnalytics(params: {
  convId: string; aiId: string; ms: number; tokens: number; modelo: string; semEscalacao: boolean;
}): Promise<void> {
  try {
    await db().from("conversation_analytics").insert({
      id: `an_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      conversation_id: params.convId,
      ai_id: params.aiId,
      resolved_without_escalation: params.semEscalacao,
      response_time_ms: Math.round(params.ms),
      user_satisfaction: null,
      api_cost_usd: Number(((params.tokens / 1000) * custoPor1k(params.modelo)).toFixed(6)),
      tokens_used: params.tokens,
    })
  } catch { /* analytics é best-effort */ }
}

// Gera + registra + ENVIA a resposta da IA numa conversa já existente (com limite de
// mensagens, espera anti-robô, gravação no histórico, envio Evolution e auditoria).
// Usado pelo fluxo automático (handlePatriciaInbound) e pelo disparo manual ("Iniciar IA").
// O envio também joga a mensagem direto no Inbox (de_mim) para o gestor ver na hora,
// com deduplicação via key_id quando a Evolution ecoa o fromMe de volta.
async function responderConversaIa({ convId, AI_ID, agenteNome, rules, leadIdEfetivo, telefone, instanceName, userMessage, inserirUsuario, ignorarLimite }: {
  convId: string; AI_ID: string; agenteNome: string; rules: AgentRules;
  leadIdEfetivo?: string; telefone: string; instanceName?: string;
  userMessage: string; inserirUsuario: boolean; ignorarLimite: boolean;
}): Promise<{ ok: boolean; erro?: string }> {
  const t0 = Date.now()
  // Mensagem vazia (sticker/reaction sem texto): não aciona ciclo de IA.
  if (!userMessage.trim()) return { ok: false, erro: "Mensagem vazia, nada a responder." }
  // TRAVA ANTI-VAZAMENTO: o agente só envia pela instância vinculada ou para
  // número de teste registrado. Vale para TODOS os caminhos (automático, manual,
  // futuros) — sem exceção silenciosa: bloqueia com erro + log visível.
  try {
    const { data: agRow } = await db().from("ai_agents").select("config,is_active").eq("id", AI_ID).maybeSingle()
    const ag = agRow as { config?: unknown; is_active?: boolean } | null
    const agRules = getRules(ag?.config)
    const agAtivo = !!ag?.is_active && agRules.enable
    const vinculado = !!instanceName && getBoundInstances(ag?.config).includes(instanceName)
    const ehTeste = (agRules.target.numeroTeste || []).some((n) => normalizePhone(String(n || "")) === normalizePhone(telefone))
    if (!agAtivo || (!vinculado && !ehTeste)) {
      try {
        await db().from("automation_logs").insert({
          lead_id: leadIdEfetivo ?? null,
          event_type: "ia_envio_bloqueado_instancia",
          event_title: "Envio bloqueado: fora da instância vinculada",
          event_description: `Agente ${AI_ID} tentou enviar para ${telefone} via "${instanceName ?? "?"}": ${!agAtivo ? "agente inativo/desabilitado" : "instância não vinculada e não é número de teste"}.`,
          actor_type: "ia",
        })
      } catch { /* log é best-effort */ }
      return { ok: false, erro: "Agente sem vínculo com esta instância (e não é número de teste). Envio bloqueado." }
    }
  } catch (e) {
    return { ok: false, erro: `Falha na trava de instância: ${e instanceof Error ? e.message : String(e)}` }
  }
  try {
    // 0) Registra a msg do lead primeiro: vale para todos os desfechos (resposta,
    //    escalação ou limite) — o gatilho sempre fica no histórico.
    if (inserirUsuario) {
      await db().from("messages_ia").insert({ id: `msg_${Date.now()}`, conversation_id: convId, role: "user", content: userMessage })
      try {
        await db().from("conversations_ia").update({ last_user_message_at: new Date().toISOString() }).eq("id", convId)
      } catch {
        /* coluna pode não existir em bancos antigos */
      }
    }

    const { data: historyDesc } = await db().from("messages_ia").select("role,content").eq("conversation_id", convId).order("created_at", { ascending: false }).limit(HISTORICO_LIMITE)
    // Últimas N em ordem cronológica (antes era: primeiras N — a IA "esquecia" tudo).
    const historyFull = [...(historyDesc || [])].reverse()
    const history = historyFull

    // 1) Escalação por triggers configurados (keyword/sentimento/max_turns). Se ativar,
    // NÃO gera resposta — pausa a IA, move o lead e audita (handoff para humano).
    try {
      const { detectEscalation } = await import("./escalationDetector")
      const esc = await detectEscalation(
        AI_ID,
        userMessage,
        (historyFull || []).map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
        { maxMessages: rules.style.maxMessages > 0 ? rules.style.maxMessages : 10 },
      )
      if (esc.shouldEscalate) {
        const { notificarEscalacao } = await import("./handoffNotifications")
        await notificarEscalacao({
          conversationId: convId,
          leadId: leadIdEfetivo,
          aiId: AI_ID,
          reason: esc.reason,
          triggerName: esc.triggerName,
          telefone,
          instanceName,
        })
        await registrarAnalytics({ convId, aiId: AI_ID, ms: Date.now() - t0, tokens: 0, modelo: "", semEscalacao: false })
        return { ok: true, erro: `Escalação: ${esc.reason}` }
      }
    } catch (e) {
      console.error("[IA] erro escalation check", e)
    }

    // 2) Trava de limite (sem trigger configurado): pausa com motivo registrado.
    if (!ignorarLimite && rules.style.maxMessages > 0) {
      const { count } = await db().from("messages_ia").select("id", { count: "exact", head: true }).eq("conversation_id", convId).eq("role", "ai")
      if ((count ?? 0) >= rules.style.maxMessages) {
        const motivo = `Limite de ${rules.style.maxMessages} respostas da IA atingido`
        await registrarResumoConversa(convId, leadIdEfetivo, `atingiu o limite de ${rules.style.maxMessages} mensagens da IA`)
        try {
          await db().from("conversations_ia").update({ ai_responding: false, status: "escalated", escalation_reason: motivo }).eq("id", convId)
        } catch {
          await db().from("conversations_ia").update({ ai_responding: false }).eq("id", convId)
        }
        try {
          await db().from("automation_logs").insert({
            lead_id: leadIdEfetivo ?? null,
            event_type: "ia_limite_atingido",
            event_title: "Limite de mensagens da IA atingido",
            event_description: `Conversa ${convId} pausada após ${count} respostas da IA (máx. ${rules.style.maxMessages}).`,
            actor_type: "ia",
          })
        } catch { /* log é best-effort */ }
        if (leadIdEfetivo) {
          const { finalizarParaHumano } = await import("./qualificacao")
          await finalizarParaHumano({
            leadId: leadIdEfetivo,
            convId,
            aiId: AI_ID,
            motivo: motivo,
            telefone,
            instanceName,
          })
        }
        await registrarAnalytics({ convId, aiId: AI_ID, ms: Date.now() - t0, tokens: 0, modelo: "", semEscalacao: false })
        return { ok: false, erro: "Limite de mensagens da IA atingido." }
      }
    }

    if (rules.style.waitMs > 0) await sleep(Math.min(rules.style.waitMs, 15000))
    // Velocidade percebida: "digitando..." antes de gerar (best-effort).
    if (instanceName) await sendPresence(instanceName, telefone).catch(() => {})
    const metas = await metasAtivasParaPrompt(AI_ID)
    const partesSuplemento = [regrasParaPrompt(rules, nomeApresentacao(agenteNome)), metas]
    // Agenda (opt-in por agente): tools + instrução de consulta antes de propor.
    const usarAgenda = rules.coordination.agendarVisitas && !!leadIdEfetivo
    if (usarAgenda) partesSuplemento.push(suplementoAgendaHoje())
    const suplemento = partesSuplemento.filter(Boolean).join("\n\n")
    const onToolUseAgenda = async (name: string, input: Record<string, unknown>): Promise<string> => {
      if (name === "consultar_disponibilidade") {
        const dias = Math.min(Math.max(Number(input.dias ?? 5) || 5, 1), 10)
        const disp = await consultarDisponibilidade(dias)
        if (!disp.length) return "Sem horários livres nos próximos dias úteis."
        return disp.map((d) => `${d.dia}: ${d.livres.join(", ")}`).join("\n")
      }
      if (name === "agendar_reuniao") {
        const r = await agendarOuRemarcar({
          leadId: leadIdEfetivo as string,
          data: String(input.data ?? ""),
          horario: String(input.horario ?? ""),
        })
        return r.ok ? `Visita ${r.acao} para ${String(input.data)} às ${String(input.horario)}. Etapa atualizada para reunião agendada.` : `Falha ao agendar: ${r.erro}`
      }
      return `Ferramenta desconhecida: ${name}`
    }
    const { message: aiResp, tokensUsed, model } = await generateAIResponse({
      aiId: AI_ID,
      userMessage,
      conversationHistory: (history || []).map((m: any) => ({ role: m.role, content: m.content })),
      regrasSuplementares: suplemento,
      ...(usarAgenda ? { tools: AGENDA_TOOLS, onToolUse: onToolUseAgenda } : {}),
    })
    await db().from("messages_ia").insert({ id: `msg_${Date.now() + 1}`, conversation_id: convId, role: "ai", content: aiResp })

    if (!instanceName) return { ok: false, erro: "Instância não informada." }
    const envRes = await sendWhatsAppText(instanceName, telefone, aiResp)

    // Degrau da pipeline: IA enviou = IA assumiu. Lead em novo/em_atendimento
    // vai para atendimento_ia (dono agora é a IA; gestor vê, corretor não).
    // Exceção: instâncias 100% manuais (ex.: Brayon) — nunca move sozinho.
    if (envRes.ok && leadIdEfetivo && !MANUAL_PIPELINE_INSTANCES.has(instanceName || "")) {
      try {
        const { data: movidos } = await db().from("leads")
          .update({ status: "atendimento_ia", atualizado_em: new Date().toISOString() })
          .eq("id", leadIdEfetivo)
          .in("status", ["novo", "em_atendimento"])
          .select("id")
        if ((movidos ?? []).length) {
          await db().from("automation_logs").insert({
            lead_id: leadIdEfetivo,
            event_type: "ia_assumiu_atendimento",
            event_title: "IA assumiu — foi para Atendimento IA",
            event_description: "Conversa assumida pela IA após resposta enviada.",
            actor_type: "ia",
          })
        }
      } catch { /* best-effort */ }
    }
    // Reflete a resposta no Inbox imediatamente (o gestor vê na hora; o eco fromMe da
    // Evolution apenas confirma a entrega e NÃO duplica graças ao key_id).
    if (envRes.ok) {
      try {
        await db().from("whatsapp_mensagens").insert({
          instance_name: instanceName,
          telefone,
          nome_contato: null,
          corpo: aiResp,
          lead_id: leadIdEfetivo ?? null,
          de_mim: true,
          veio_de_anuncio: false,
          mensagem_id: envRes.keyId ?? null,
        })
      } catch { /* vitrine é best-effort */ }
    }

    try {
      await db().from("automation_logs").insert({
        lead_id: leadIdEfetivo || null,
        event_type: envRes.ok ? "ia_resposta_enviada" : "ia_envio_falhou",
        event_title: envRes.ok ? "IA respondeu no WhatsApp" : "Falha ao enviar resposta da IA",
        event_description: envRes.ok ? `IA respondeu via ${instanceName} para ${telefone}` : `Falha ao enviar resposta via WhatsApp para ${telefone}: ${envRes.erro}`,
        actor_type: "ia",
        payload: JSON.stringify({ ai_id: AI_ID, convId, instance: instanceName, key_id: envRes.keyId ?? null }).slice(0, 400),
      })
    } catch { /* log é best-effort */ }

    // Espelho da conversa + handoff prometido: a cada resposta enviada, duplica o
    // turno nas observações do lead ([IA ...] Lead:/IA:) para controle total.
    // Se a IA prometeu consultor ("um consultor vai continuar"), move o lead para
    // Aguardando Atendimento + avisa o responsável. Sem isso a promessa vira
    // mentira e o lead apodrece na etapa.
    if (envRes.ok && leadIdEfetivo) {
      try {
        const { pareceHandoffHumano, finalizarParaHumano, espelharTurnoObs } = await import("./qualificacao")
        await espelharTurnoObs(leadIdEfetivo, userMessage, aiResp)
        if (pareceHandoffHumano(aiResp)) {
          await finalizarParaHumano({ leadId: leadIdEfetivo, convId, aiId: AI_ID, motivo: "IA concluiu e transferiu para consultor", telefone, instanceName })
        }
      } catch { /* espelho/handoff é best-effort */ }
    }

    await registrarAnalytics({ convId, aiId: AI_ID, ms: Date.now() - t0, tokens: tokensUsed ?? 0, modelo: model ?? "", semEscalacao: true })
    return envRes.ok ? { ok: true } : { ok: false, erro: envRes.erro }
  } catch (e: any) {
    console.error("[IA] erro responder", e)
    try {
      await db().from("automation_logs").insert({
        lead_id: leadIdEfetivo ?? null,
        event_type: "ia_geracao_falhou",
        event_title: "Falha na geração/resposta da IA",
        event_description: `Conversa ${convId} (${telefone}${instanceName ? ` via ${instanceName}` : ""}): ${String(e?.message ?? e).slice(0, 500)}`,
        actor_type: "ia",
      })
    } catch { /* log é best-effort */ }
    return { ok: false, erro: String(e?.message ?? e) }
  }
}

// Botão "Iniciar IA aqui"/"Retomar IA" do Inbox: reativa a conversa e dispara uma resposta
// IMEDIATA para a última mensagem do lead — diferente do fluxo automático, que só responde
// quando chega mensagem nova.
export async function dispararRespostaIA({ telefone, instanceName }: { telefone: string; instanceName?: string }): Promise<{ ok: boolean; erro?: string }> {
  try {
    const agente = await agenteParaInstancia(instanceName)
    if (!agente) return { ok: false, erro: "Nenhum agente IA ativo está vinculado a esta instância do WhatsApp." }
    const AI_ID = agente.id as string
    const rules = getRules(agente.config, agente)
    const lead = await acharLeadVinculado(telefone, instanceName)
    const key = chaveConversa(lead?.id, telefone)
    const { data: conv } = await db().from("conversations_ia").select("id,ai_responding").eq("ai_id", AI_ID).eq("contact_id", key).maybeSingle()
    if (!conv?.id) return { ok: false, erro: "Este contato ainda não tem conversa IA registrada. Quando chegar a próxima mensagem, a IA responderá sozinha." }
    if (!conv.ai_responding) await db().from("conversations_ia").update({ ai_responding: true }).eq("id", conv.id)
    const { data: ultima } = await db().from("messages_ia").select("content").eq("conversation_id", conv.id).eq("role", "user").order("created_at", { ascending: false }).limit(1).maybeSingle()
    if (!ultima?.content) return { ok: false, erro: "Essa conversa ainda não tem mensagem do lead para responder." }
    return await responderConversaIa({
      convId: conv.id, AI_ID, agenteNome: agente.name, rules,
      leadIdEfetivo: lead?.id, telefone, instanceName,
      userMessage: ultima.content, inserirUsuario: false, ignorarLimite: true,
    })
  } catch (e: any) {
    return { ok: false, erro: String(e?.message ?? e) }
  }
}

// Número de teste de algum agente ATIVO (com regras habilitadas)? Comparação
// normalizada (com/sem 55) para aceitar "18991502791" e "5518991502791" igual.
// Usado pelo webhook para NÃO descartar mensagens de teste vindas de números
// internos bloqueados — sem isso, testar o bot com o próprio time é impossível.
export async function isNumeroTesteIA(telefone: string | undefined): Promise<boolean> {
  if (!telefone) return false
  const alvo = normalizePhone(telefone)
  if (!alvo) return false
  try {
    const { data: agentes } = await db().from("ai_agents").select("config,is_active")
    return (agentes ?? []).some((a: any) => {
      if (!a?.is_active || !getRules(a.config).enable) return false
      const lista: string[] = getRules(a.config).target.numeroTeste || []
      return lista.some((n) => normalizePhone(String(n || "")) === alvo)
    })
  } catch {
    return false
  }
}

// Saudação proativa CTWA: clique no anúncio sem texto + lead novo + agente
// apto → a IA cumprimenta na hora (speed-to-lead real) em vez de silêncio.
// Nunca em instância 100% manual; nunca sem lead novo; nunca 2x.
export async function saudarLeadCTWA({ telefone, leadId, instanceName }: { telefone: string; leadId?: string; instanceName?: string }): Promise<void> {
  try {
    if (!telefone || MANUAL_PIPELINE_INSTANCES.has(instanceName || "")) return
    let agente = await agenteParaInstancia(instanceName)
    if (!agente) agente = await agenteParaNumeroTeste(telefone)
    if (!agente) return
    const AI_ID = agente.id as string
    const rules: AgentRules = getRules(agente.config, agente)
    const isTestNumber = (rules.target.numeroTeste || []).some((n) => normalizePhone(String(n || "")) === normalizePhone(telefone))
    if (!isTestNumber && !dentroDoHorario(rules)) return
    if (rules.channels.length && !rules.channels.includes("whatsapp")) return
    let lead: any = null
    if (leadId) {
      const { data: l } = await db().from("leads").select("id,nome,status,origem,corretor_id").eq("id", leadId).maybeSingle()
      lead = l
    }
    if (!lead || lead.status !== "novo") return
    if (!isTestNumber && !leadAptoParaResposta(rules, lead)) return
    if (rules.target.statusBloqueados.map(normalize).includes("novo")) return
    const key = chaveConversa(lead.id, telefone)
    const { data: existing } = await db().from("conversations_ia").select("id").eq("ai_id", AI_ID).eq("contact_id", key).maybeSingle()
    if (existing?.id) {
      const { count } = await db().from("messages_ia").select("id", { count: "exact", head: true }).eq("conversation_id", existing.id)
      if ((count ?? 0) > 0) return
    }
    const nomeApre = nomeApresentacao(agente.name)
    const primeiroNome = String(lead.nome || "").split(" ")[0] || ""
    let saudacao = String(rules.style.saudacaoDefault || "")
      .replace("{nome_ia}", nomeApre)
      .replace("{nome_lead}", primeiroNome)
      .trim()
    if (!saudacao) {
      try {
        const { message } = await generateAIResponse({
          aiId: AI_ID,
          userMessage: `[sistema] Um lead novo${primeiroNome ? ` chamado ${primeiroNome}` : ""} chegou pelo anúncio e ainda não escreveu nada. Cumprimente com 1 pergunta para iniciar a qualificação.`,
          conversationHistory: [],
          regrasSuplementares: regrasParaPrompt(rules, nomeApre),
        })
        saudacao = String(message || "").trim()
      } catch { /* sem saudação, sem envio */ }
    }
    if (!saudacao) return
    let convId: string
    if (existing?.id) {
      convId = existing.id
    } else {
      const agora = new Date().toISOString()
      const { data: created, error } = await db().from("conversations_ia").insert({
        id: `conv_${Date.now()}`, ai_id: AI_ID, contact_id: key, channel: "whatsapp",
        external_id: telefone, status: "active", ai_responding: true, last_message_at: agora,
      }).select("id").single()
      if (error || !created) return
      convId = (created as { id: string }).id
    }
    if (instanceName) await sendPresence(instanceName, telefone).catch(() => {})
    await db().from("messages_ia").insert({ id: `msg_${Date.now()}`, conversation_id: convId, role: "ai", content: saudacao })
    if (!instanceName) return
    const envRes = await sendWhatsAppText(instanceName, telefone, saudacao)
    if (envRes.ok) {
      try {
        await db().from("whatsapp_mensagens").insert({
          instance_name: instanceName, telefone, corpo: saudacao,
          lead_id: lead.id, de_mim: true, veio_de_anuncio: true, mensagem_id: envRes.keyId ?? null,
        })
      } catch { /* vitrine best-effort */ }
    }
    try {
      await db().from("automation_logs").insert({
        lead_id: lead.id,
        event_type: envRes.ok ? "ia_saudacao_ctwa" : "ia_envio_falhou",
        event_title: envRes.ok ? "IA saudou lead novo (CTWA)" : "Falha na saudação CTWA",
        event_description: envRes.ok ? `Primeiro toque via ${instanceName}.` : `Falha ao enviar saudação via ${instanceName}: ${envRes.erro}`,
        actor_type: "ia",
      })
    } catch { /* best-effort */ }
    await moverLeadPipeline(lead.id, "em_atendimento")
  } catch { /* nunca derruba o webhook */ }
}

// Junta textos de uma rajada num bloco único (uma resposta só). Puro/testável.
export function juntarRajada(corpos: (string | null | undefined)[]): string {
  return corpos
    .map((c) => (c || "").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, 2000)
}

// Janela de debounce: rajadas (textos + áudios + fotos seguidos) viram 1 resposta.
// Também dá o atraso humano natural (~2,5s + processamento). Tem que caber no
// orçamento da função (Vercel maxDuration) — 5s estourava junto com mídia+Claude.
const DEBOUNCE_MS = 2500

export async function handlePatriciaInbound({ telefone, texto, leadId, instanceName, mensagemId }: { telefone: string; texto: string; leadId?: string; instanceName?: string; mensagemId?: string }){
  try{
    // 1) REGRA DE OURO: instância vinculada a IA ativa + regras habilitadas.
    //    Fallback de TESTE: se a instância não tem agente mas o remetente é número
    //    de teste registrado em algum agente ativo, esse agente assume (somente
    //    teste — lead real nunca entra por aqui). Tudo auditado abaixo.
    let agente = await agenteParaInstancia(instanceName)
    let viaFallbackTeste = false
    if (!agente) {
      agente = await agenteParaNumeroTeste(telefone)
      viaFallbackTeste = !!agente
    }
    if(!agente) return
    const AI_ID = agente.id as string
    const rules: AgentRules = getRules(agente.config, agente)
    // Match normalizado: "18991502791" bate com "5518991502791" e vice-versa.
    const isTestNumber = (rules.target.numeroTeste || []).some((n) => normalizePhone(String(n || "")) === normalizePhone(telefone))
    const emEstagioAutomacao = (st: unknown) => ["em_automacao", "atendimento_ia", "em_followup"].includes(normalize(String(st ?? "")))
    if (viaFallbackTeste) {
      await logIaDiagnostico({ telefone, instanceName, evento: "ia_teste_fora_da_instancia", titulo: "Teste atendido fora da instância vinculada", descricao: `Agente "${agente.name}" assumiu conversa na instância "${instanceName ?? "?"}" (vinculado a [${getBoundInstances(agente.config).join(", ") || "?"}]).` })
    }

    // 2) QUANDO: se houve horário configurado e fora do expediente, não responde agora
    if (!isTestNumber && !dentroDoHorario(rules)) return

    // 3) ONDE: canal habilitado
    if (rules.channels.length && !rules.channels.includes("whatsapp")) {
      if (isTestNumber) await logIaDiagnostico({ telefone, instanceName, evento: "ia_teste_bloqueado", titulo: "Canal WhatsApp desabilitado — sem resposta", descricao: `Agente "${agente.name}" com canal WhatsApp desligado.` })
      return
    }

    // 4) QUEM: só responde para lead apto (origem + tags) ou número de teste.
    //    Mensagem orgânica/pessoal sem vínculo com lead permitido → NÃO responde.
    let lead: any = null
    if (leadId) {
      const { data: l } = await db().from("leads").select("id,origem,status,referencias,corretor_id").eq("id", leadId).maybeSingle()
      lead = l
    } else if (!isTestNumber) {
      lead = await acharLeadVinculado(telefone, instanceName)
    }
    if (!isTestNumber && !leadAptoParaResposta(rules, lead)) {
      if (lead && emEstagioAutomacao(lead.status)) await logIaDiagnostico({ telefone, instanceName, leadId: lead?.id, evento: "ia_teste_bloqueado", titulo: "Lead fora do alvo do agente — sem resposta", descricao: `Lead "${lead.id}" (origem ${String(lead.origem ?? "?")}, status ${String(lead.status ?? "?")}) não passou em origem/tags do agente "${agente.name}".` })
      return
    }
    // Status bloqueados configurados (ex.: perdido/escalated) — nunca responde
    if (lead && rules.target.statusBloqueados.map(normalize).includes(normalize(String(lead.status || "")))) {
      if (isTestNumber || emEstagioAutomacao(lead.status)) await logIaDiagnostico({ telefone, instanceName, leadId: lead?.id, evento: "ia_teste_bloqueado", titulo: "Status bloqueado — sem resposta", descricao: `Lead em "${String(lead.status)}" está em statusBloqueados do agente "${agente.name}".` })
      return
    }

    const leadIdEfetivo = lead?.id ?? undefined

    // Pipeline: lead respondeu e se qualifica → sai de "novo" e entra em atendimento.
    // Exceção: instâncias 100% manuais (ex.: Brayon) — nunca move sozinho.
    if (lead && !MANUAL_PIPELINE_INSTANCES.has(instanceName || "")) await moverLeadPipeline(lead.id, "em_atendimento")

    // 5) Busca ou cria conversa IA para este contato
    let convId: string
    const key = chaveConversa(leadIdEfetivo, telefone)
    const { data: existing } = await db().from("conversations_ia").select("id,ai_responding,last_message_at,last_user_message_at").eq("ai_id", AI_ID).eq("contact_id", key).maybeSingle()
    if(existing?.id) convId = existing.id
    else {
      const base = { id: `conv_${Date.now()}`, ai_id: AI_ID, contact_id: key, channel: "whatsapp", external_id: telefone, status: "active", ai_responding: true }
      const agora = new Date().toISOString()
      const tentativa = await db().from("conversations_ia").insert({ ...base, last_message_at: agora, last_user_message_at: agora }).select("id").single()
      if (tentativa.error && String(tentativa.error.message || "").includes("last_user_message_at")) {
        const { data: created } = await db().from("conversations_ia").insert({ ...base, last_message_at: agora }).select("id").single()
        convId = created!.id
      } else {
        if (tentativa.error) throw tentativa.error
        convId = tentativa.data!.id
      }
    }

    // Atendimento pausado pelo gestor/corretor (mensagem manual pausa a IA): não responde.
    // Visível no log para teste/automação — o "mudo" mais comum; resolve com "Retomar IA".
    if(existing?.ai_responding === false) {
      if (isTestNumber || emEstagioAutomacao(lead?.status)) {
        await logIaDiagnostico({ telefone, instanceName, leadId: leadIdEfetivo, evento: "ia_teste_bloqueado", titulo: "IA pausada — sem resposta", descricao: `Conversa ${convId} com ai_responding=false (pausada por atendimento manual). Use "Retomar IA" no Inbox para a IA voltar a responder.` })
      }
      return
    }

    // 5b) Auto-pausa por inatividade: conta a partir da última mensagem DO LEAD
    // (last_user_message_at) — não de qualquer evento da conversa. Sem essa ref
    // (conversas antigas), não pausa para não matar conversas válidas.
    if (rules.coordination.pausarPorInatividade && rules.coordination.tempoInatividadeMin > 0 && existing?.last_user_message_at) {
      const ultimaMsg = new Date(existing.last_user_message_at).getTime()
      if (Date.now() - ultimaMsg > rules.coordination.tempoInatividadeMin * 60_000) {
        await registrarResumoConversa(convId, leadIdEfetivo, "pausada por inatividade do lead")
        await db().from("conversations_ia").update({ ai_responding: false }).eq("id", convId)
        if (isTestNumber || emEstagioAutomacao(lead?.status)) {
          await logIaDiagnostico({ telefone, instanceName, leadId: leadIdEfetivo, evento: "ia_teste_bloqueado", titulo: "IA pausada por inatividade — sem resposta", descricao: `Conversa ${convId} pausada: lead há mais de ${rules.coordination.tempoInatividadeMin}min sem escrever.` })
        }
        return
      }
    }

    // 5c) Modo sugestão: gera a resposta mas NÃO envia — registra o texto completo
    // para aprovação humana no Inbox ([Enviar] [Descartar]).
    if (rules.style.responseMode === "sugestao") {
      try {
        const { data: histSug } = await db().from("messages_ia").select("role,content").eq("conversation_id", convId).order("created_at", { ascending: true }).limit(10)
        const { message: sugestao } = await generateAIResponse({
          aiId: AI_ID,
          userMessage: texto,
          conversationHistory: ((histSug || []) as { role: string; content: string }[]).map((m) => ({ role: m.role, content: m.content })),
          regrasSuplementares: regrasParaPrompt(rules, nomeApresentacao(agente.name)),
        })
        await db().from("automation_logs").insert({
          lead_id: leadIdEfetivo ?? null,
          event_type: "ia_sugestao_resposta",
          event_title: "IA sugeriu resposta (modo sugestão)",
          event_description: `Sugestão para ${telefone} via ${instanceName}: "${sugestao.slice(0, 80)}"`,
          actor_type: "ia",
          payload: JSON.stringify({ convId, telefone, instance: instanceName, sugestao }).slice(0, 2000),
        })
      } catch { /* best-effort */ }
      return
    }

    // 5d) Debounce + rajada (só no fluxo automático com mensagem identificada):
    // espera a sequência, e se chegar mensagem mais nova, esta instância sai —
    // a mais nova assume e junta TUDO num bloco único (uma resposta só).
    let textoEfetivo = texto
    if (mensagemId && instanceName) {
      await sleep(DEBOUNCE_MS)
      const buscarUltima = async () =>
        (
          await db()
            .from("whatsapp_mensagens")
            .select("mensagem_id,criado_em")
            .eq("instance_name", instanceName)
            .eq("telefone", telefone)
            .eq("de_mim", false)
            .order("criado_em", { ascending: false })
            .limit(1)
        ).data?.[0] as { mensagem_id: string; criado_em: string } | undefined
      // refTs = momento REAL da mensagem no WhatsApp (criado_em gravado), NÃO o
      // horário em que o webhook terminou de processar a mídia. Sem isso, a espera
      // da própria invocação (download+transcrição ~6s) tornava o gate inócuo e os
      // dois handlers seguiam em paralelo, duplicando o ciclo.
      // NOTA: esta query usa try/catch (e NUNCA .catch() no builder). O postgrest-js
      // desta versão não expõe .catch() na cadeia thenable do builder — encadear .catch
      // ali estourava "X.catch is not a function", matando o ciclo em silêncio ANTES de
      // gerar a resposta (sintoma exato: "compreendeu, mas não respondeu").
      let refPropriaMs: number | undefined
      try {
        const res = await db()
          .from("whatsapp_mensagens")
          .select("criado_em")
          .eq("instance_name", instanceName)
          .eq("telefone", telefone)
          .eq("mensagem_id", mensagemId)
          .maybeSingle()
        refPropriaMs = res?.data?.criado_em ? new Date(res.data.criado_em).getTime() : undefined
      } catch { /* sem a própria → fallback abaixo */ }
      const refTs = refPropriaMs ?? Date.now() - 9000
      const u1 = await buscarUltima().catch(() => undefined)
      if (u1 && u1.mensagem_id !== mensagemId && new Date(u1.criado_em).getTime() > refTs) return
      await sleep(400)
      const u2 = await buscarUltima().catch(() => undefined)
      if (u2 && u2.mensagem_id !== mensagemId && new Date(u2.criado_em).getTime() > refTs) return
      try {
        const { data: ultimaIA } = await db()
          .from("messages_ia")
          .select("created_at")
          .eq("conversation_id", convId)
          .eq("role", "ai")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        const desde = (ultimaIA as { created_at?: string } | null)?.created_at ?? new Date(Date.now() - 60000).toISOString()
        const { data: rajada } = await db()
          .from("whatsapp_mensagens")
          .select("corpo,criado_em")
          .eq("instance_name", instanceName)
          .eq("telefone", telefone)
          .eq("de_mim", false)
          .gt("criado_em", desde)
          .order("criado_em", { ascending: true })
          .limit(10)
        const bloco = juntarRajada(((rajada ?? []) as { corpo: string }[]).map((r) => r.corpo))
        if (bloco) textoEfetivo = bloco
        else {
          // Rajada vazia (ex.: áudio que não transcreveu e sem legenda): sem
          // texto não há o que responder — mas registra, nunca silêncio total.
          try {
            await db().from("automation_logs").insert({
              lead_id: leadIdEfetivo ?? null,
              event_type: "ia_ciclo_rejeitado",
              event_title: "Ciclo IA sem resposta",
              event_description: `Conversa ${convId} (${telefone}): nada aproveitável na rajada (mídia sem transcrição/legenda?).`,
              actor_type: "ia",
            })
          } catch { /* log é best-effort */ }
          return
        }
      } catch (e) {
        console.error("[IA] erro rajada, segue com texto único", e)
      }
    }

    // 5e) Gera, registra e envia (com espera anti-robô, limite de mensagens e auditoria)
    const resultado = await responderConversaIa({
      convId, AI_ID, agenteNome: agente.name, rules,
      leadIdEfetivo, telefone, instanceName,
      userMessage: textoEfetivo, inserirUsuario: true, ignorarLimite: false,
    })
    try {
      await db().from("automation_logs").insert({
        lead_id: leadIdEfetivo ?? null,
        event_type: resultado?.ok ? "ia_ciclo_finalizado" : "ia_ciclo_rejeitado",
        event_title: resultado?.ok ? "Ciclo IA concluído" : "Ciclo IA sem resposta",
        event_description: `Conversa ${convId} (${telefone}): ${resultado?.ok ? "resposta enviada" : (resultado?.erro || "sem resposta")}. Entrada: ${textoEfetivo.slice(0, 80)}`,
        actor_type: "ia",
      })
    } catch { /* log é best-effort */ }
  }catch(e){
    console.error("[IA] erro inbox", e)
    try {
      await db().from("automation_logs").insert({
        event_type: "ia_erro_fluxo",
        event_title: "Erro no fluxo de conversa IA",
        event_description: `Handle inbound (${telefone}${instanceName ? ` via ${instanceName}` : ""}): ${String(e instanceof Error ? e.message : e).slice(0, 500)}`,
        actor_type: "ia",
      })
    } catch { /* log é best-effort */ }
  }
}