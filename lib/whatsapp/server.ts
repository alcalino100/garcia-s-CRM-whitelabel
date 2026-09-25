import { createClient } from "@supabase/supabase-js"
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/config"

// Cliente Supabase server-side (sem sessão persistida)
export const wsupabase = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })

// Configuração da Evolution API. A chave fica em EVOLUTION_API_KEY_2 (com fallback).
export function evolutionConfig() {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "") ?? ""
  const key = process.env.EVOLUTION_API_KEY_2 || process.env.EVOLUTION_API_KEY || ""
  return { url, key, ok: Boolean(url && key) }
}

// Cliente privilegiado para gravar no Storage (a chave publishable não tem permissão de
// escrita em objetos; o webhook roda no servidor e pode usar a chave secreta).
function storageClient() {
  const secret = process.env.SUPABASE_SECRET_KEY
  if (!secret) return null
  return createClient(SUPABASE_URL, secret, { auth: { persistSession: false } })
}

// ---------------------------------------------------------------------------
// Mídia recebida/enviada (imagem, áudio, vídeo, documento, figurinha)
// ---------------------------------------------------------------------------
const BUCKET_MIDIA = "whatsapp-midia"

export type TipoMidia = "image" | "audio" | "video" | "document" | "sticker"

export interface MidiaDetectada {
  tipo: TipoMidia
  legenda: string | null
  mimeType: string | null
  nomeArquivo: string | null
}

// Identifica o tipo de mídia a partir do objeto message da Evolution/Baileys.
// Retorna null quando a mensagem é de texto puro (segue o fluxo normal).
export function detectarMidia(message: any): MidiaDetectada | null {
  if (!message) return null
  const m = message.ephemeralMessage?.message ?? message.viewOnceMessage?.message ?? message
  if (m.imageMessage) return { tipo: "image", legenda: m.imageMessage.caption ?? null, mimeType: m.imageMessage.mimetype ?? "image/jpeg", nomeArquivo: null }
  if (m.audioMessage) return { tipo: "audio", legenda: null, mimeType: m.audioMessage.mimetype ?? "audio/ogg", nomeArquivo: null }
  if (m.videoMessage) return { tipo: "video", legenda: m.videoMessage.caption ?? null, mimeType: m.videoMessage.mimetype ?? "video/mp4", nomeArquivo: null }
  if (m.documentMessage) return { tipo: "document", legenda: m.documentMessage.caption ?? null, mimeType: m.documentMessage.mimetype ?? "application/octet-stream", nomeArquivo: m.documentMessage.fileName ?? null }
  if (m.stickerMessage) return { tipo: "sticker", legenda: null, mimeType: m.stickerMessage.mimetype ?? "image/webp", nomeArquivo: null }
  return null
}

// Extensão de arquivo a partir do mime type (para nomear o objeto no Storage).
function extDoMime(mime: string | null): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
    "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/amr": "amr",
    "video/mp4": "mp4", "video/3gpp": "3gp",
    "application/pdf": "pdf",
  }
  return map[(mime ?? "").split(";")[0].trim()] ?? "bin"
}

