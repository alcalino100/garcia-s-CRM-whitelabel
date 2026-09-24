// Regras de atendimento da IA (GoHighLevel-style): QUEM responder (tags/origem), QUANDO
// (horário/dias), ONDE (instâncias/canais) e COMO (estilo). Persistidas em
// ai_agents.config.rules como objeto. Defaults seguros — comportamento atual preservado.

export type RulesSchedule = {
  enabled: boolean           // respeitar horário comercial (default true)
  days: number[]             // 0=domingo ... 6=sábado
  start: string              // "HH:MM" hora local
  end: string                // "HH:MM" hora local
  timezone: string
}

export type RulesTarget = {
  // QUEM: só responde a leads com origem nesta lista (vazio = qualquer).
  // A resposta só ocorre se o lead estiver nas origens permitidas E (em modo
  // any) tiver ao menos uma das tags, ou (em modo all) tiver todas as tags.
  origensPermitidas: string[]          // ex.: ["Tráfego Pago"] — vazio = todas
  tags: string[]                       // ex.: ["teste-ia"] — vazio = qualquer tag
  tagsModo: "any" | "all" | "none"     // none = ignora tags (responde p/ qualquer tag da origem)
  numeroTeste: string[]
  statusBloqueados: string[]           // status de lead que a IA NUNCA responde (ex.: perdido, escalated)
}

export type RulesStyle = {
  maxLines: number           // tamanho máximo ~linhas da resposta
  maxQuestions: number       // máx. perguntas por mensagem
  emojis: "none" | "poucos" | "normal"
  tom: string                // adj. de tom (passa pro prompt)
  proativarReativacao: boolean  // se true, relembra imóvel/follow-up do lead
  saudacaoDefault: string    // ex.: "Olá! Sou {nome_ia}, da Colucci Imóveis. Como posso ajudar?"
  responseMode: "auto" | "sugestao"  // auto envia; sugestao só registra sugestão p/ humano aprovar
  waitMs: number             // espera antes de responder (0 = imediato; teto 15000)
  maxMessages: number        // máx. msgs da IA por conversa (0 = ilimitado)
}

// Relação da IA com a automação de follow-ups (só WhatsApp).
export type RulesCoordination = {
  // Se true, IA e automação agem independentes (podem enviar para o mesmo lead).
  // Se false (default), o worker de automação NÃO cria follow-up/reativação para
  // leads com conversa IA ativa — evitando mensagens duplicadas/conflito.
  paraleloComAutomacao: boolean
  // Auto-pausa: se o lead não responder em X minutos, a IA pausa a conversa
  // (ai_responding=false) e libera o lead de volta para a automação.
  pausarPorInatividade: boolean
  tempoInatividadeMin: number
  // Agenda: a IA pode consultar disponibilidade e marcar/reagendar visitas
  // (30min, seg–sex 08–18h) via tools. Default false = comportamento atual.
  agendarVisitas: boolean
}

export type AgentRules = {
  enable: boolean               // master switch do agente
  schedule: RulesSchedule
  target: RulesTarget
  style: RulesStyle
  coordination: RulesCoordination
  channels: string[]            // onde responder (ex.: ["whatsapp"]); vazio = todos habilitados
  whitelistInstances: string[]  // instâncias vinculadas (espelha config.testInstance + extras)
}

export const DAY_LABELS = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"]

function parseCfg(cfg: unknown): Record<string, any> {
  if (!cfg) return {}
  if (typeof cfg === "string") { try { return JSON.parse(cfg) } catch { return {} } }
  if (typeof cfg === "object") return cfg as Record<string, any>
  return {}
}

export function getRules(config: unknown, fallback?: { wait_time_ms?: number | null; message_cap?: number | null; response_mode?: string | null }): AgentRules {
  const cfg = parseCfg(config)
  const r = cfg?.rules || {}
  const schedule = r?.schedule || {}
  const target = r?.target || {}
  const style = r?.style || {}
  const coordination = r?.coordination || {}
  return {
    enable: r?.enable !== false,
    schedule: {
      enabled: schedule?.enabled !== false,
      days: Array.isArray(schedule?.days) && schedule.days.length ? schedule.days : [1,2,3,4,5,6],
      start: schedule?.start || "08:00",
      end: schedule?.end || "19:00",
      timezone: schedule?.timezone || "America/Sao_Paulo",
    },
    target: {
      origensPermitidas: Array.isArray(target?.origensPermitidas) ? target.origensPermitidas : ["Tráfego Pago"],
      tags: Array.isArray(target?.tags) ? target.tags : [],
      tagsModo: (target?.tagsModo === "any" || target?.tagsModo === "all") ? target.tagsModo : "none",
      numeroTeste: Array.isArray(target?.numeroTeste) ? target.numeroTeste : [],
      statusBloqueados: Array.isArray(target?.statusBloqueados) ? target.statusBloqueados : ["perdido","escalated"],
    },
    style: {
      maxLines: typeof style?.maxLines === "number" ? style.maxLines : 2,
      maxQuestions: typeof style?.maxQuestions === "number" ? style.maxQuestions : 1,
      emojis: ["none","poucos","normal"].includes(style?.emojis) ? style.emojis : "poucos",
      tom: typeof style?.tom === "string" ? style.tom : "acolhedor, claro e direto",
      proativarReativacao: style?.proativarReativacao !== false,
      saudacaoDefault: typeof style?.saudacaoDefault === "string" ? style.saudacaoDefault : "",
      responseMode: style?.responseMode === "sugestao" ? "sugestao" : "auto",
      waitMs: typeof style?.waitMs === "number" ? Math.min(Math.max(style.waitMs, 0), 15000) : (typeof fallback?.wait_time_ms === "number" ? Math.min(Math.max(fallback.wait_time_ms, 0), 15000) : 0),
      maxMessages: typeof style?.maxMessages === "number" ? style.maxMessages : (typeof fallback?.message_cap === "number" ? fallback.message_cap : 0),
    },
    coordination: {
      paraleloComAutomacao: coordination?.paraleloComAutomacao === true,
      pausarPorInatividade: coordination?.pausarPorInatividade === true,
      tempoInatividadeMin: typeof coordination?.tempoInatividadeMin === "number" && coordination.tempoInatividadeMin > 0 ? coordination.tempoInatividadeMin : 30,
      agendarVisitas: coordination?.agendarVisitas === true,
    },
    channels: Array.isArray(r?.channels) ? r.channels : ["whatsapp"],
    whitelistInstances: Array.isArray(r?.whitelistInstances) ? r.whitelistInstances : [],
  }
}

