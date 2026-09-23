// Mock estruturalmente idêntico ao formato da Meta Graph API (Marketing API).
// Usado quando não há token conectado, para desenvolver a UI e depois plugar a conexão real.

function seed(str: string) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822519); h = Math.imul(h ^ (h >>> 13), 3266489917); return ((h ^= h >>> 16) >>> 0) / 4294967296 }
}

export const MOCK_ACCOUNTS = {
  data: [
    { id: "act_1000000001", name: "Conta Principal", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
    { id: "act_1000000002", name: "Conta Lançamentos", currency: "BRL", timezone_name: "America/Sao_Paulo", account_status: 1 },
  ],
}

const CAMP_DEFS = [
  { id: "120210001", name: "LEADS | Apartamentos Centro | Jul/26", objective: "OUTCOME_LEADS", effective_status: "ACTIVE", daily_budget: "15000", start_time: "2026-06-01T00:00:00-0300" },
  { id: "120210002", name: "MSG | Casas Cond. Fechado | WhatsApp", objective: "OUTCOME_ENGAGEMENT", effective_status: "ACTIVE", daily_budget: "10000", start_time: "2026-06-15T00:00:00-0300" },
  { id: "120210003", name: "LEADS | Lançamento Vista Park", objective: "OUTCOME_LEADS", effective_status: "PAUSED", daily_budget: "20000", start_time: "2026-05-10T00:00:00-0300", stop_time: "2026-07-10T00:00:00-0300" },
  { id: "120210004", name: "TRÁFEGO | Portal de Imóveis | Remarketing", objective: "OUTCOME_TRAFFIC", effective_status: "ARCHIVED", daily_budget: "5000", start_time: "2026-04-01T00:00:00-0300" },
]

export function mockCampaigns(_account: string) {
  return { data: CAMP_DEFS }
}

export function mockAdsets(campaignId: string) {
  const defs = [
    { suf: "01", name: "Adv+ | 25-55 | Região Central", opt: "LEAD_GENERATION" },
    { suf: "02", name: "Interesses | Imóveis + Financiamento", opt: "LEAD_GENERATION" },
    { suf: "03", name: "Lookalike 1% compradores", opt: "OFFSITE_CONVERSIONS" },
  ]
  const r = seed(campaignId)
  const n = 2 + Math.floor(r() * 2)
  return {
    data: defs.slice(0, n).map((d, i) => ({
      id: `${campaignId}${d.suf}`,
      name: d.name,
      effective_status: i === 2 ? "PAUSED" : "ACTIVE",
      campaign_id: campaignId,
      optimization_goal: d.opt,
      daily_budget: String(4000 + Math.floor(r() * 6) * 1000),
      targeting: { geo_locations: { cities: [{ name: "São Paulo" }] }, age_min: 25, age_max: 55 },
    })),
  }
}

export function mockAds(adsetId: string) {
  const nomes = ["Carrossel Fotos | 3 dorms", "Vídeo Tour Virtual", "Imagem única | CTA WhatsApp"]
  const r = seed(adsetId)
  const n = 2 + Math.floor(r() * 2)
  return {
    data: nomes.slice(0, n).map((nm, i) => ({
      id: `${adsetId}${i + 1}`,
      name: nm,
      effective_status: i === 2 ? "PAUSED" : "ACTIVE",
      adset_id: adsetId,
      creative: { id: `cr_${adsetId}${i + 1}` },
    })),
  }
}

export function mockCreative(creativeId: string) {
  const r = seed(creativeId)
  const formatos = ["IMAGE", "VIDEO", "CAROUSEL"] as const
  const f = formatos[Math.floor(r() * 3)]
  return {
    id: creativeId,
    title: "Seu novo apartamento no Centro",
    body: "Unidades de 2 e 3 dormitórios com varanda gourmet. Agende sua visita e conheça o decorado!",
    object_type: f,
    call_to_action_type: r() > 0.5 ? "LEARN_MORE" : "WHATSAPP_MESSAGE",
    image_url: `/generic-property-ad.png`,
    link_description: "Imobiliária — CRECI 12345",
  }
}

// Insights diários determinísticos por nó (campanha/conjunto/anúncio/conta)
export function mockInsights(nodeId: string, since: string, until: string, daily: boolean, level?: string, children?: string[]) {
  const dias: string[] = []
  const d0 = new Date(since + "T12:00:00Z"), d1 = new Date(until + "T12:00:00Z")
  for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) dias.push(d.toISOString().slice(0, 10))

  const nodos = children?.length ? children : [nodeId]
  const rows: any[] = []
  for (const nid of nodos) {
    const r = seed(nid + since)
    let acc = { spend: 0, imp: 0, clk: 0, reach: 0, leads: 0 }
    const porDia = dias.map((data) => {
      const spend = 60 + r() * 240
      const imp = Math.floor(spend * (80 + r() * 60))
      const clk = Math.floor(imp * (0.008 + r() * 0.02))
      const reach = Math.floor(imp * (0.55 + r() * 0.25))
      const leads = Math.max(0, Math.floor(clk * (0.05 + r() * 0.12)))
      acc = { spend: acc.spend + spend, imp: acc.imp + imp, clk: acc.clk + clk, reach: acc.reach + reach, leads: acc.leads + leads }
      return { data, spend, imp, clk, reach, leads }
    })
    const fonte = daily ? porDia : [{ data: since, ...acc, spend: acc.spend, imp: acc.imp, clk: acc.clk, reach: acc.reach, leads: acc.leads }]
    for (const p of fonte) {
      const spend = daily ? (p as any).spend : acc.spend
      const imp = daily ? (p as any).imp : acc.imp
      const clk = daily ? (p as any).clk : acc.clk
      const reach = daily ? (p as any).reach : acc.reach
      const leads = daily ? (p as any).leads : acc.leads
      rows.push({
        ...(level === "campaign" ? { campaign_id: nid } : level === "adset" ? { adset_id: nid } : level === "ad" ? { ad_id: nid } : {}),
        date_start: (p as any).data, date_stop: daily ? (p as any).data : until,
        spend: spend.toFixed(2),
        impressions: String(imp),
        clicks: String(clk),
        ctr: imp ? ((clk / imp) * 100).toFixed(4) : "0",
        cpc: clk ? (spend / clk).toFixed(4) : "0",
        cpm: imp ? ((spend / imp) * 1000).toFixed(4) : "0",
        reach: String(reach),
        frequency: reach ? (imp / reach).toFixed(4) : "0",
        actions: [{ action_type: "lead", value: String(leads) }],
        cost_per_action_type: leads ? [{ action_type: "lead", value: (spend / leads).toFixed(4) }] : [],
      })
      if (!daily) break
    }
  }
  return { data: rows }
}