// Pede à Evolution o conteúdo de uma mensagem de mídia (base64). Best-effort: retorna null
// se a mídia já expirou ou a instância recusar.
async function baixarMidiaBase64(instanceName: string, mensagemId: string): Promise<{ base64: string; mimeType: string | null } | null> {
  const cfg = evolutionConfig()
  if (!cfg.ok) return null
  try {
    const res = await fetch(`${cfg.url}/chat/getBase64FromMediaMessage/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify({ message: { key: { id: mensagemId } }, convertToMp4: false }),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => null)
    const base64 = json?.base64 ?? json?.media ?? null
    if (!base64 || typeof base64 !== "string") return null
    return { base64, mimeType: json?.mimetype ?? null }
  } catch {
    return null
  }
}

// Obtém o áudio de uma mensagem como base64 (para transcrição por IA).
// Retorna null se a mídia expirou, a instância recusar ou passar de ~8MB.
export async function obterAudioBase64(
  instanceName: string,
  mensagemId: string | null,
): Promise<{ base64: string; mimeType: string | null } | null> {
  if (!mensagemId) return null
  const baixado = await baixarMidiaBase64(instanceName, mensagemId)
  if (!baixado) return null
  if (baixado.base64.length > 11_000_000) return null
  return baixado
}
export async function baixarEArmazenarMidia(
  instanceName: string,
  mensagemId: string,
  midia: MidiaDetectada,
): Promise<{ url: string; mimeType: string | null } | null> {
  const storage = storageClient()
  if (!storage) return null
  const baixado = await baixarMidiaBase64(instanceName, mensagemId)
  if (!baixado) return null
  const mimeType = baixado.mimeType ?? midia.mimeType
  const ext = extDoMime(mimeType)
  const caminho = `${instanceName}/${mensagemId}.${ext}`
  try {
    const buffer = Buffer.from(baixado.base64, "base64")
    const { error } = await storage.storage.from(BUCKET_MIDIA).upload(caminho, buffer, {
      contentType: mimeType ?? "application/octet-stream",
      upsert: true,
    })
    if (error) return null
    const { data } = storage.storage.from(BUCKET_MIDIA).getPublicUrl(caminho)
    return { url: data.publicUrl, mimeType }
  } catch {
    return null
  }
}

// Transforma o nome do corretor em um slug seguro para nome de instância
export function slugify(v: string) {
  return (v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
}

// Nome da instância baseado no nome do corretor + sufixo do id (garante unicidade)
export function instanceNameFor(corretorId: string, nome?: string) {
  const base = nome ? slugify(nome) : ""
  const suffix = corretorId.slice(0, 8)
  return base ? `${base}-${suffix}` : `corretor-${suffix}`
}

// Só dígitos, para comparar telefones de forma consistente
export function onlyDigits(v: string) {
  return (v || "").replace(/\D/g, "")
}

// Mapeia o estado da Evolution para o status interno
export function mapConnectionState(state?: string): "conectado" | "conectando" | "desconectado" {
  if (state === "open") return "conectado"
  if (state === "connecting") return "conectando"
  return "desconectado"
}

// ---------------------------------------------------------------------------
// Notificações via WhatsApp (Evolution)
// ---------------------------------------------------------------------------
// O gestor conecta o próprio WhatsApp no CRM; a partir daí o app usa essa
// instância para avisá-lo de desconexões e de vendas fechadas (grupo).
// Config:
//   WHATSAPP_NOTIFY_NUMBER   -> número que recebe os alertas (padrão 5518996647087).
//   WHATSAPP_NOTIFY_INSTANCE -> (opcional) instância que envia; default: resolvida pelo número acima.
//   WHATSAPP_NOTIFY_GROUP    -> (opcional) JID do grupo p/ vendas; default: coluna notif_grupo da instância.
const NOTIFY_NUMBER_DEFAULT = "5518996647087"

export function whatsappNotifyNumber(): string {
  return process.env.WHATSAPP_NOTIFY_NUMBER?.replace(/\D/g, "").trim() || NOTIFY_NUMBER_DEFAULT
}

export interface NotifyTarget {
  instanceName: string
  numero: string
  grupo: string | null
}

// Resolve a instância que envia as notificações (a do gestor) e o grupo configurado.
// Tolerante à coluna notif_grupo ainda não existir (script 010 pendente).
export async function resolveNotifyTarget(): Promise<NotifyTarget | null> {
  const numero = whatsappNotifyNumber()
  let instanceName = process.env.WHATSAPP_NOTIFY_INSTANCE?.trim() || null
  if (!instanceName) {
    try {
      const { data } = await wsupabase
        .from("whatsapp_instancias")
        .select("instance_name")
        .eq("numero", numero)
        .maybeSingle()
      instanceName = data?.instance_name ?? null
    } catch {
      instanceName = null
    }
  }
  if (!instanceName) return null
  let grupo = process.env.WHATSAPP_NOTIFY_GROUP?.trim() || null
  if (!grupo) {
    try {
      const { data } = await wsupabase
        .from("whatsapp_instancias")
        .select("notif_grupo")
        .eq("instance_name", instanceName)
        .maybeSingle()
      grupo = data?.notif_grupo ?? null
    } catch {
      grupo = null
    }
  }
  return { instanceName, numero, grupo }
}

// Presença "digitando..." (velocidade percebida). Best-effort: nunca derruba.
// Evolution v2: POST /chat/sendPresence/{instance} { number, presence, delay }.
export async function sendPresence(instanceName: string, telefone: string, presence: "composing" | "recording" | "paused" = "composing"): Promise<void> {
  try {
    const cfg = evolutionConfig()
    if (!cfg.ok || !instanceName || !telefone) return
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 4000)
    try {
      await fetch(`${cfg.url}/chat/sendPresence/${encodeURIComponent(instanceName)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.key },
        body: JSON.stringify({ number: onlyDigits(telefone), presence, delay: 3000 }),
        signal: ctrl.signal,
      }).catch(() => null)
    } finally {
      clearTimeout(t)
    }
  } catch { /* silencioso de propósito */ }
}

