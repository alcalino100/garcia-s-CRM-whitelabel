import { NextResponse } from "next/server"
import { TAG_FOLLOWUP, TAG_NAO_RESPONDEU_AUTOMACAO, TAG_RESPONDEU_AUTOMACAO, comRef, normalizePhone, semRef } from "@/lib/labels"
import { baixarEArmazenarMidia, detectarMidia, mapConnectionState, notifyDisconnection, onlyDigits, wsupabase, type MidiaDetectada } from "@/lib/whatsapp/server"
import { registrarRespostaDeLead, registrarStatusEntrega } from "@/lib/automation-services"
import { enviarLeadCapi } from "@/lib/meta/capi"
import { TELEFONES_BLOQUEADOS, isTelefoneBloqueado as isBlockedCentral } from "@/lib/telefones-bloqueados"
import { agenteParaInstancia, handlePatriciaInbound, isNumeroTesteIA, pausarIaMensagemManual } from "@/lib/ai/inboxHandler"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
// Mídia (download/transcrição) + debounce + geração Claude + envio podem passar
// dos 30s padrão — 60s dão folga sem estourar o limite do plano.
export const maxDuration = 120

// Sempre responde 200 para não interromper o fluxo da Evolution
const ok = () => NextResponse.json({ received: true })

// Números internos que NUNCA podem virar lead — lista centralizada em lib/telefones-bloqueados.ts
// Mantém compatibilidade com WHATSAPP_BLOCKED_NUMBERS via env (merge)
const ENV_BLOCKED = new Set(
  (process.env.WHATSAPP_BLOCKED_NUMBERS || "")
    .split(",")
    .map((s) => s.trim().replace(/\D/g, ""))
    .filter(Boolean)
)
const BLOCKED_NUMBERS = new Set<string>([...TELEFONES_BLOQUEADOS, ...ENV_BLOCKED])
const isBlocked = (telefone: string) => BLOCKED_NUMBERS.has(telefone.replace(/\D/g, "")) || isBlockedCentral(telefone)