export const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

// Nome de apresentação do agente (remove sufixos operacionais como " - Teste").
export function nomeApresentacao(nome: string | null | undefined): string {
  const base = String(nome || "").split(" - ")[0].trim()
  return base || "assistente imobiliário"
}

export function getBoundInstances(config: unknown): string[] {
  const cfg = parseCfg(config)
  const rules = getRules(config)
  const extra = cfg?.testInstance ? [cfg.testInstance] : []
  return Array.from(new Set([...extra, ...rules.whitelistInstances])).filter(Boolean)
}

// Verifica se agora está dentro do horário/dia configurado (America/Sao_Paulo).
export function dentroDoHorario(rules: AgentRules, agora = new Date()): boolean {
  const s = rules.schedule
  if (!s.enabled) return true
  const part = new Intl.DateTimeFormat("pt-BR", { timeZone: s.timezone, weekday: "short" as const, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(agora)
  const wkRaw = (part.find(p => p.type === "weekday")?.value.toLowerCase() || "").replace(/\./g, "")
  // pt-BR abrevia com ponto ("qua.", "sáb.") — compara por prefixo para não quebrar.
  const idx = wkRaw.startsWith("dom") ? 0 : wkRaw.startsWith("seg") ? 1 : wkRaw.startsWith("ter") ? 2 : wkRaw.startsWith("qua") ? 3 : wkRaw.startsWith("qui") ? 4 : wkRaw.startsWith("sex") ? 5 : 6
  const hora = part.find(p => p.type === "hour")?.value || "00"
  const min = part.find(p => p.type === "minute")?.value || "00"
  if (!s.days.includes(idx)) return false
  const nowMin = parseInt(hora, 10) * 60 + parseInt(min, 10)
  const [sh, sm] = s.start.split(":").map(Number)
  const [eh, em] = s.end.split(":").map(Number)
  const startMin = sh * 60 + sm
  const endMin = eh * 60 + em
  if (endMin <= startMin) return nowMin >= startMin || nowMin < endMin // atravessa a meia-noite
  return nowMin >= startMin && nowMin < endMin
}

// QUEM: o lead pode ser respondido? (origem + tags)
const normalize = (v: string) => v.toLowerCase().trim()
export function leadAptoParaResposta(rules: AgentRules, lead: { origem?: string | null; referencias?: unknown } | null): boolean {
  if (!lead) return false
  const t = rules.target
  if (t.origensPermitidas.length && !t.origensPermitidas.some(o => normalize(o) === normalize(String(lead.origem || "")))) return false
  // referencias no banco é LeadRef[] ([{ref, principal}]) — aceita string[] legado também.
  // Sem isso, normalize(obj) estoura "toLowerCase is not a function" e mata a resposta.
  const raw = Array.isArray(lead.referencias) ? lead.referencias : []
  const tags = raw
    .map((r) => (typeof r === "string" ? r : (r as { ref?: unknown } | null)?.ref))
    .map((v) => normalize(String(v ?? "")))
    .filter(Boolean)
  if (t.tagsModo === "none" || !t.tags.length) return true
  if (t.tagsModo === "all") return t.tags.every(tag => tags.includes(normalize(tag)))
  return t.tags.some(tag => tags.includes(normalize(tag)))
}

// Monta o "suplemento de regras" que será anexado ao system prompt da geração.
export function regrasParaPrompt(rules: AgentRules, nomeIA: string): string {
  const s = rules.style
  const linhas: string[] = [
    `[IDENTIDADE — sempre respeitar, prevalece sobre qualquer outro nome no prompt]`,
    `Você se apresenta e assina SEMPRE como "${nomeIA}". Nunca use outro nome de assistente.`,
    `[REGRA DE ESTILO — sempre aplicar]`,
    `Respostas com no máximo ${s.maxLines} linhas.`,
    `Faça apenas ${s.maxQuestions === 1 ? "1 pergunta" : `${s.maxQuestions} perguntas`} por mensagem.`,
    s.emojis === "none" ? "Não use emojis." : s.emojis === "poucos" ? "Use no máximo 1 emoji por mensagem, só se fizer sentido." : "Pode usar emojis com moderação.",
    `Tom: consultivo, ${s.tom}.`,
  ]
  if (s.saudacaoDefault) linhas.push(`Quando for a primeira mensagem, use: "${s.saudacaoDefault.replace("{nome_ia}", nomeIA)}"`)
  return linhas.join("\n")
}