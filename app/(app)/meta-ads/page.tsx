"use client"

// Meta Ads — visão gerencial (somente gestores, read-only).
// Drill-down: Conta > Campanha > Conjunto > Anúncio > Criativo, com KPIs comparativos,
// gráficos, tabela detalhada e cruzamento com leads reais do CRM.

import { useMemo, useState } from "react"
import useSWR from "swr"
import {
  CircleDollarSign, Eye, MousePointerClick, Percent, Coins, BarChart3, Users, Target,
  ChevronRight, Link2, TriangleAlert, ArrowUpRight, ArrowDownRight, Plug, RefreshCw, CalendarRange, Sparkles,
  Wallet, SlidersHorizontal, TrendingUp,
} from "lucide-react"
import {
  ResponsiveContainer, LineChart, Line, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend,
} from "recharts"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeVendas } from "@/lib/roles"
import { useLeads } from "@/lib/leads-store"
import { Badge, Card, CardContent, CardHeader, CardTitle, Select, Skeleton, Input, Dialog, Label } from "@/components/ui/primitives"
import { brl } from "@/lib/labels"
import { cn } from "@/lib/utils"
import MetaAiChat from "@/components/meta-ai-chat"

// ---------- helpers ----------
const fetcher = (u: string) => fetch(u).then(async (r) => {
  const j = await r.json()
  if (!r.ok) throw Object.assign(new Error(j.error || "Erro"), { expired: j.expired })
  return j
})

const fmt = (n: number, d = 0) => n.toLocaleString("pt-BR", { maximumFractionDigits: d, minimumFractionDigits: d })
const iso = (d: Date) => d.toISOString().slice(0, 10)
const brl2 = (v?: number) => v == null ? "—" : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 })

type Nivel = "account" | "campaign" | "adset" | "ad"
const FILHO: Record<Nivel, Nivel | null> = { account: "campaign", campaign: "adset", adset: "ad", ad: null }
const NIVEL_LABEL: Record<Nivel, string> = { account: "Conta", campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" }

const STATUS_PT: Record<string, { label: string; variant: string }> = {
  ACTIVE: { label: "Ativo", variant: "green" },
  PAUSED: { label: "Pausado", variant: "amber" },
  ARCHIVED: { label: "Arquivado", variant: "gray" },
  DELETED: { label: "Removido", variant: "red" },
  CAMPAIGN_PAUSED: { label: "Campanha pausada", variant: "amber" },
  ADSET_PAUSED: { label: "Conjunto pausado", variant: "amber" },
}
function StatusBadge({ s }: { s?: string | null }) {
  const m = STATUS_PT[(s || "").toUpperCase()] ?? { label: s || "—", variant: "gray" }
  return <Badge variant={m.variant as any}>{m.label}</Badge>
}

// Extrai "resultados" (leads/conversas) do array actions do Insights
function resultados(row: any): number {
  const acts: any[] = row?.actions || []
  return acts
    .filter((a) => a.action_type === "lead" || a.action_type.includes("messaging_conversation_started"))
    .reduce((s, a) => s + Number(a.value || 0), 0)
}
function agrega(rows: any[]) {
  const t = { spend: 0, impressions: 0, clicks: 0, reach: 0, results: 0 }
  for (const r of rows) {
    t.spend += Number(r.spend || 0)
    t.impressions += Number(r.impressions || 0)
    t.clicks += Number(r.clicks || 0)
    t.reach += Number(r.reach || 0)
    t.results += resultados(r)
  }
  return {
    ...t,
    ctr: t.impressions ? (t.clicks / t.impressions) * 100 : 0,
    cpc: t.clicks ? t.spend / t.clicks : 0,
    cpm: t.impressions ? (t.spend / t.impressions) * 1000 : 0,
    freq: t.reach ? t.impressions / t.reach : 0,
    cpr: t.results ? t.spend / t.results : 0,
  }
}

// ---------- períodos ----------
const PRESETS = [
  { id: "hoje", label: "Hoje" },
  { id: "7d", label: "Últimos 7 dias" },
  { id: "30d", label: "Últimos 30 dias" },
  { id: "mes", label: "Este mês" },
  { id: "custom", label: "Personalizado" },
] as const

function rangeFor(preset: string, cSince: string, cUntil: string): { since: string; until: string } {
  const hoje = new Date()
  if (preset === "hoje") return { since: iso(hoje), until: iso(hoje) }
  if (preset === "7d") return { since: iso(new Date(Date.now() - 6 * 864e5)), until: iso(hoje) }
  if (preset === "mes") return { since: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), until: iso(hoje) }
  if (preset === "custom" && cSince && cUntil) return { since: cSince, until: cUntil }
  return { since: iso(new Date(Date.now() - 29 * 864e5)), until: iso(hoje) }
}
// Período anterior de mesma duração (para variação percentual)
function periodoAnterior(since: string, until: string) {
  const d0 = new Date(since + "T12:00:00Z"), d1 = new Date(until + "T12:00:00Z")
  const dias = Math.round((d1.getTime() - d0.getTime()) / 864e5) + 1
  return { since: iso(new Date(d0.getTime() - dias * 864e5)), until: iso(new Date(d0.getTime() - 864e5)) }
}