// Nomes internos que NUNCA podem virar lead (ex.: esposa/parentes de corretores).
// Configurável via WHATSAPP_BLOCKED_NAMES (separado por vírgula). Comparação normalizada
// (sem acentos/emoji) — "Fran 🌹" e "Fran" são tratados como o mesmo nome.
function normalizeName(v: string): string {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
const BLOCKED_NAMES = new Set(
  (process.env.WHATSAPP_BLOCKED_NAMES || "ketrine cristiane,fran")
    .split(",")
    .map((s) => normalizeName(s))
    .filter(Boolean)
)
function isBlockedName(nome: string): boolean {
  const n = normalizeName(nome)
  if (!n) return false
  return Array.from(BLOCKED_NAMES).some((b) => n === b || n.startsWith(`${b} `))
}

function getInstanceName(payload: any): string | null {
  return payload?.instance ?? payload?.instanceName ?? payload?.data?.instance ?? null
}

async function handleConnectionUpdate(payload: any) {
  const instanceName = getInstanceName(payload)
  if (!instanceName) return
  const state = payload?.data?.state ?? payload?.data?.connection ?? payload?.state
  const status = mapConnectionState(state)
  const numeroRaw = payload?.data?.wuid ?? payload?.data?.number ?? payload?.wuid ?? null
  const numero = numeroRaw ? onlyDigits(String(numeroRaw).split("@")[0]) : null

  // Estado anterior para detectar a transição (evita spam de alertas de desconexão)
  const { data: anterior } = await wsupabase
    .from("whatsapp_instancias")
    .select("status")
    .eq("instance_name", instanceName)
    .maybeSingle()

  const patch: Record<string, unknown> = { status, atualizado_em: new Date().toISOString() }
  if (status === "conectado" && numero) patch.numero = numero
  if (status === "conectado") patch.qr_code = null
  await wsupabase.from("whatsapp_instancias").update(patch).eq("instance_name", instanceName)

  // Instância que estava conectada e caiu: avisa o gestor via WhatsApp
  if (status === "desconectado" && anterior?.status === "conectado") {
    void notifyDisconnection(instanceName)
  }
}

// Detecta se a mensagem nasceu de um clique em anúncio (Click-to-WhatsApp).
// A Meta injeta esse contexto na 1ª mensagem; a Evolution repassa em campos que
// variam por versão, então tentamos todos, em ordem de prioridade.
// Alguns cliques chegam SEM contexto (Evolution inconsistente) — nesse caso,
// cai no fallback por conteúdo (texto pré-preenchido do anúncio).
function pareceTextoDeAnuncio(texto: string): boolean {
  const t = (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  // Texto pré-preenchido padrão dos anúncios Click-to-WhatsApp da Meta
  return /^ola\s+gostaria\s+de\s+saber\s+mais\s+sobre\s+o\s+imovel/.test(t)
}

function detectAd(msg: any, corpo: string): { veioDeAnuncio: boolean; anuncioId: string | null; anuncioTitulo: string | null } {
  const ctx = msg?.contextInfo ?? msg?.message?.contextInfo ?? msg?.message?.extendedTextMessage?.contextInfo
  const externalAd = ctx?.externalAdReplyInfo
  const referral = msg?.message?.referral ?? msg?.referral

  // Sinal forte: referral com source_type === "ad" (campo oficial da Meta)
  if (referral?.source_type === "ad") {
    return {
      veioDeAnuncio: true,
      anuncioId: referral.source_id ?? null,
      anuncioTitulo: referral.headline ?? referral.body ?? null,
    }
  }

  // Sinal forte: externalAdReplyInfo presente (Click-to-WhatsApp / anúncios com mídia)
  if (externalAd && (externalAd.sourceId || externalAd.sourceUrl || externalAd.title || externalAd.body || externalAd.mediaType)) {
    return {
      veioDeAnuncio: true,
      anuncioId: externalAd.sourceId ?? null,
      anuncioTitulo: externalAd.title ?? externalAd.body ?? null,
    }
  }

  // Sinal da Evolution para Click-to-WhatsApp: contextInfo.conversionSource
  // (não carrega ID do anúncio, mas é o que a Evolution repassa de fato)
  if (ctx?.conversionSource) {
    return { veioDeAnuncio: true, anuncioId: null, anuncioTitulo: null }
  }

  // Fallback: referral genérico com qualquer campo de anúncio
  if (referral && (referral.source_id || referral.source_type || referral.headline || referral.body)) {
    return {
      veioDeAnuncio: true,
      anuncioId: referral.source_id ?? null,
      anuncioTitulo: referral.headline ?? referral.body ?? null,
    }
  }

  // Fallback por conteúdo: texto pré-preenchido do anúncio (mesmo sem contexto CTWA)
  if (corpo && pareceTextoDeAnuncio(corpo)) {
    return { veioDeAnuncio: true, anuncioId: null, anuncioTitulo: corpo }
  }

  return { veioDeAnuncio: false, anuncioId: null, anuncioTitulo: null }
}

// Acha o lead cujo telefone bate com o do contato (para vincular a mensagem ao registro do CRM).
// Busca por variantes no BANCO (ilike) em vez de varrer a tabela inteira no JS —
// com 1000+ leads o select sem filtro corta os mais novos (PostgREST pagina em 1000).
async function encontrarLeadPorTelefone(telefone: string): Promise<string | null> {
  const digits = onlyDigits(telefone)
  if (!digits) return null
  const variantes = Array.from(new Set([digits, digits.startsWith("55") ? digits.slice(2) : `55${digits}`]))
  const { data: candidatos } = await wsupabase
    .from("leads")
    .select("id, telefone")
    .or(variantes.map((v) => `telefone.ilike.%${v}%`).join(","))
    .limit(20)
  const lead = (candidatos ?? []).find((l) => normalizePhone(l.telefone) === normalizePhone(telefone))
  return lead?.id ?? null
}

// Transições por resposta (fluxo automação → IA): quando um lead parado em
// "em_automacao" ou "em_followup" RESPONDE, ele sai da automação sozinho.
// - "NÃO" (recusa curta) em em_automacao → em_followup (nova tentativa depois)
// - qualquer outra resposta (inclusive em em_followup) → atendimento_ia
//   (Patricia assume a conversa). Best-effort: nunca derruba o webhook.
//   Não envia mensagem — só move a etapa + registra + avisa o gestor.
const RESPOSTA_NAO_PATTERNS = [
  "nao", "não", "nao quero", "não quero", "nao tenho interesse", "não tenho interesse",
  "sem interesse", "nao obrigado", "não obrigado", "nao obrigada", "não obrigada",
  "pare", "para", "stop", "sair", "remover", "excluir", "cancela", "cancelar",
  "nao me interessa", "não me interessa", "deixa pra la", "deixa pra lá",
  "agora nao", "agora não", "nao precisa", "não precisa",
]
function pareceRespostaNao(texto: string): boolean {
  const t = (texto || "").toLowerCase().trim()
  if (!t || t.length > 40) return false
  return RESPOSTA_NAO_PATTERNS.some((p) => t === p || t.startsWith(`${p} `) || t.startsWith(`${p}.`) || t.startsWith(`${p}!`))
}
async function transicaoRespostaAutomacao(leadId: string, texto: string): Promise<void> {
  try {
    const { data: lead } = await wsupabase
      .from("leads")
      .select("id,nome,status,corretor_id,observacoes,referencias")
      .eq("id", leadId)
      .maybeSingle()
    if (!lead) return
    const status = String((lead as { status?: unknown }).status ?? "")
    if (status !== "em_automacao" && status !== "em_followup" && status !== "em_atendimento") return
    // em_atendimento: só entra se for RESPOSTA a mensagem de automação enviada
    // (reativação/follow-up) nos últimos 30d — mesma regra da resposta em automação.
    // Sem job enviado, é conversa orgânica do humano: não mexe.
    let recusa = false
    if (status === "em_atendimento") {
      const corte = new Date(Date.now() - 30 * 86400000).toISOString()
      const { data: jobEnviado } = await wsupabase.from("automation_jobs").select("id").eq("lead_id", leadId).in("status", ["sent", "delivered", "read"]).gte("sent_at", corte).limit(1)
      if (!jobEnviado?.length) return
    } else {
      recusa = status === "em_automacao" && pareceRespostaNao(texto)
    }
    const destino = recusa ? "em_followup" : "atendimento_ia"
    const destinoLabel = recusa ? "Em Follow-up" : "Atendimento IA"
    const evento = recusa ? "lead_respondeu_nao_followup" : "lead_respondeu_atendimento_ia"
    // Tags de estágio: NÃO → nao-respondeu-automacao + followup; SIM/resposta →
    // respondeu-automacao (limpa nao-respondeu/followup, mantém automacao).
    const refsBase = (lead as { referencias?: unknown }).referencias
    const novasRefs = recusa
      ? comRef(comRef(refsBase as { ref: string }[], { ref: TAG_NAO_RESPONDEU_AUTOMACAO }), { ref: TAG_FOLLOWUP })
      : comRef(semRef(semRef(refsBase as { ref: string }[], TAG_NAO_RESPONDEU_AUTOMACAO), TAG_FOLLOWUP), { ref: TAG_RESPONDEU_AUTOMACAO })
    const { error: upErr } = await wsupabase
      .from("leads")
      .update({ status: destino, referencias: novasRefs, atualizado_em: new Date().toISOString() })
      .eq("id", (lead as { id: string }).id)
      .eq("status", status)
    if (upErr) return
    const nome = String((lead as { nome?: unknown }).nome ?? "Lead")
    const motivo = recusa
      ? `respondeu "NÃO" à reativação — vai para nova tentativa (follow-up)`
      : `respondeu à automação — Patricia assume em "Atendimento IA"`
    try {
      const obs = `${String((lead as { observacoes?: unknown }).observacoes ?? "").trim()}\n[Automação] ${nome} ${motivo}.`.trim().slice(-6000)
      await wsupabase.from("leads").update({ observacoes: obs }).eq("id", (lead as { id: string }).id)
    } catch { /* obs é best-effort */ }
    try {
      await wsupabase.from("automation_logs").insert({
        lead_id: (lead as { id: string }).id,
        event_type: evento,
        event_title: `${nome} respondeu — foi para "${destinoLabel}"`,
        event_description: `Lead em "${status}" respondeu "${texto.slice(0, 120)}" e foi movido para "${destino}".`,
        actor_type: "system",
      })
    } catch { /* log é best-effort */ }
    try {
      const notif: Record<string, unknown> = {
        mensagem: `${nome} respondeu à automação e foi para "${destinoLabel}"`,
        tipo: "pipeline",
        modulo: "vendas",
        para_role: "gestor",
        lead_id: (lead as { id: string }).id,
      }
      const dono = (lead as { corretor_id?: unknown }).corretor_id
      if (typeof dono === "string" && dono) notif.usuario_id = dono
      await wsupabase.from("notificacoes").insert(notif)
    } catch { /* notify é best-effort */ }
  } catch { /* nunca derruba o webhook */ }
}

// Baixa mídia com retry (a Evolution pode levar segundos para sincronizar o
// arquivo após o upsert — a 1ª tentativa imediata costuma falhar).
async function baixarMidiaComRetry(instanceName: string, mensagemId: string | null, tentativas = 3) {
  const { obterAudioBase64 } = await import("@/lib/whatsapp/server")
  for (let i = 0; i < tentativas; i++) {
    const b = await obterAudioBase64(instanceName, mensagemId).catch(() => null)
    if (b) return b
    if (i < tentativas - 1) await new Promise((r) => setTimeout(r, 3000))
  }
  return null
}

async function auditarMidia(evento: "ia_midia_download_falhou" | "ia_audio_transcrito" | "ia_imagem_descrita", titulo: string, descricao: string) {
  try {
    await wsupabase.from("automation_logs").insert({ event_type: evento, event_title: titulo, event_description: descricao, actor_type: "ia" })
  } catch { /* best-effort */ }
}

// Colunas de mídia para o insert (a URL entra depois, quando o arquivo termina de baixar).
function camposMidia(midia: MidiaDetectada | null) {
  if (!midia) return {}
  return { tipo_midia: midia.tipo, mime_type: midia.mimeType, nome_arquivo: midia.nomeArquivo }
}

// Após inserir a mensagem, baixa o arquivo da Evolution e preenche midia_url (best-effort).
// A conversa já mostrou a mensagem; a mídia aparece assim que o upload conclui (via Realtime).
async function preencherMidiaUrl(instanceName: string, mensagemId: string | null, midia: MidiaDetectada | null) {
  if (!midia || !mensagemId) return
  const armazenado = await baixarEArmazenarMidia(instanceName, mensagemId, midia)
  if (!armazenado) return
  await wsupabase
    .from("whatsapp_mensagens")
    .update({ midia_url: armazenado.url, mime_type: armazenado.mimeType ?? midia.mimeType })
    .eq("mensagem_id", mensagemId)
}

async function handleMessageUpsert(payload: any) {
  const instanceName = getInstanceName(payload)
  if (!instanceName) return
  const msg = Array.isArray(payload?.data) ? payload.data[0] : payload?.data
  if (!msg) return

  const remoteJid: string = msg?.key?.remoteJid ?? ""
  // Ignora grupos e transmissões
  if (remoteJid.includes("@g.us") || remoteJid.includes("broadcast")) return
  const telefone = onlyDigits(remoteJid.split("@")[0])
  if (!telefone) return
  // Números internos bloqueados: NÃO descarta mais — registra para o Inbox refletir
  // o Evolution de verdade, mas sem vincular lead, sem criar lead e sem acionar IA
  // (a menos que seja número de teste de IA ativa, que segue o fluxo completo).
  // Sem esse registro, contatos bloqueados "não existiam" no CRM.
  const bloqueado = isBlocked(telefone) && !(await isNumeroTesteIA(telefone))
  const mensagemId: string | null = msg?.key?.id ?? null
  // Idempotência: Evolution reentrega o mesmo evento em retry/timeout. Sem esse
  // guarda, a mesma mensagem geraria 2 linhas + 2 respostas da IA.
  if (mensagemId) {
    const { data: jaProcessada } = await wsupabase.from("whatsapp_mensagens").select("id").eq("mensagem_id", mensagemId).maybeSingle()
    if (jaProcessada) return
  }
  const midia = detectarMidia(msg?.message)
  // Transcrição/descrição de mídia só roda quando alguém vai consumir (agente de IA
  // ativo na instância ou número de teste). Instâncias sem agente (ex.: corretores)
  // apenas registram a mídia, sem gastar cota de IA.
  const deveProcessarMidiaIA =
    !!midia &&
    msg?.key?.fromMe !== true &&
    ((await agenteParaInstancia(instanceName)) !== null || (await isNumeroTesteIA(telefone)))
  // Corpo: texto puro, ou a legenda da mídia (imagem/vídeo/documento podem ter legenda).
  // Sem mídia e sem texto, mantém o rótulo antigo por segurança.
  let corpo =
    msg?.message?.conversation ??
    msg?.message?.extendedTextMessage?.text ??
    (midia ? (midia.legenda ?? "") : "[mídia]")

  // ÁUDIO: transcreve (Claude do agente primeiro, Gemini como fallback) e segue o
  // fluxo NORMAL (vínculo, regras, IA, escalação, auditoria).
  // Pula bloqueados (sem lead/teste não há quem consuma a transcrição).
  if (midia?.tipo === "audio" && !corpo.trim() && mensagemId && deveProcessarMidiaIA) {
    const b64 = await baixarMidiaComRetry(instanceName, mensagemId)
    if (!b64) {
      await auditarMidia("ia_midia_download_falhou", "Áudio não baixado", `Áudio de ${telefone} (${instanceName}) após 3 tentativas — registrado sem transcrição.`)
    } else {
      try {
        const { transcreverAudioSmart } = await import("@/lib/ai/midia")
        const t = await transcreverAudioSmart(instanceName, b64.base64, b64.mimeType ?? midia.mimeType)
        if (t.texto.trim()) {
          corpo = t.texto.trim()
          await auditarMidia("ia_audio_transcrito", "Áudio transcrito", `Áudio de ${telefone} (${instanceName}) via ${t.provedor}/${t.modelo} (${t.texto.length} chars).`)
        }
      } catch (e: unknown) {
        try {
          await wsupabase.from("automation_logs").insert({
            event_type: "ia_audio_nao_transcrito",
            event_title: "Áudio não transcrito",
            event_description: `Áudio de ${telefone} (${instanceName}) registrado sem transcrição: ${e instanceof Error ? e.message : String(e)}.`,
            actor_type: "ia",
          })
        } catch { /* log é best-effort */ }
      }
    }
  }

  // IMAGEM sem legenda: descreve via IA (Claude vision primeiro) para a IA e o
  // Inbox entenderem o conteúdo. Com legenda, mantém a legenda (sem custo extra).
  // Pula bloqueados pelo mesmo motivo do áudio acima.
  if (midia?.tipo === "image" && !corpo.trim() && mensagemId && deveProcessarMidiaIA) {
    const b64 = await baixarMidiaComRetry(instanceName, mensagemId)
    if (!b64) {
      await auditarMidia("ia_midia_download_falhou", "Imagem não baixada", `Imagem de ${telefone} (${instanceName}) após 3 tentativas — registrada sem descrição.`)
    } else {
      try {
        const { descreverImagemSmart } = await import("@/lib/ai/midia")
        const d = await descreverImagemSmart(instanceName, b64.base64, b64.mimeType ?? midia.mimeType)
        if (d.texto.trim()) {
          corpo = `📷 ${d.texto.trim()}`
          await auditarMidia("ia_imagem_descrita", "Imagem descrita", `Imagem de ${telefone} (${instanceName}) via ${d.provedor}/${d.modelo}.`)
        }
      } catch (e: unknown) {
        try {
          await wsupabase.from("automation_logs").insert({
            event_type: "ia_imagem_nao_descrita",
            event_title: "Imagem não descrita",
            event_description: `Imagem de ${telefone} (${instanceName}) registrada sem descrição: ${e instanceof Error ? e.message : String(e)}.`,
            actor_type: "ia",
          })
        } catch { /* log é best-effort */ }
      }
    }
  }

  // Bloqueado (e não é teste): só registra para fidelidade com o Evolution.
  // Não vincula lead, não detecta anúncio, não cria lead, não aciona IA.
  if (bloqueado && msg?.key?.fromMe !== true) {
    await wsupabase.from("whatsapp_mensagens").insert({
      instance_name: instanceName,
      telefone,
      nome_contato: msg?.pushName || telefone,
      corpo,
      lead_id: null,
      veio_de_anuncio: false,
      mensagem_id: mensagemId,
      ...camposMidia(midia),
    })
    await preencherMidiaUrl(instanceName, mensagemId, midia)
    return
  }

  // Mensagem enviada pelo corretor (pelo CRM ou pelo próprio celular): só registra para
  // aparecer no chat do gestor, ligada ao lead quando o telefone bate. Não passa pela
  // detecção de anúncio nem cria lead — essa lógica é só para mensagens recebidas.
  if (msg?.key?.fromMe === true) {
    // Eco de uma resposta já registrada pela IA (key_id correlaciona): não duplica.
    const { data: jaExiste } = mensagemId
      ? await wsupabase.from("whatsapp_mensagens").select("id").eq("mensagem_id", mensagemId).maybeSingle()
      : { data: null }
    if (jaExiste) return
    await wsupabase.from("whatsapp_mensagens").insert({
      instance_name: instanceName,
      telefone,
      nome_contato: null,
      corpo,
      lead_id: await encontrarLeadPorTelefone(telefone),
      de_mim: true,
      mensagem_id: mensagemId,
      ...camposMidia(midia),
    })
    await preencherMidiaUrl(instanceName, mensagemId, midia)
    // Atendimento manual: pausa a conversa IA deste contato (ai_responding=false) e
    // move o lead para em_atendimento — o corretor assumiu o papo. (Ecos da própria IA
    // são ignorados dentro de pausarIaMensagemManual via textoOutbound.)
    // Aguardado (não fire-and-forget): se a resposta voltar antes, a Vercel pode
    // congelar o trabalho em background e a pausa nunca acontece.
    await pausarIaMensagemManual({ telefone, instanceName, textoOutbound: corpo }).catch(() => {})
    return
  }

  const nome = msg?.pushName || telefone
  // Nomes internos (familiares): registra para fidelidade, mas sem lead/IA (como acima).
  if (isBlockedName(nome)) {
    await wsupabase.from("whatsapp_mensagens").insert({
      instance_name: instanceName,
      telefone,
      nome_contato: nome,
      corpo,
      lead_id: null,
      veio_de_anuncio: false,
      mensagem_id: mensagemId,
      ...camposMidia(midia),
    })
    await preencherMidiaUrl(instanceName, mensagemId, midia)
    return
  }

  // Este contato já é um lead? Se sim e houver automação enviada a ele, ESTA mensagem é a
  // resposta — liga a resposta ao job. Resolvido uma única vez e reaproveitado no insert abaixo.
  const leadIdExistente = await encontrarLeadPorTelefone(telefone)
  if (leadIdExistente) await registrarRespostaDeLead(leadIdExistente, new Date().toISOString())
  // Transição por resposta (fluxo automação → IA): lead em "em_automacao"/"em_followup"
  // que responde sai da automação sozinho. Só mensagem do lead — nunca eco próprio.
  // Best-effort com catch: jamais derruba o webhook.
  if (leadIdExistente && msg?.key?.fromMe !== true) {
    await transicaoRespostaAutomacao(leadIdExistente, corpo).catch(() => {})
  }

  // Código de rastreio (ponte /r): o texto pré-preenchido termina com "Código: XXXXXXXX".
  // Mesmo sem contexto CTWA da Meta, o código casa o clique com o lead.
  const codigo = /(?:codigo|código)[:.\s-]*([A-Z0-9]{6,10})\s*[.!]?\s*$/i.exec(corpo.trim())?.[1] ?? null
  const { data: clique } = codigo
    ? await wsupabase
        .from("rastreio_cliques")
        .select("*")
        .eq("click_id", codigo)
        .gt("expira_em", new Date().toISOString())
        .maybeSingle()
    : { data: null }

  // Descobre o corretor dono da instância
  const { data: inst } = await wsupabase
    .from("whatsapp_instancias")
    .select("corretor_id")
    .eq("instance_name", instanceName)
    .maybeSingle()
  const corretorId = inst?.corretor_id
  if (!corretorId) return

  const { veioDeAnuncio, anuncioId, anuncioTitulo } = detectAd(msg, corpo)
  const veioDeAnuncioEfetivo = veioDeAnuncio || !!clique

  // Mensagem orgânica: não cria lead nem notifica, mas vincula ao lead existente
  // (se o telefone bater com algum já cadastrado) para aparecer no chat do gestor.
  if (!veioDeAnuncioEfetivo) {
    await wsupabase.from("whatsapp_mensagens").insert({
      instance_name: instanceName,
      telefone,
      nome_contato: nome,
      corpo,
      lead_id: leadIdExistente,
      veio_de_anuncio: false,
      mensagem_id: mensagemId,
      ...camposMidia(midia),
    })
    await preencherMidiaUrl(instanceName, mensagemId, midia)
    if (!msg?.key?.fromMe) {
      // Aguardado de propósito: fire-and-forget (void) pode ser congelado pela
      // Vercel ao retornar a resposta — a IA "morre" no meio do caminho sem rastro.
      // Com idempotência por mensagem_id acima, retry da Evolution é seguro.
      // mensagemId alimenta o debounce no handler (rajada vira 1 resposta).
      await handlePatriciaInbound({ telefone, texto: corpo, leadId: leadIdExistente || undefined, instanceName, mensagemId: mensagemId || undefined }).catch(() => {})
    }
    return
  }

  // A partir daqui: mensagem confirmadamente vinda de anúncio (Click-to-WhatsApp ou ponte /r).
  // Busca informações de rastreamento Meta a partir do anúncio detectado.
  // Prioridade: contexto CTWA (anuncioId) > dados da ponte de rastreio (clique) > null.
  let metaCampaignId: string | null = clique?.meta_campaign_id ?? null
  let metaAdsetId: string | null = clique?.meta_adset_id ?? null
  let metaAdId: string | null = anuncioId ?? clique?.meta_ad_id ?? null
  let nomeAnuncio: string | null = null
  let nomeCampanha: string | null = null
  let nomeConjunto: string | null = null

  if (anuncioId) {
    const { data: metaAd } = await wsupabase
      .from("meta_ads")
      .select("campanha_id, adset_id, nome")
      .eq("id", anuncioId)
      .maybeSingle()
    if (metaAd) {
      metaCampaignId = metaAd.campanha_id ?? null
      metaAdsetId = metaAd.adset_id ?? null
      nomeAnuncio = metaAd.nome ?? null
    }
  }

  if (metaCampaignId) {
    const { data: campanha } = await wsupabase
      .from("meta_campanhas")
      .select("nome")
      .eq("id", metaCampaignId)
      .maybeSingle()
    nomeCampanha = campanha?.nome ?? null
  }

  if (metaAdsetId) {
    const { data: conjunto } = await wsupabase
      .from("meta_adsets")
      .select("nome")
      .eq("id", metaAdsetId)
      .maybeSingle()
    nomeConjunto = conjunto?.nome ?? null
  }

  const digitsTel = onlyDigits(telefone)
  const variantesTel = Array.from(new Set([digitsTel, digitsTel.startsWith("55") ? digitsTel.slice(2) : `55${digitsTel}`]))
  const { data: candidatos } = await wsupabase
    .from("leads")
    .select("id, telefone, corretor_id, status")
    .or(variantesTel.map((v) => `telefone.ilike.%${v}%`).join(","))
    .limit(20)
  const existente = (candidatos ?? []).find((l) => normalizePhone(l.telefone) === normalizePhone(telefone))

  // Nome do corretor da instância (para as notificações)
  const { data: corretor } = await wsupabase.from("usuarios").select("nome").eq("id", corretorId).maybeSingle()
  const corretorNome = corretor?.nome ?? "corretor"

  // Telefone que já é do MESMO corretor: não duplica, apenas anexa a mensagem ao lead existente
  const mesmoCorretor = existente && existente.corretor_id === corretorId
  let leadId: string | null = mesmoCorretor ? existente.id : null

  // Lead já existente: enriquece com o rastreio do clique (utm/fbc/fbp)
  if (mesmoCorretor && clique) {
    await wsupabase.from("leads").update({
      utm_campaign: clique.utm_campaign ?? null,
      utm_adset: clique.utm_adset ?? null,
      utm_ad: clique.utm_ad ?? null,
      fbc: clique.fbc ?? null,
      fbp: clique.fbp ?? null,
      client_ip: clique.ip ?? null,
      client_ua: clique.user_agent ?? null,
    }).eq("id", existente.id)
  }

  if (!mesmoCorretor) {
    // Cria lead para o corretor que recebeu o clique — mesmo que o telefone já exista para outro corretor.
    // Assim o lead do tráfego nunca fica "invisível" para quem recebeu a mensagem.
    const partesObs: string[] = ["Lead criado automaticamente via WhatsApp (Click-to-WhatsApp)"]
    if (nomeAnuncio || anuncioTitulo) partesObs.push(`Anúncio: ${nomeAnuncio || anuncioTitulo}`)
    if (nomeCampanha) partesObs.push(`Campanha: ${nomeCampanha}`)
    if (nomeConjunto) partesObs.push(`Conjunto: ${nomeConjunto}`)
    if (clique?.utm_campaign) partesObs.push(`UTM campanha: ${clique.utm_campaign}`)
    if (clique?.utm_adset) partesObs.push(`UTM conjunto: ${clique.utm_adset}`)
    const obs = partesObs.join("\n")
    // Se o anúncio não carregou contexto (detecção por conteúdo), tenta extrair o Ref. do imóvel do texto
    const referenciaExtraida = !anuncioId ? (corpo.match(/ref[.:]?\s*(\d{3,})/i)?.[1] ?? "") : ""
    const baseLead = {
      nome,
      telefone,
      email: "",
      referencia_imovel: referenciaExtraida,
      referencias: referenciaExtraida ? [referenciaExtraida] : [],
      temperatura: "morno",
      origem: "Tráfego Pago",
      observacoes: obs,
      status: "novo",
      corretor_id: corretorId,
      meta_campaign_id: metaCampaignId,
      meta_adset_id: metaAdsetId,
      meta_ad_id: metaAdId,
    }
    const rastreioLead = {
      utm_campaign: clique?.utm_campaign ?? null,
      utm_adset: clique?.utm_adset ?? null,
      utm_ad: clique?.utm_ad ?? null,
      fbc: clique?.fbc ?? null,
      fbp: clique?.fbp ?? null,
      client_ip: clique?.ip ?? null,
      client_ua: clique?.user_agent ?? null,
    }
    // Colunas de rastreio dependem da migration 013: se ainda não existirem, insere sem elas
    let { data: novo, error } = await wsupabase
      .from("leads")
      .insert({ ...baseLead, ...rastreioLead })
      .select("id")
      .maybeSingle()
    if (error && String(error.message).includes("does not exist")) {
      ;({ data: novo, error } = await wsupabase
        .from("leads")
        .insert(baseLead)
        .select("id")
        .maybeSingle())
    }
    if (error) {
      // Corrida: telefone inserido em paralelo — trata como existente
      const { data: candidatos2 } = await wsupabase
        .from("leads")
        .select("id, telefone, corretor_id, status")
        .or(variantesTel.map((v) => `telefone.ilike.%${v}%`).join(","))
        .limit(20)
      const again = (candidatos2 ?? []).find((l) => normalizePhone(l.telefone) === normalizePhone(telefone))
      leadId = again?.id ?? null
      if (again && again.corretor_id && again.corretor_id !== corretorId) {
        await wsupabase.from("notificacoes").insert({
          mensagem: `Possível lead duplicado: ${telefone} clicou em anúncio e escreveu para o WhatsApp de ${corretorNome}, mas já é lead de outro corretor (status: ${again.status}).`,
          tipo: "possivel_duplicado",
          modulo: "vendas",
          usuario_id: corretorId,
          para_role: "gestor",
          lead_id: again.id,
        })
      }
    } else {
      leadId = novo?.id ?? null
      await wsupabase.from("notificacoes").insert({
        mensagem: `Novo lead via tráfego pago (WhatsApp): ${nome} (via ${corretorNome})`,
        tipo: "lead_novo",
        modulo: "vendas",
        usuario_id: corretorId,
        para_role: "gestor",
        lead_id: leadId,
      })
      // Envia o evento Lead (CAPI) com os identificadores capturados na ponte de rastreio.
      // Melhora a "match quality" e atribui o lead à campanha/conjunto real. Best-effort.
      if (leadId) {
        try {
          await enviarLeadCapi({
            lead_id: leadId,
            telefone,
            nome,
            email: "",
            valor: 0,
            corretor_id: corretorId,
            campanha_id: metaCampaignId,
            adset_id: metaAdsetId,
            ad_id: metaAdId,
            utm_campaign: clique?.utm_campaign ?? null,
            utm_adset: clique?.utm_adset ?? null,
            utm_ad: clique?.utm_ad ?? null,
            fbc: clique?.fbc ?? null,
            fbp: clique?.fbp ?? null,
            ip: clique?.ip ?? null,
            ua: clique?.user_agent ?? null,
          })
        } catch {
          // nunca derruba o processamento do webhook
        }
      }
      // Telefone já cadastrado para outro corretor: avisa o gestor, mas o lead do clique é de quem recebeu
      if (existente && existente.corretor_id && existente.corretor_id !== corretorId) {
        const { data: dono } = await wsupabase.from("usuarios").select("nome").eq("id", existente.corretor_id).maybeSingle()
        await wsupabase.from("notificacoes").insert({
          mensagem: `Possível lead duplicado: ${telefone} clicou em anúncio e escreveu para o WhatsApp de ${corretorNome}, mas já é lead de ${dono?.nome ?? "outro corretor"} (status: ${existente.status}).`,
          tipo: "possivel_duplicado",
          modulo: "vendas",
          usuario_id: corretorId,
          para_role: "gestor",
          lead_id: existente.id,
        })
      }
    }
  }

  // Marca o clique como consumido e liga ao lead criado/encontrado
  if (clique) {
    await wsupabase.from("rastreio_cliques").update({
      telefone,
      lead_id: leadId,
      consumido: true,
    }).eq("id", clique.id)
  }

  // Registra a mensagem recebida (com contexto do anúncio)
  await wsupabase.from("whatsapp_mensagens").insert({
    instance_name: instanceName,
    telefone,
    nome_contato: nome,
    corpo,
    lead_id: leadId,
    veio_de_anuncio: true,
    anuncio_id: anuncioId,
    anuncio_titulo: anuncioTitulo,
    mensagem_id: mensagemId,
    ...camposMidia(midia),
  })
  await preencherMidiaUrl(instanceName, mensagemId, midia)

  // IA: dispara resposta automática (Patrícia ou Guilherme - teste). Aguardado pelo
  // mesmo motivo acima (nada de void): sem await, a resposta pode morrer sem rastro.
  if (!msg?.key?.fromMe) {
    await handlePatriciaInbound({ telefone, texto: corpo, leadId: leadId || leadIdExistente || undefined, instanceName, mensagemId: mensagemId || undefined }).catch(() => {})
  }
}

// Recibo de entrega/leitura (evento messages.update da Evolution). A Evolution reporta o
// status como número (Baileys: 3=entregue, 4=lido, 5=reproduzido) ou string equivalente.
function mapStatusEntrega(s: unknown): "delivered" | "read" | null {
  if (s === 3 || s === "3" || s === "DELIVERY_ACK") return "delivered"
  if (s === 4 || s === "4" || s === "READ" || s === 5 || s === "5" || s === "PLAYED") return "read"
  return null
}

async function handleMessageStatusUpdate(payload: any) {
  const itens = Array.isArray(payload?.data) ? payload.data : [payload?.data]
  for (const item of itens) {
    if (!item) continue
    const providerMessageId: string | null = item?.key?.id ?? item?.keyId ?? null
    if (!providerMessageId) continue
    const tipo = mapStatusEntrega(item?.update?.status ?? item?.status)
    if (!tipo) continue
    await registrarStatusEntrega(providerMessageId, tipo)
  }
}

export async function POST(request: Request) {
  try {
    // Se um segredo estiver configurado, exige-o na query ou header
    const secret = process.env.WHATSAPP_WEBHOOK_SECRET
    if (secret) {
      const url = new URL(request.url)
      const provided = url.searchParams.get("secret") ?? request.headers.get("x-webhook-secret")
      if (provided !== secret) return ok()
    }

    const payload = await request.json().catch(() => null)
    if (!payload) return ok()

    const event: string = payload.event ?? payload.type ?? ""
    if (event.includes("connection")) await handleConnectionUpdate(payload)
    else if (event.includes("messages") && event.includes("update")) await handleMessageStatusUpdate(payload)
    else if (event.includes("messages")) {
      // Processa TODAS as mensagens do lote (não só data[0])
      const itens = Array.isArray(payload?.data) ? payload.data : [payload?.data]
      for (const item of itens) {
        if (!item) continue
        await handleMessageUpsert({ ...payload, data: item })
      }
    }

    return ok()
  } catch (error) {
    console.log("[v0] whatsapp webhook error:", error instanceof Error ? error.message : String(error))
    return ok()
  }
}
