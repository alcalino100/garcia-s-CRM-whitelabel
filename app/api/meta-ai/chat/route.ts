import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config"

function db() {
  return createClient(SUPABASE_URL, SUPABASE_KEY)
}

const GEMINI_KEY = process.env.GEMINI_API_KEY
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent"

interface Mensagem {
  role: "user" | "assistant"
  content: string
}

async function resolveToken(): Promise<string | null> {
  try {
    const { data } = await db().from("meta_conexao").select("access_token").eq("id", 1).maybeSingle()
    if (data?.access_token) return data.access_token
  } catch { }
  const raw = process.env.FACEBOOK_PAGE_ACCESS_TOKEN || process.env.META_ACCESS_TOKEN
  return raw?.trim().replace(/^['"]+|['"]+$/g, "") || null
}

const VERSAO = process.env.META_API_VERSION || "v21.0"
const BASE = `https://graph.facebook.com/${VERSAO}`

function resultados(actions: any[]): number {
  return (actions || [])
    .filter((a: any) => a.action_type === "lead" || a.action_type?.includes("messaging_conversation_started"))
    .reduce((s: number, a: any) => s + Number(a.value || 0), 0)
}

async function metaGetAll(url: string): Promise<any[]> {
  const out: any[] = []
  let next: string | null = url
  let guard = 0
  while (next && guard < 5) {
    guard++
    const r: Response = await fetch(next)
    const j: any = await r.json()
    if (j.error) throw new Error(j.error.message)
    if (Array.isArray(j.data)) out.push(...j.data)
    next = j.paging?.next ?? null
  }
  return out
}

interface CampanhaData {
  id: string; nome: string; gasto: number; resultados: number
  impressoes: number; cliques: number; ctr: number; cpc: number; leads: number
}
interface AdData {
  id: string; nome: string; campanha_id: string; campanha_nome: string
  gasto: number; resultados: number; impressoes: number; cliques: number
  ctr: number; cpc: number
}

export async function POST(req: Request) {
  try {
    const { message, history = [] }: { message: string; history?: Mensagem[] } = await req.json()
    if (!message?.trim()) return NextResponse.json({ response: "Digite uma pergunta." })

    const token = await resolveToken()
    const supabase = db()

    const trintaDias = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
    const hoje = new Date().toISOString().slice(0, 10)

    const { data: leadsData } = await supabase
      .from("leads").select("meta_campaign_id, created_at, status, corretor_id")
      .eq("origem", "Tráfego Pago").not("meta_campaign_id", "is", null)
      .gte("created_at", trintaDias).lte("created_at", hoje)

    const leadsPorCamp = new Map<string, number>()
    for (const l of leadsData ?? []) {
      const cid = l.meta_campaign_id
      leadsPorCamp.set(cid, (leadsPorCamp.get(cid) ?? 0) + 1)
    }
    const totalLeads = leadsData?.length ?? 0

    // ---------- DADOS ----------
    let dadosContexto = ""
    let totalSpend = 0
    let totalResults = 0
    let campanhasContext: CampanhaData[] = []
    let adsContext: AdData[] = []
    let metaOk = false

    if (token) {
      try {
        const accsRes = await fetch(`${BASE}/me/adaccounts?fields=id&limit=1&access_token=${token}`)
        const accsJson = await accsRes.json()
        let contaId = accsJson?.data?.[0]?.id || process.env.META_AD_ACCOUNT_ID || ""
        if (contaId) {
          if (!contaId.startsWith("act_")) contaId = `act_${contaId}`
          const range = `time_range=${encodeURIComponent(JSON.stringify({ since: trintaDias, until: hoje }))}`

          // Campanhas
          const campFields = "campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions"
          const campData = await metaGetAll(
            `${BASE}/${contaId}/insights?level=campaign&fields=${campFields}&${range}&limit=500&access_token=${token}`
          )
          for (const r of campData) {
            const spend = Number(r.spend || 0)
            const resCount = resultados(r.actions)
            totalSpend += spend; totalResults += resCount
            campanhasContext.push({
              id: r.campaign_id, nome: r.campaign_name || r.campaign_id,
              gasto: spend, resultados: resCount,
              impressoes: Number(r.impressions || 0), cliques: Number(r.clicks || 0),
              ctr: Number(r.ctr || 0), cpc: Number(r.cpc || 0),
              leads: leadsPorCamp.get(r.campaign_id) ?? 0,
            })
          }
          campanhasContext.sort((a, b) => b.gasto - a.gasto)

          // Ads (anúncios individuais / criativos)
          const adFields = "ad_id,ad_name,campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,actions"
          const adData = await metaGetAll(
            `${BASE}/${contaId}/insights?level=ad&fields=${adFields}&${range}&limit=500&access_token=${token}`
          )
          for (const r of adData) {
            const spend = Number(r.spend || 0)
            const resCount = resultados(r.actions)
            adsContext.push({
              id: r.ad_id, nome: r.ad_name || r.ad_id,
              campanha_id: r.campaign_id, campanha_nome: r.campaign_name || "",
              gasto: spend, resultados: resCount,
              impressoes: Number(r.impressions || 0), cliques: Number(r.clicks || 0),
              ctr: Number(r.ctr || 0), cpc: Number(r.cpc || 0),
            })
          }
          adsContext.sort((a, b) => b.gasto - a.gasto)
          metaOk = true
        }
      } catch (e: any) {
        console.error("Meta API error:", e.message)
      }
    }

    if (!metaOk) {
      // Fallback: Supabase
      try {
        const [campRows, adRows, campanhas] = await Promise.all([
          supabase.from("meta_insights_campaign_daily").select("*")
            .gte("data", trintaDias).lte("data", hoje),
          supabase.from("meta_insights_ad_daily").select("*")
            .gte("data", trintaDias).lte("data", hoje),
          supabase.from("meta_campanhas").select("id, nome, status"),
        ])
        const campMap = new Map((campanhas.data ?? []).map((c: any) => [c.id, c]))

        const gastoPorCamp = new Map<string, { gasto: number; impressoes: number; cliques: number; conversas: number }>()
        for (const r of campRows.data ?? []) {
          const cur = gastoPorCamp.get(r.campanha_id) ?? { gasto: 0, impressoes: 0, cliques: 0, conversas: 0 }
          cur.gasto += Number(r.gasto ?? 0); cur.impressoes += Number(r.impressoes ?? 0)
          cur.cliques += Number(r.cliques ?? 0); cur.conversas += Number(r.mensagens_iniciadas ?? 0)
          gastoPorCamp.set(r.campanha_id, cur)
        }
        totalSpend = [...gastoPorCamp.values()].reduce((s, g) => s + g.gasto, 0)
        totalResults = [...gastoPorCamp.values()].reduce((s, g) => s + g.conversas, 0)
        campanhasContext = [...gastoPorCamp.entries()].map(([id, g]) => {
          const c = campMap.get(id)
          return { id, nome: c?.nome ?? id, gasto: g.gasto, resultados: g.conversas, impressoes: g.impressoes, cliques: g.cliques, ctr: g.impressoes ? (g.cliques / g.impressoes) * 100 : 0, cpc: g.cliques ? g.gasto / g.cliques : 0, leads: leadsPorCamp.get(id) ?? 0 }
        }).sort((a, b) => b.gasto - a.gasto)

        const gastoPorAd = new Map<string, { gasto: number; impressoes: number; cliques: number; conversas: number }>()
        for (const r of adRows.data ?? []) {
          const cur = gastoPorAd.get(r.ad_id) ?? { gasto: 0, impressoes: 0, cliques: 0, conversas: 0 }
          cur.gasto += Number(r.gasto ?? 0); cur.impressoes += Number(r.impressoes ?? 0)
          cur.cliques += Number(r.cliques ?? 0); cur.conversas += Number(r.mensagens_iniciadas ?? 0)
          gastoPorAd.set(r.ad_id, cur)
        }
        adsContext = [...gastoPorAd.entries()].map(([id, g]) => ({
          id, nome: id, campanha_id: "", campanha_nome: "",
          gasto: g.gasto, resultados: g.conversas, impressoes: g.impressoes, cliques: g.cliques,
          ctr: g.impressoes ? (g.cliques / g.impressoes) * 100 : 0, cpc: g.cliques ? g.gasto / g.cliques : 0,
        })).sort((a, b) => b.gasto - a.gasto)
      } catch (e: any) {
        console.error("Supabase error:", e.message)
      }
    }

    const cpl = totalLeads > 0 ? (totalSpend / totalLeads).toFixed(2) : "N/A"
    const fonte = metaOk ? "META ADS (API direta)" : "BANCO LOCAL"

    const campanhasStr = campanhasContext.map(c =>
      `- ${c.nome} | Gasto: R$ ${c.gasto.toFixed(2)} | Impressões: ${c.impressoes} | Cliques: ${c.cliques} | CTR: ${c.ctr.toFixed(2)}% | CPC: R$ ${c.cpc.toFixed(2)} | Resultados: ${c.resultados} | Leads CRM: ${c.leads}`
    ).join("\n")

    const adsStr = adsContext.slice(0, 20).map(a =>
      `- ${a.nome} | Campanha: ${a.campanha_nome} | Gasto: R$ ${a.gasto.toFixed(2)} | Resultados: ${a.resultados} | Impressões: ${a.impressoes} | Cliques: ${a.cliques} | CTR: ${a.ctr.toFixed(2)}% | CPC: R$ ${a.cpc.toFixed(2)}`
    ).join("\n")

    dadosContexto = `FONTE: ${fonte} (${trintaDias} a ${hoje})

RESUMO:
Gasto total: R$ ${totalSpend.toFixed(2)}
Resultados totais (leads+conversas): ${totalResults}
Leads no CRM: ${totalLeads}
CPL: R$ ${cpl}
Campanhas com gasto: ${campanhasContext.length}
Anúncios individuais com gasto: ${adsContext.length}

CAMPANHAS:
${campanhasStr || "(nenhuma com dados)"}

ANÚNCIOS (top 20 por gasto):
${adsStr || "(nenhum com dados)"}`

    // ---------- GEMINI ----------
    if (GEMINI_KEY) {
      if (GEMINI_KEY.length < 10) {
        console.error("GEMINI_API_KEY parece inválida (muito curta)")
      } else {
        try {
          const sistema = `Você é um analista de Meta Ads. Responda EM PORTUGUÊS BRASILEIRO. Seja direto — NÃO cumprimente, NÃO se apresente. Vá direto aos dados e recomendações. Mencione nomes e valores exatos. Não invente dados.`

          const gemBody = {
            contents: [
              { role: "user", parts: [{ text: `${sistema}\n\n${dadosContexto}` }] },
              { role: "model", parts: [{ text: "Entendido. Vou responder direto ao ponto com base nos dados." }] },
              ...history.map((m) => ({
                role: m.role === "assistant" ? "model" as const : "user" as const,
                parts: [{ text: m.content }],
              })),
              { role: "user", parts: [{ text: message }] },
            ],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
          }

          const gemRes = await fetch(`${GEMINI_URL}?key=${GEMINI_KEY}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(gemBody),
          })

          if (gemRes.ok) {
            const gemJson = await gemRes.json()
            const cand = gemJson?.candidates?.[0]
            const text = cand?.content?.parts?.[0]?.text || ""
            const reason = cand?.finishReason || ""
            if (reason === "SAFETY") {
              console.error("Gemini: bloqueado por segurança", JSON.stringify(cand?.safetyRatings))
            }
            if (text) {
              return NextResponse.json({ response: text + "\n\n— 🤖 Análise por IA Gemini" })
            }
            console.error("Gemini: resposta vazia, finishReason:", reason, JSON.stringify(gemJson).slice(0, 300))
          } else {
            const errText = await gemRes.text()
            console.error("Gemini HTTP error:", gemRes.status, errText.slice(0, 500))
          }
        } catch (e) {
          console.error("Gemini exception:", e)
        }
      }
    }

    // ---------- FALLBACK ----------
    const res = fallbackResposta(message, campanhasContext, adsContext, totalSpend, totalResults, totalLeads)
    const sufixo = GEMINI_KEY ? "\n\n— ⚠️ IA indisponível no momento, exibindo análise local" : "\n\n— ℹ️ Análise local (GEMINI_API_KEY não configurada)"
    return NextResponse.json({ response: res + sufixo })
  } catch (e: any) {
    return NextResponse.json({ response: `Erro ao processar: ${e.message}` }, { status: 500 })
  }
}

function fallbackResposta(
  message: string,
  campanhas: CampanhaData[],
  ads: AdData[],
  totalSpend: number,
  totalResults: number,
  totalLeads: number,
) {
  const msg = message.toLowerCase()
  const lines: string[] = []
  const ativas = campanhas.filter(c => c.gasto > 0)
  const cpl = totalLeads > 0 ? totalSpend / totalLeads : 0

  // "criativos" ou "anúncios" → nível de anúncio individual
  if (msg.includes("criativo") || (msg.includes("anúncio") && !msg.includes("anúncios"))) {
    const topAds = ads.filter(a => a.resultados > 0).sort((a, b) => b.resultados - a.resultados).slice(0, 5)
    if (topAds.length > 0) {
      lines.push("📊 *Melhores anúncios/criativos por resultado:*")
      topAds.forEach((a, i) => {
        const info = a.campanha_nome ? ` (campanha: ${a.campanha_nome})` : ""
        lines.push(`${i + 1}. ${a.nome}${info}: ${a.resultados} resultados, R$ ${a.gasto.toFixed(2)} gastos`)
      })
      const semRes = ads.filter(a => a.gasto > 0 && a.resultados === 0)
      if (semRes.length > 0) {
        lines.push("")
        lines.push(`⚠️ ${semRes.length} anúncio(s) tiveram gasto sem resultado.`)
      }
    } else if (ads.filter(a => a.gasto > 0).length > 0) {
      lines.push("📊 Anúncios com gasto mas nenhum resultado registrado no período.")
      const topGasto = [...ads].filter(a => a.gasto > 0).sort((a, b) => b.gasto - a.gasto).slice(0, 5)
      lines.push("*Maiores gastos:*")
      topGasto.forEach((a, i) => lines.push(`${i + 1}. ${a.nome}: R$ ${a.gasto.toFixed(2)} (${a.impressoes} imp, ${a.cliques} cliques)`))
    } else {
      lines.push("Nenhum dado de anúncio individual encontrado.")
    }
    return lines.join("\n")
  }

  // "melhores", "top", "destaque" (sem "criativo") → campanhas
  if (msg.includes("melhor") || msg.includes("top") || msg.includes("destaque") || msg.includes("bom")) {
    const top = [...campanhas].filter(c => c.resultados > 0).sort((a, b) => b.resultados - a.resultados).slice(0, 5)
    if (top.length > 0) {
      lines.push("📊 *Melhores campanhas por resultado:*")
      top.forEach((c, i) => lines.push(`${i + 1}. ${c.nome}: ${c.resultados} resultados, R$ ${c.gasto.toFixed(2)} (CPA: R$ ${(c.gasto / c.resultados).toFixed(2)})`))
      const semResult = ativas.filter(a => a.resultados === 0)
      if (semResult.length > 0) lines.push(`\n⚠️ ${semResult.length} campanha(s) gastaram sem resultado: ${semResult.slice(0, 3).map(s => s.nome).join(", ")}`)
    } else {
      lines.push(totalSpend > 0
        ? `📊 R$ ${totalSpend.toFixed(2)} gastos em ${ativas.length} campanhas sem resultados registrados.`
        : "Nenhum dado de campanha encontrado.")
    }
    return lines.join("\n")
  }

  if (msg.includes("pior") || msg.includes("ruim") || msg.includes("problema")) {
    const ruins = ativas.filter(c => c.resultados === 0).slice(0, 3)
    if (ruins.length > 0) {
      lines.push("⚠️ *Campanhas com gasto sem resultado:*")
      ruins.forEach(c => lines.push(`• ${c.nome}: R$ ${c.gasto.toFixed(2)} gastos, 0 resultados. ${c.cliques > 0 ? `${c.cliques} cliques sem conversão.` : "Sem cliques — revisar."}`))
    } else if (ativas.length > 0) {
      lines.push("✅ Todas as campanhas ativas tiveram resultado.")
      const caras = [...ativas].sort((a, b) => b.cpc - a.cpc).slice(0, 2)
      if (caras.length > 0) lines.push(`🔍 Maior CPC: ${caras.map(c => `${c.nome} (R$ ${c.cpc.toFixed(2)})`).join(", ")}`)
    } else {
      lines.push("Nenhuma campanha com gasto.")
    }
    return lines.join("\n")
  }

  if (msg.includes("lead") || msg.includes("cpl") || msg.includes("custo")) {
    if (totalLeads > 0) {
      lines.push(`👥 *Leads no CRM:* ${totalLeads}`)
      lines.push(`💰 *CPL médio:* R$ ${cpl.toFixed(2)}`)
      lines.push(`📈 *Gasto total:* R$ ${totalSpend.toFixed(2)}`)
      const topLeads = [...campanhas].filter(c => c.leads > 0).sort((a, b) => b.leads - a.leads).slice(0, 3)
      if (topLeads.length > 0) {
        lines.push("")
        lines.push("*Campanhas que mais geraram leads:*")
        topLeads.forEach(c => lines.push(`• ${c.nome}: ${c.leads} leads`))
      }
    } else {
      lines.push("Nenhum lead de Tráfego Pago no CRM no período.")
    }
    return lines.join("\n")
  }

  if (msg.includes("geral") || msg.includes("resumo") || msg.includes("visão") || msg.includes("ontem") || msg.includes("hoje") || msg.includes("desempenho")) {
    lines.push(`📈 *Resumo geral dos anúncios:*`)
    lines.push(`• Gasto total: R$ ${totalSpend.toFixed(2)}`)
    lines.push(`• Campanhas ativas: ${ativas.length}`)
    lines.push(`• Resultados totais: ${totalResults}`)
    lines.push(`• Leads no CRM: ${totalLeads}`)
    if (totalLeads > 0) lines.push(`• CPL médio: R$ ${cpl.toFixed(2)}`)
    if (ativas.length > 0) {
      const top = ativas.sort((a, b) => b.gasto - a.gasto)[0]
      lines.push(`• Maior investimento: ${top.nome} (R$ ${top.gasto.toFixed(2)})`)
      const topR = [...ativas].filter(c => c.resultados > 0).sort((a, b) => b.resultados - a.resultados)
      if (topR.length > 0) lines.push(`• Melhor resultado: ${topR[0].nome} (${topR[0].resultados} resultados)`)
    }
    return lines.join("\n")
  }

  lines.push(`📊 *Análise dos seus anúncios Meta Ads*`)
  if (totalSpend > 0) {
    lines.push(`Nos últimos 30 dias, foram investidos R$ ${totalSpend.toFixed(2)} em ${ativas.length} campanhas (${ads.filter(a => a.gasto > 0).length} anúncios).`)
    if (totalResults > 0) lines.push(`${totalResults} resultados gerados.`)
    if (totalLeads > 0) lines.push(`${totalLeads} leads no CRM, CPL de R$ ${cpl.toFixed(2)}.`)
  } else {
    lines.push("Nenhum dado de performance no período.")
  }
  lines.push("")
  lines.push("💡 *Perguntas que posso responder:*")
  lines.push('• "Quais os melhores criativos?"')
  lines.push('• "Quais os melhores anúncios?"')
  lines.push('• "Resumo geral do desempenho"')
  lines.push('• "Quanto gastei e quantos leads tive?"')
  return lines.join("\n")
}