// ---------- página ----------
export default function MetaAdsPage() {
  const { user } = useAuth()
  if (user && (!isGestorNivel(user.role) || !podeVendas(user.role))) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">Acesso restrito a gestores.</CardContent>
      </Card>
    )
  }
  return <MetaAdsDashboard />
}

function MetaAdsDashboard() {
  const { leads, userName } = useLeads()
  const [preset, setPreset] = useState("30d")
  const [cSince, setCSince] = useState(iso(new Date(Date.now() - 29 * 864e5)))
  const [cUntil, setCUntil] = useState(iso(new Date()))
  const [comparar, setComparar] = useState(true)
  const [compacto, setCompacto] = useState(false)
  // trilha do drill-down: [{nivel, id, nome, creativeId?}]
  const [trilha, setTrilha] = useState<{ nivel: Nivel; id: string; nome: string; creativeId?: string; status?: string }[]>([])

  const { since, until } = rangeFor(preset, cSince, cUntil)
  const prev = periodoAnterior(since, until)

  const { data: status } = useSWR("/api/meta?op=status", fetcher, { refreshInterval: 120_000 })
  const { data: contas, error: errContas } = useSWR("/api/meta?op=accounts", fetcher)
  const [contaId, setContaId] = useState("")
  const conta = useMemo(() => {
    const list = contas?.data ?? []
    return list.find((c: any) => c.id === contaId) ?? list[0]
  }, [contas, contaId])

  // Nó selecionado (último da trilha, ou a conta)
  const selecionado = trilha[trilha.length - 1] ?? (conta ? { nivel: "account" as Nivel, id: conta.id, nome: conta.name } : null)
  const nivelFilho = selecionado ? FILHO[selecionado.nivel] : null

  // ---- dados do nível filho (lista de linhas da tabela / drill) ----
  const filhosKey = selecionado && nivelFilho
    ? nivelFilho === "campaign"
      ? `/api/meta?op=campaigns&account=${selecionado.id}`
      : nivelFilho === "adset"
        ? `/api/meta?op=adsets&campaign=${selecionado.id}`
        : `/api/meta?op=ads&adset=${selecionado.id}`
    : null
  const { data: filhos, error: errFilhos, isLoading: loadFilhos } = useSWR(filhosKey, fetcher)

  // ---- insights agregados do nó selecionado (KPIs) + período anterior ----
  const insKey = selecionado ? `/api/meta?op=insights&node=${selecionado.id}&since=${since}&until=${until}` : null
  const { data: insAtual, error: errIns, isLoading: loadIns } = useSWR(insKey, fetcher)
  const { data: insPrev } = useSWR(comparar && selecionado ? `/api/meta?op=insights&node=${selecionado.id}&since=${prev.since}&until=${prev.until}` : null, fetcher)

  // ---- série diária (gráfico de linha) ----
  const { data: insDiario } = useSWR(selecionado ? `/api/meta?op=insights&node=${selecionado.id}&since=${since}&until=${until}&daily=1` : null, fetcher)

  // ---- insights por filho (gráfico de barras + tabela) ----
  const { data: insFilhos } = useSWR(
    selecionado && nivelFilho ? `/api/meta?op=insights&node=${selecionado.id}&level=${nivelFilho}&since=${since}&until=${until}` : null,
    fetcher,
  )

  const kpi = useMemo(() => agrega(insAtual?.data ?? []), [insAtual])
  const kpiPrev = useMemo(() => agrega(insPrev?.data ?? []), [insPrev])

  const serie = useMemo(() => {
    const porDia = new Map<string, { gasto: number; resultados: number }>()
    for (const r of insDiario?.data ?? []) {
      const cur = porDia.get(r.date_start) ?? { gasto: 0, resultados: 0 }
      cur.gasto += Number(r.spend || 0)
      cur.resultados += resultados(r)
      porDia.set(r.date_start, cur)
    }
    return [...porDia.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({
      dia: d.slice(5).split("-").reverse().join("/"), gasto: Number(v.gasto.toFixed(2)), resultados: v.resultados,
    }))
  }, [insDiario])

  // Mapa de insights por id do filho
  const insPorFilho = useMemo(() => {
    const m = new Map<string, any>()
    const keyField = nivelFilho === "campaign" ? "campaign_id" : nivelFilho === "adset" ? "adset_id" : "ad_id"
    for (const r of insFilhos?.data ?? []) m.set(r[keyField], r)
    return m
  }, [insFilhos, nivelFilho])

  // ---- cruzamento CRM: leads reais por campanha ----
  const leadsPorCampanha = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads) {
      if (l.origem === "Tráfego Pago" && l.metaCampaignId) m.set(l.metaCampaignId, (m.get(l.metaCampaignId) ?? 0) + 1)
    }
    return m
  }, [leads])

  const barras = useMemo(
    () =>
      (filhos?.data ?? []).map((f: any) => {
        const i = insPorFilho.get(f.id)
        return { nome: f.name.length > 22 ? f.name.slice(0, 22) + "…" : f.name, gasto: Number(Number(i?.spend ?? 0).toFixed(2)), resultados: i ? resultados(i) : 0 }
      }).filter((b: any) => b.gasto > 0 || b.resultados > 0),
    [filhos, insPorFilho],
  )

  const tokenExpirado = errIns?.expired || errFilhos?.expired || errContas?.expired
  const modoMock = status?.source === "mock"

  function drill(nivel: Nivel, id: string, nome: string, extra?: { creativeId?: string; status?: string }) {
    setTrilha((t) => [...t, { nivel, id, nome, ...extra }])
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Cabeçalho */}
        <header className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6">
          <div className="relative z-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                <Sparkles className="size-3.5" /> Gestão de tráfego
              </span>
            <h1 className="mt-2.5 font-display text-2xl font-bold tracking-tight sm:text-3xl">
              <span className="text-foreground">Meta Ads</span>
            </h1>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground text-pretty">
              Performance das campanhas com dados da Meta Graph API e leads reais do CRM.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status && (
              <Badge variant={status.connected ? "green" : "amber"} className="gap-1.5 px-3 py-1.5 shadow-sm">
                <span className="relative flex size-2">
                  <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-70", status.connected ? "bg-emerald-400" : "bg-amber-400")} />
                  <span className={cn("relative inline-flex size-2 rounded-full", status.connected ? "bg-emerald-500" : "bg-amber-500")} />
                </span>
                <Plug className="size-3" />
                {status.connected ? (status.source === "env" ? "Conectado (token)" : "Conectado") : "Modo demonstração"}
              </Badge>
            )}
            {!status?.connected && (
              <a href="/api/meta/oauth/start" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90">
                <Link2 className="size-4" /> Conectar Meta Business
              </a>
            )}
          </div>
        </div>
      </header>

      {/* Avisos */}
      {status?.warnExpiring && (
        <Aviso texto="O token da conta Meta expira em menos de 7 dias. Reconecte para evitar interrupção." acao="Reconectar" />
      )}
      {tokenExpirado && (
        <Aviso texto="Token expirado. Reconecte sua conta Meta Business para continuar vendo os dados." acao="Reconectar" erro />
      )}
      {modoMock && (
        <p className="rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground">
          Exibindo dados de demonstração no formato real da Graph API. Conecte a conta Meta Business (ou defina META_ACCESS_TOKEN) para ver dados reais.
        </p>
      )}

      {/* Verba mensal / teto de gastos */}
      <OrcamentoPanel />

      {/* Conta + período */}
      <Card className="rounded-2xl">
        <CardContent className="grid gap-4 p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="meta-conta">Conta de anúncios</label>
            <Select id="meta-conta" value={conta?.id ?? ""} onChange={(e) => { setContaId(e.target.value); setTrilha([]) }} aria-label="Conta de anúncios">
              {(contas?.data ?? []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name} · {c.currency}</option>
              ))}
              {!contas && <option>Carregando…</option>}
            </Select>
            {conta && (
              <span className="text-xs text-muted-foreground">
                {conta.timezone_name} · {conta.account_status === 1 ? "Conta ativa" : "Conta inativa"}
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="meta-periodo">
              <CalendarRange className="size-3.5" /> Período
            </label>
            <Select id="meta-periodo" value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Período">
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </Select>
          </div>
          {preset === "custom" ? (
            <>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="meta-de">De</label>
                <Input id="meta-de" type="date" value={cSince} onChange={(e) => setCSince(e.target.value)} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="meta-ate">Até</label>
                <Input id="meta-ate" type="date" value={cUntil} onChange={(e) => setCUntil(e.target.value)} />
              </div>
            </>
          ) : (
            <div className="flex items-end md:col-span-1 xl:col-span-2">
              <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground transition hover:bg-muted/60">
                <input type="checkbox" checked={comparar} onChange={(e) => setComparar(e.target.checked)} className="size-4 accent-primary" />
                Comparar com período anterior
                <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border tabular-nums">
                  {prev.since.split("-").reverse().join("/")} – {prev.until.split("-").reverse().join("/")}
                </span>
              </label>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Breadcrumb do drill-down */}
      <nav aria-label="Navegação da hierarquia" className="flex flex-wrap items-center gap-1.5 text-sm">
        <button
          type="button"
          className="rounded-lg px-2 py-1 font-medium text-primary transition hover:bg-primary/10"
          onClick={() => setTrilha([])}
        >
          {conta?.name ?? "Conta"}
        </button>
        {trilha.map((t, i) => (
          <span key={t.id} className="flex items-center gap-1.5">
            <ChevronRight className="size-4 text-muted-foreground/50" />
            <button
              type="button"
              className={cn(
                "rounded-lg px-2 py-1 font-medium transition",
                i === trilha.length - 1
                  ? "bg-card text-foreground ring-1 ring-border shadow-sm"
                  : "text-primary hover:bg-primary/10",
              )}
              onClick={() => setTrilha((arr) => arr.slice(0, i + 1))}
            >
              <span className="mr-1 text-xs font-normal text-muted-foreground">{NIVEL_LABEL[t.nivel]}:</span>{t.nome}
            </button>
          </span>
        ))}
      </nav>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {loadIns ? (
          Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-28 rounded-2xl" />)
        ) : (
          <>
            <Kpi icon={CircleDollarSign} label="Gasto total" value={brl(kpi.spend)} prev={comparar ? kpiPrev.spend : undefined} cur={kpi.spend} invert />
            <Kpi icon={Eye} label="Impressões" value={fmt(kpi.impressions)} prev={comparar ? kpiPrev.impressions : undefined} cur={kpi.impressions} />
            <Kpi icon={MousePointerClick} label="Cliques" value={fmt(kpi.clicks)} prev={comparar ? kpiPrev.clicks : undefined} cur={kpi.clicks} />
            <Kpi icon={Percent} label="CTR" value={`${fmt(kpi.ctr, 2)}%`} prev={comparar ? kpiPrev.ctr : undefined} cur={kpi.ctr} />
            <Kpi icon={Coins} label="CPC" value={brl(kpi.cpc)} prev={comparar ? kpiPrev.cpc : undefined} cur={kpi.cpc} invert />
            <Kpi icon={BarChart3} label="CPM" value={brl(kpi.cpm)} prev={comparar ? kpiPrev.cpm : undefined} cur={kpi.cpm} invert />
            <Kpi icon={Users} label="Resultados (leads)" value={fmt(kpi.results)} prev={comparar ? kpiPrev.results : undefined} cur={kpi.results} accent />
            <Kpi icon={Target} label="Custo por resultado" value={kpi.results ? brl(kpi.cpr) : "—"} prev={comparar ? kpiPrev.cpr : undefined} cur={kpi.cpr} invert />
          </>
        )}
      </div>

      {/* IA Chat flutuante */}
      <MetaAiChat />

      {/* Gráficos */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle>Evolução diária — gasto × resultados</CardTitle>
          </CardHeader>
          <CardContent>
            {!insDiario ? <Skeleton className="h-64 rounded-xl" /> : serie.length === 0 ? (
              <Vazio texto="Sem dados no período selecionado." />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={serie} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gradGasto" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#b22222" stopOpacity={0.32} />
                        <stop offset="100%" stopColor="#b22222" stopOpacity={0} />
                      </linearGradient>
                      <filter id="glowGastoL" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glowResultL" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="g" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={54} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={34} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ stroke: "var(--color-border)" }} />
                    <Legend formatter={(v) => <span className="text-xs font-medium text-muted-foreground">{v}</span>} />
                    <Area yAxisId="g" type="monotone" dataKey="gasto" name="Gasto (R$)" stroke="#b22222" strokeWidth={2.5} fill="url(#gradGasto)" dot={false} activeDot={{ r: 5, fill: "#b22222", strokeWidth: 2, stroke: "#fff" }} />
                    <Line yAxisId="g" type="monotone" dataKey="gasto" name="GastoGlow" stroke="#b22222" strokeWidth={7} strokeOpacity={0.22} dot={false} filter="url(#glowGastoL)" legendType="none" tooltipType="none" />
                    <Line yAxisId="r" type="monotone" dataKey="resultados" name="Resultados" stroke="#64748b" strokeWidth={2.5} dot={false} activeDot={{ r: 5, fill: "#64748b", strokeWidth: 2, stroke: "#fff" }} />
                    <Line yAxisId="r" type="monotone" dataKey="resultados" name="ResultadosGlow" stroke="#64748b" strokeWidth={7} strokeOpacity={0.18} dot={false} filter="url(#glowResultL)" legendType="none" tooltipType="none" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle>Comparação entre {nivelFilho ? NIVEL_LABEL[nivelFilho].toLowerCase() + "s" : "itens"}</CardTitle></CardHeader>
          <CardContent>
            {!insFilhos && nivelFilho ? <Skeleton className="h-64 rounded-xl" /> : barras.length === 0 ? (
              <Vazio texto={nivelFilho ? "Nenhum item com dados no período." : "Nível de anúncio não possui subitens."} />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barras} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
                    <defs>
                      <linearGradient id="gradBar" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#c41e24" />
                        <stop offset="100%" stopColor="#b22222" />
                      </linearGradient>
                      <filter id="glowBar" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2.5" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                      <filter id="glowResultB" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="2" result="blur" />
                        <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                      </filter>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                    <XAxis dataKey="nome" tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }} interval={0} angle={-12} height={48} tickLine={false} axisLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }} width={54} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
                    <Legend formatter={(v) => <span className="text-xs font-medium text-muted-foreground">{v}</span>} />
                    <Bar dataKey="gasto" name="Gasto (R$)" fill="url(#gradBar)" radius={[6, 6, 0, 0]} filter="url(#glowBar)" />
                    <Bar dataKey="resultados" name="Resultados" fill="#64748b" radius={[6, 6, 0, 0]} filter="url(#glowResultB)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabela detalhada / drill-down */}
      {nivelFilho ? (
        <Card className="rounded-2xl">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{NIVEL_LABEL[nivelFilho]}s {selecionado && selecionado.nivel !== "account" ? `de "${selecionado.nome}"` : ""}</CardTitle>
            <button
              type="button"
              onClick={() => setCompacto((v) => !v)}
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
            >
              {compacto ? "Ver todas as colunas" : "Ver menos colunas"}
            </button>
          </CardHeader>
          <CardContent>
            {loadFilhos ? (
              <Skeleton className="h-48 rounded-xl" />
            ) : (filhos?.data ?? []).length === 0 ? (
              <Vazio texto="Nenhuma campanha encontrada no período selecionado." />
            ) : (
              // Scroll horizontal isolado: só a tabela rola, com fade na borda direita
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-8 bg-gradient-to-l from-card to-transparent" aria-hidden="true" />
                <div className="max-h-[32rem] overflow-auto overscroll-x-contain rounded-xl border border-border">
                  <table className="w-full text-xs sm:text-sm">
                    <thead className="sticky top-0 z-10 bg-card">
                      <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="sticky left-0 z-20 min-w-52 max-w-64 bg-card py-2.5 pl-4 pr-3 font-semibold">Nome</th>
                        <th className="min-w-24 py-2.5 pr-3 font-semibold">Status</th>
                        {!compacto && nivelFilho === "campaign" && <th className="min-w-28 py-2.5 pr-3 font-semibold">Objetivo</th>}
                        {/* Bloco Orçamento/Gasto */}
                        {!compacto && <th className="min-w-[110px] border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">Orçamento/dia</th>}
                        <th className={cn("min-w-[100px] py-2.5 pr-3 text-right font-semibold", compacto && "border-l border-border/60 pl-3")}>Gasto</th>
                        {/* Bloco Tráfego */}
                        {!compacto && <th className="min-w-[90px] border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">Impr.</th>}
                        <th className={cn("min-w-[90px] py-2.5 pr-3 text-right font-semibold", compacto && "border-l border-border/60 pl-3")}>Cliques</th>
                        <th className="min-w-[80px] py-2.5 pr-3 text-right font-semibold">CTR</th>
                        {!compacto && <th className="min-w-[90px] py-2.5 pr-3 text-right font-semibold">CPC</th>}
                        {!compacto && <th className="min-w-[90px] py-2.5 pr-3 text-right font-semibold">CPM</th>}
                        {/* Bloco Alcance */}
                        {!compacto && <th className="min-w-[95px] border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">Alcance</th>}
                        {!compacto && <th className="min-w-[80px] py-2.5 pr-3 text-right font-semibold">Freq.</th>}
                        {/* Bloco Resultados */}
                        <th className="min-w-[90px] border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">Result.</th>
                        <th className="min-w-[110px] py-2.5 pr-3 text-right font-semibold">Custo/Result.</th>
                        {/* Bloco CRM */}
                        {nivelFilho === "campaign" && <th className="min-w-[95px] border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">Leads CRM</th>}
                        {nivelFilho === "campaign" && <th className="min-w-[95px] py-2.5 pr-4 text-right font-semibold">CPL real</th>}
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {(filhos?.data ?? []).map((f: any) => {
                        const i = insPorFilho.get(f.id)
                        const res = i ? resultados(i) : 0
                        const spend = Number(i?.spend ?? 0)
                        const crmLeads = nivelFilho === "campaign" ? (leadsPorCampanha.get(f.id) ?? 0) : 0
                        return (
                          <tr key={f.id} className="group border-b border-border/60 transition-colors hover:bg-primary/[0.03]">
                            {/* Nome fixo à esquerda com fundo sólido */}
                            <td className="sticky left-0 z-10 min-w-52 max-w-64 bg-card py-2.5 pl-4 pr-3 group-hover:bg-primary/[0.03]">
                              <button
                                type="button"
                                title={f.name}
                                className="block w-full truncate text-left font-medium text-primary transition hover:text-primary/80 hover:underline"
                                onClick={() => drill(nivelFilho, f.id, f.name, { creativeId: f.creative?.id, status: f.effective_status })}
                              >
                                {f.name}
                              </button>
                              {nivelFilho === "campaign" && f.start_time && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {f.start_time.slice(0, 10).split("-").reverse().join("/")}{f.stop_time ? ` – ${f.stop_time.slice(0, 10).split("-").reverse().join("/")}` : ""}
                                </p>
                              )}
                            </td>
                            <td className="py-2.5 pr-3"><StatusBadge s={f.effective_status} /></td>
                            {!compacto && nivelFilho === "campaign" && <td className="py-2.5 pr-3 text-xs">{(f.objective || "—").replace("OUTCOME_", "")}</td>}
                            {!compacto && <td className="border-l border-border/60 py-2.5 pl-3 pr-3 text-right">{f.daily_budget ? brl(Number(f.daily_budget) / 100) : "—"}</td>}
                            <td className={cn("py-2.5 pr-3 text-right font-semibold text-foreground", compacto && "border-l border-border/60 pl-3")}>{brl(spend)}</td>
                            {!compacto && <td className="border-l border-border/60 py-2.5 pl-3 pr-3 text-right">{fmt(Number(i?.impressions ?? 0))}</td>}
                            <td className={cn("py-2.5 pr-3 text-right", compacto && "border-l border-border/60 pl-3")}>{fmt(Number(i?.clicks ?? 0))}</td>
                            <td className="py-2.5 pr-3 text-right">{fmt(Number(i?.ctr ?? 0), 2)}%</td>
                            {!compacto && <td className="py-2.5 pr-3 text-right">{brl(Number(i?.cpc ?? 0))}</td>}
                            {!compacto && <td className="py-2.5 pr-3 text-right">{brl(Number(i?.cpm ?? 0))}</td>}
                            {!compacto && <td className="border-l border-border/60 py-2.5 pl-3 pr-3 text-right">{fmt(Number(i?.reach ?? 0))}</td>}
                            {!compacto && <td className="py-2.5 pr-3 text-right">{fmt(Number(i?.frequency ?? 0), 2)}</td>}
                            <td className="border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold text-primary">{fmt(res)}</td>
                            <td className="py-2.5 pr-3 text-right">{res ? brl(spend / res) : "—"}</td>
                            {nivelFilho === "campaign" && <td className="border-l border-border/60 py-2.5 pl-3 pr-3 text-right font-semibold">{crmLeads}</td>}
                            {nivelFilho === "campaign" && <td className="py-2.5 pr-4 text-right">{crmLeads ? brl(spend / crmLeads) : "—"}</td>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        // Nível de anúncio: preview do criativo
        selecionado && (
          <Card className="rounded-2xl">
            <CardHeader><CardTitle>Criativo do anúncio</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <CreativeCard
                ad={{ id: selecionado.id, name: selecionado.nome, effective_status: (selecionado as any).status ?? "ACTIVE", creative: { id: (selecionado as any).creativeId ?? `cr_${selecionado.id}` } }}
                ins={insAtual?.data?.[0]}
                adsetNome={trilha.length >= 2 ? trilha[trilha.length - 2].nome : "—"}
              />
            </CardContent>
          </Card>
        )
      )}

      {/* Grid de criativos ao navegar em um conjunto */}
      {selecionado?.nivel === "adset" && (filhos?.data ?? []).length > 0 && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle>Criativos do conjunto</CardTitle></CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {(filhos?.data ?? []).map((ad: any) => (
              <CreativeCard key={ad.id} ad={ad} ins={insPorFilho.get(ad.id)} adsetNome={selecionado.nome} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------- componentes ----------
function OrcamentoPanel() {
  const { user } = useAuth()
  const { data, mutate } = useSWR("/api/meta/orcamento", fetcher, { refreshInterval: 300_000 })
  const { data: contasData } = useSWR("/api/meta?op=accounts", fetcher)
  const [open, setOpen] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState<{ tetoMensal: string; custoInicial: string; veiculacaoInicio: string; veiculacaoFim: string; contas: string[] } | null>(null)

  const cfg = data?.config
  const calc = data?.calc

  function abrirEdicao() {
    if (!cfg) return
    setForm({
      tetoMensal: String(cfg.tetoMensal),
      custoInicial: String(cfg.custoInicial),
      veiculacaoInicio: String(cfg.veiculacaoInicio),
      veiculacaoFim: String(cfg.veiculacaoFim),
      contas: [...cfg.contas],
    })
    setMsg(null)
    setOpen(true)
  }

  async function salvar() {
    if (!form || !user) return
    setSalvando(true)
    setMsg(null)
    try {
      const r = await fetch("/api/meta/orcamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          senderId: user.id,
          tetoMensal: Number(form.tetoMensal),
          custoInicial: Number(form.custoInicial),
          veiculacaoInicio: Number(form.veiculacaoInicio),
          veiculacaoFim: Number(form.veiculacaoFim),
          contas: form.contas,
        }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "Erro ao salvar")
      setOpen(false)
      mutate()
    } catch (e: any) {
      setMsg(e.message)
    } finally {
      setSalvando(false)
    }
  }

  const usadoPct = cfg && calc && cfg.tetoMensal > 0 ? Math.min(100, (calc.usado / cfg.tetoMensal) * 100) : 0
  const projPct = cfg && calc && cfg.tetoMensal > 0 ? Math.min(100, (calc.projecao / cfg.tetoMensal) * 100) : 0

  return (
    <Card className="rounded-2xl overflow-hidden">
      <CardContent className="p-4 sm:p-5">
        {!data ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <div className="flex flex-col gap-4">
            {/* Linha 1: título + badges + editar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/25 shadow-[0_0_16px_rgb(178_34_34/0.35)]">
                  <Wallet className="size-4.5" />
                </span>
                <div>
                  <p className="font-display text-sm font-bold tracking-tight">Verba mensal — Meta Ads</p>
                  <p className="text-xs text-muted-foreground">
                    {data.source === "mock" ? "Sem token: gasto real não carregado." : `Gasto real do mês (${calc.mesReferencia}): ${brl2(calc.diasVeiculados > 0 ? data.gastoReal : 0)} · Média ${brl2(calc.mediaDiaria)}/dia`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={calc.dentroLimite ? "green" : "red"} className="gap-1 px-2.5 py-1">
                  {calc.dentroLimite ? <TrendingUp className="size-3" /> : <TriangleAlert className="size-3" />}
                  {calc.dentroLimite ? "Dentro do limite" : `Estoura em ${brl2(calc.estouro)}`}
                </Badge>
                <button
                  type="button"
                  onClick={abrirEdicao}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground"
                >
                  <SlidersHorizontal className="size-3.5" /> Ajustar verba
                </button>
              </div>
            </div>

            {/* Linha 2: KPIs */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <OrcKpi label="Teto mensal" value={brl2(cfg.tetoMensal)} sub="limite do mês" />
              <OrcKpi label="Já usado" value={brl2(calc.usado)} sub={`cartão ${brl2(cfg.custoInicial)} + Meta ${brl2(data.gastoReal)}`} accent={usadoPct > 80} />
              <OrcKpi label="Quanto falta" value={brl2(calc.restante)} sub={calc.diasRestantes > 0 ? `${brl2(calc.verbaDiaRestante)}/dia até dia ${cfg.veiculacaoFim}` : "sem dias restantes"} />
              <OrcKpi label="Projeção do mês" value={brl2(calc.projecao)} sub={`padrão dia ${cfg.veiculacaoInicio}–${cfg.veiculacaoFim}`} accent={!calc.dentroLimite} />
            </div>

            {/* Linha 3: barra de progresso */}
            <div>
              <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-500"
                  style={{ width: `${usadoPct}%` }}
                />
                {projPct > 0 && (
                  <div
                    className="absolute top-0 h-full w-[3px] bg-foreground/70"
                    style={{ left: `calc(${projPct}% - 1.5px)` }}
                    title={`Projeção: ${brl2(calc.projecao)}`}
                  />
                )}
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{brl2(calc.usado)} ({fmt(usadoPct, 1)}% do teto)</span>
                <span className="flex items-center gap-1"><span className="inline-block size-1.5 rounded-full bg-foreground/70" /> projeção {brl2(calc.projecao)}</span>
                <span>{brl2(cfg.tetoMensal)}</span>
              </div>
            </div>

            {/* Alerta de estouro */}
            {!calc.dentroLimite && (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                No ritmo atual, o mês fecha com estouro de {brl2(calc.estouro)} em relação ao teto de {brl2(cfg.tetoMensal)}. Reduza o orçamento dos conjuntos ou o número de criativos ativos.
              </p>
            )}
          </div>
        )}
      </CardContent>

      {/* Modal de edição */}
      <Dialog open={open} onClose={() => setOpen(false)} title="Ajustar verba mensal">
        {form && (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="orc-teto">Teto mensal (R$)</Label>
                <Input id="orc-teto" type="number" step="0.01" min="0" value={form.tetoMensal} onChange={(e) => setForm({ ...form, tetoMensal: e.target.value })} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="orc-custo">Já comprometido no início do mês (R$)</Label>
                <Input id="orc-custo" type="number" step="0.01" min="0" value={form.custoInicial} onChange={(e) => setForm({ ...form, custoInicial: e.target.value })} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="orc-ini">Veiculação — de (dia)</Label>
                <Input id="orc-ini" type="number" min="1" max="31" value={form.veiculacaoInicio} onChange={(e) => setForm({ ...form, veiculacaoInicio: e.target.value })} />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="orc-fim">Veiculação — até (dia)</Label>
                <Input id="orc-fim" type="number" min="1" max="31" value={form.veiculacaoFim} onChange={(e) => setForm({ ...form, veiculacaoFim: e.target.value })} />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Contas incluídas no gasto real</Label>
              <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-muted/30 p-3">
                {(contasData?.data ?? []).map((c: any) => {
                  const ativa = form.contas.includes(c.id)
                  return (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground transition hover:text-foreground">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={ativa}
                        onChange={() =>
                          setForm({ ...form, contas: ativa ? form.contas.filter((x) => x !== c.id) : [...form.contas, c.id] })
                        }
                      />
                      <span className="truncate">{c.name}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">{c.id}</span>
                    </label>
                  )
                })}
                {(contasData?.data ?? []).length === 0 && <p className="text-xs text-muted-foreground">Carregando contas…</p>}
              </div>
              <p className="text-[11px] text-muted-foreground">O gasto real é somado nas contas marcadas.</p>
            </div>

            {msg && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{msg}</p>}

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-border bg-card px-3.5 py-2 text-sm font-medium text-muted-foreground shadow-sm transition hover:bg-muted hover:text-foreground">
                Cancelar
              </button>
              <button type="button" onClick={salvar} disabled={salvando} className="shine inline-flex items-center gap-2 rounded-lg bg-gradient-to-b from-primary to-primary/90 px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-[0_8px_24px_-6px_rgb(178_34_34/0.5)] transition hover:brightness-110 disabled:opacity-60">
                {salvando ? "Salvando…" : "Salvar"}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  )
}

function OrcKpi({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-muted/20 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate font-display text-lg font-bold tabular-nums tracking-tight", accent ? "text-red-600" : "text-foreground")}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={sub}>{sub}</p>}
    </div>
  )
}

function Kpi({ icon: Icon, label, value, prev, cur, invert, accent }: { icon: any; label: string; value: string; prev?: number; cur: number; invert?: boolean; accent?: boolean }) {
  let delta: number | null = null
  if (prev !== undefined && prev > 0) delta = ((cur - prev) / prev) * 100
  const positivo = delta !== null && (invert ? delta < 0 : delta > 0)
  return (
    <div className={cn(
      "group rounded-2xl bg-gradient-to-b from-primary/20 via-primary/5 to-transparent p-px transition-all duration-300 hover:-translate-y-1 hover:from-primary/40",
      accent && "from-accent/25 via-accent/5",
    )}>
      <Card className="h-full rounded-[calc(var(--radius-2xl)-1px)] transition-shadow duration-300 hover:shadow-[0_14px_36px_-10px_rgb(178_34_34/0.4)]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
              <p className="mt-1 truncate font-display text-xl font-bold tabular-nums tracking-tight md:text-2xl">{value}</p>
              {delta !== null && (
                <span className={cn(
                  "mt-1.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                  positivo ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600",
                )}>
                  {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
                  {fmt(Math.abs(delta), 1)}% vs anterior
                </span>
              )}
            </div>
            <div className={cn(
              "shrink-0 rounded-xl p-2.5 ring-1 transition-all duration-300 group-hover:scale-110 group-hover:-rotate-3",
              accent
                ? "bg-accent/10 text-accent ring-accent/25 shadow-[0_0_18px_rgb(196_30_36/0.45)]"
                : "bg-primary/10 text-primary ring-primary/25 shadow-[0_0_16px_rgb(178_34_34/0.35)]",
            )}>
              <Icon className="size-4.5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2 text-xs shadow-lg">
      {label && <p className="mb-1.5 font-semibold text-foreground">{label}</p>}
      <div className="flex flex-col gap-1">
        {payload.map((p: any, i: number) => (
          <span key={i} className="flex items-center justify-between gap-4 tabular-nums">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: p.color || p.fill || "#b22222" }} />
              {p.name}
            </span>
            <span className="font-semibold text-foreground">{p.name === "Gasto (R$)" ? brl(Number(p.value)) : p.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Aviso({ texto, acao, erro }: { texto: string; acao: string; erro?: boolean }) {
  return (
    <div className={cn(
      "flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm",
      erro ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800",
    )}>
      <span className="flex items-center gap-2.5">
        <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", erro ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600")}>
          <TriangleAlert className="size-4" />
        </span>
        {texto}
      </span>
      <a href="/api/meta/oauth/start" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:brightness-110">
        <RefreshCw className="size-3" /> {acao}
      </a>
    </div>
  )
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-muted">
        <BarChart3 className="size-5 text-muted-foreground/70" />
      </div>
      <p className="text-sm text-muted-foreground">{texto}</p>
    </div>
  )
}

const CTA_PT: Record<string, string> = { LEARN_MORE: "Saiba mais", WHATSAPP_MESSAGE: "Enviar WhatsApp", SIGN_UP: "Cadastre-se", CONTACT_US: "Fale conosco" }

function CreativeCard({ ad, ins, adsetNome }: { ad: any; ins?: any; adsetNome: string }) {
  const { data: cr } = useSWR(ad.creative?.id ? `/api/meta?op=creative&id=${ad.creative.id}` : null, fetcher)
  const res = ins ? resultados(ins) : 0
  return (
    <div className="group rounded-2xl bg-gradient-to-b from-primary/15 via-primary/5 to-transparent p-px transition-all duration-300 hover:-translate-y-1 hover:from-primary/40">
      <div className="flex h-full flex-col overflow-hidden rounded-[calc(var(--radius-2xl)-1px)] border border-border bg-card shadow-sm transition-shadow duration-300 hover:shadow-[0_16px_44px_-12px_rgb(178_34_34/0.4)]">
        <div className="relative">
          {cr?.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cr.image_url || "/placeholder.svg"} alt={`Criativo do anúncio ${ad.name}`} className="h-44 w-full object-cover transition-all duration-300 group-hover:scale-[1.04]" />
          ) : (
            <Skeleton className="h-44 w-full rounded-none" />
          )}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/25 to-transparent" aria-hidden="true" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            <StatusBadge s={ad.effective_status} />
            {cr?.object_type && <Badge variant="slate">{cr.object_type === "VIDEO" ? "Vídeo" : cr.object_type === "CAROUSEL" ? "Carrossel" : "Imagem"}</Badge>}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="text-sm font-semibold text-pretty">{cr?.title ?? ad.name}</p>
          {cr?.body && <p className="line-clamp-2 text-xs text-muted-foreground">{cr.body}</p>}
          <p className="text-xs text-muted-foreground">Anúncio: {ad.name} · Conjunto: {adsetNome}</p>
          {cr?.call_to_action_type && (
            <span className="w-fit rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary shadow-[0_0_12px_rgb(178_34_34/0.25)]">{CTA_PT[cr.call_to_action_type] ?? cr.call_to_action_type}</span>
          )}
          <div className="mt-auto grid grid-cols-4 gap-1 border-t border-border pt-3 text-center tabular-nums">
            <MiniMetric l="Gasto" v={brl(Number(ins?.spend ?? 0))} />
            <MiniMetric l="Cliques" v={fmt(Number(ins?.clicks ?? 0))} />
            <MiniMetric l="CTR" v={`${fmt(Number(ins?.ctr ?? 0), 2)}%`} />
            <MiniMetric l="Result." v={fmt(res)} />
          </div>
        </div>
      </div>
    </div>
  )
}

function MiniMetric({ l, v }: { l: string; v: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l}</p>
      <p className="text-xs font-semibold text-foreground">{v}</p>
    </div>
  )
}