// Envia um texto pela Evolution. number aceita telefone (só dígitos) ou JID de grupo (@g.us).
export async function sendWhatsAppText(instanceName: string, number: string, text: string): Promise<{ ok: boolean; erro?: string; keyId?: string }> {
  const cfg = evolutionConfig()
  if (!cfg.ok) return { ok: false, erro: "Integração WhatsApp não configurada." }
  try {
    const res = await fetch(`${cfg.url}/message/sendText/${encodeURIComponent(instanceName)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: cfg.key },
      body: JSON.stringify({ number, text }),
    })
    if (!res.ok) {
      const txt = (await res.text().catch(() => "")).slice(0, 200)
      return { ok: false, erro: `HTTP ${res.status} ${txt}` }
    }
    // O corpo 201 da Evolution traz a "key" do envio — usada para correlacionar o eco
    // (fromMe) e evitar duplicata no Inbox.
    const j = await res.json().catch(() => null)
    const keyId: string | undefined = j?.key?.id ?? undefined
    return { ok: true, keyId }
  } catch (err) {
    const cause = (err as any)?.cause?.code || (err as any)?.name || "UNKNOWN"
    return { ok: false, erro: cause }
  }
}

// Avisa o gestor via WhatsApp.
// destino "numero" = só o número do gestor; "grupo" = destino secundário (grupo/contato) com fallback;
// "todos" = envia para o gestor E para o destino secundário (ex.: Pati).
export async function notifyGestorWhatsApp(text: string, destino: "numero" | "grupo" | "todos" = "numero"): Promise<{ ok: boolean; erro?: string }> {
  const alvo = await resolveNotifyTarget()
  if (!alvo) return { ok: false, erro: "Instância do gestor não encontrada (conecte o WhatsApp dele no CRM)." }
  let destinos: string[]
  if (destino === "numero") destinos = [alvo.numero]
  else if (destino === "grupo") destinos = [alvo.grupo ?? alvo.numero]
  else destinos = Array.from(new Set([alvo.numero, ...(alvo.grupo ? [alvo.grupo] : [])]))
  const resultados = await Promise.all(destinos.map((d) => sendWhatsAppText(alvo.instanceName, d, text)))
  const erros = resultados.filter((r) => !r.ok).map((r) => r.erro ?? "erro")
  return { ok: erros.length === 0, erro: erros.length ? erros.join("; ") : undefined }
}

// Avisa o gestor que uma instância (de um corretor) caiu + registra no CRM.
export async function notifyDisconnection(instanceName: string): Promise<void> {
  try {
    const { data: inst } = await wsupabase
      .from("whatsapp_instancias")
      .select("corretor_id")
      .eq("instance_name", instanceName)
      .maybeSingle()
    let nome = instanceName
    if (inst?.corretor_id) {
      const { data: corretor } = await wsupabase.from("usuarios").select("nome").eq("id", inst.corretor_id).maybeSingle()
      if (corretor?.nome) nome = corretor.nome
    }
    const horario = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    const texto = [
      "🚨🔴 ALERTA: WHATSAPP DESCONECTADO 🔴🚨",
      "",
      `📵 Corretor: ${nome}`,
      `📱 Instância: ${instanceName}`,
      `🕒 ${horario}`,
      "",
      "⚠️ Providencie a reconexão o quanto antes!",
    ].join("\n")
    await notifyGestorWhatsApp(texto, "todos")
    await wsupabase.from("notificacoes").insert({
      mensagem: `WhatsApp de ${nome} foi desconectado (${instanceName}).`,
      tipo: "whatsapp_desconectado",
      para_role: "gestor",
    })
  } catch {
    /* notificação é best-effort */
  }
}
