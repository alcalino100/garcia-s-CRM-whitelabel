"use client"

import { Suspense, useEffect, useMemo, useState } from "react"
import { AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts"
import { Users, CalendarCheck, TrendingUp, CircleDollarSign, Target } from "lucide-react"
import { useLeads } from "@/lib/leads-store"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeVendas } from "@/lib/roles"
import { usePresenca } from "@/lib/presence"
import { OnlineDot } from "@/components/online-dot"
import { Card, CardContent, CardHeader, CardTitle, Badge, Skeleton } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import { KanbanBoard } from "@/components/kanban-board"
import { brl, fmtDate, fmtDuracao, STATUS_ACCENT, STATUS_LABEL, STATUS_VARIANT } from "@/lib/labels"
import { ORIGENS, type LeadStatus, type Origem } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const COLORS = ["#18181b", "#52525b", "#71717a", "#a1a1aa", "#d4d4d8", "#e4e4e7"]

// Probabilidade de fechamento por etapa (usada na previsão ponderada do pipeline)
const PIPELINE_PROB: Record<LeadStatus, number> = {
  novo: 0.1,
  "em_atendimento": 0.2,
  em_automacao: 0.15,
  "atendimento_ia": 0.12,
  "em_followup": 0.15,
  "escolhendo opcoes": 0.3,
  "imovel necessidade": 0.3,
  permuta: 0.4,
  "reuniao agendada": 0.5,
  negociando: 0.75,
  fechado: 1,
  perdido: 0,
}
const ETAPAS_PIPELINE: LeadStatus[] = ["novo", "em_atendimento", "em_followup", "escolhendo opcoes", "imovel necessidade", "permuta", "reuniao agendada", "negociando"]
const FUNIL: LeadStatus[] = ["novo", "em_atendimento", "escolhendo opcoes", "imovel necessidade", "permuta", "reuniao agendada", "negociando", "fechado"]

function ymdLocal(d: Date) {
  return d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })
}
function inicioSemana(d: Date) {
  const x = new Date(d)
  const dia = x.getDay()
  const delta = dia === 0 ? -6 : 1 - dia
  x.setDate(x.getDate() + delta)
  return x
}

type Periodo = "mes_atual" | "mes_passado" | "7d" | "30d" | "90d" | "todos"

const PERIODOS: { key: Periodo; label: string }[] = [
  { key: "mes_atual", label: "Este mês" },
  { key: "mes_passado", label: "Mês passado" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "90d", label: "Últimos 90 dias" },
  { key: "todos", label: "Todo histórico" },
]

function rangePeriodo(p: Periodo): { start: string; end: string } | null {
  if (p === "todos") return null
  const hoje = new Date()
  const end = new Date(hoje)
  const start = new Date(hoje)
  if (p === "mes_atual") {
    start.setDate(1)
  } else if (p === "mes_passado") {
    start.setDate(1)
    start.setMonth(start.getMonth() - 1)
    end.setDate(0)
  } else if (p === "7d") {
    start.setDate(hoje.getDate() - 6)
  } else if (p === "30d") {
    start.setDate(hoje.getDate() - 29)
  } else if (p === "90d") {
    start.setDate(hoje.getDate() - 89)
  }
  return { start: ymdLocal(start), end: ymdLocal(end) }
}

export default function DashboardGestaoPage() {
  const { leads, visits, corretores, userName } = useLeads()
  const { online, usoHoje } = usePresenca()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [subAba, setSubAba] = useState<"andamento" | "fechadas">("andamento")
  const [periodo, setPeriodo] = useState<Periodo>("mes_atual")

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600)
    return () => clearTimeout(t)
  }, [])

  // Filtro de período aplicado aos gráficos (tendência, funil, performance, distribuições)
  const periodoRange = rangePeriodo(periodo)
  const periodoLabel = PERIODOS.find((p) => p.key === periodo)?.label ?? ""

  const leadsFiltrados = useMemo(() => {
    const naoArquivados = leads.filter((l) => !l.arquivadoEm)
    if (!periodoRange) return naoArquivados
    return naoArquivados.filter((l) => {
      const k = (l.criadoEm ?? "").slice(0, 10)
      return k >= periodoRange.start && k <= periodoRange.end
    })
  }, [leads, periodoRange])

  // Fechamentos do período pela DATA DE FECHAMENTO (fechadoEm ?? atualizadoEm) — mesmo critério
  // da página Fechamentos. Assim o total e o valor por corretor batem com o fechamento real.
  const fechadosNoPeriodo = useMemo(() => {
    const fechados = leads.filter((l) => l.status === "fechado")
    if (!periodoRange) return fechados
    return fechados.filter((l) => {
      const k = (l.fechadoEm ?? l.atualizadoEm ?? "").slice(0, 10)
      return k >= periodoRange.start && k <= periodoRange.end
    })
  }, [leads, periodoRange])

  const kpis = useMemo(() => {
    const naoArquivados = leads.filter((l) => !l.arquivadoEm)
    const ativos = naoArquivados.filter((l) => !["fechado", "perdido"].includes(l.status)).length
    const weekStart = new Date(); weekStart.setHours(0, 0, 0, 0); weekStart.setDate(weekStart.getDate() - weekStart.getDay())
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7)
    const visitasSemana = visits.filter((v) => {
      const d = new Date(v.data + "T00:00:00")
      return d >= weekStart && d < weekEnd
    }).length
    const emProposta = naoArquivados.filter((l) => l.status === "negociando")
    const valorPropostas = emProposta.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)
    const valorFechado = fechadosNoPeriodo.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)
    return { ativos, visitasSemana, valorPropostas, valorFechado }
  }, [leads, visits, fechadosNoPeriodo])

  const leadsPorCorretor = useMemo(
    () => corretores.map((c) => ({ nome: c.nome.split(" ")[0], total: leadsFiltrados.filter((l) => l.corretorId === c.id).length })),
    [leadsFiltrados, corretores],
  )
  const origemData = useMemo(
    () => ORIGENS.map((o) => ({ name: o, value: leadsFiltrados.filter((l) => l.origem === (o as Origem)).length })).filter((d) => d.value > 0),
    [leadsFiltrados],
  )

  // Item 2 — Tendência de cadastros (diária até 2 meses; semanal para períodos longos)
  const tendencia = useMemo(() => {
    const arr: { label: string; total: number }[] = []
    const hoje = new Date()
    let ini: Date
    let fim: Date
    let semanal: boolean
    if (periodoRange) {
      ini = new Date(`${periodoRange.start}T00:00:00`)
      fim = new Date(`${periodoRange.end}T00:00:00`)
      semanal = Math.round((fim.getTime() - ini.getTime()) / 864e5) > 62
    } else {
      const minKey = leadsFiltrados.reduce((m, l) => {
        const k = (l.criadoEm ?? "").slice(0, 10)
        return k && k < m ? k : m
      }, ymdLocal(hoje))
      ini = new Date(`${minKey}T00:00:00`)
      fim = hoje
      semanal = true
    }
    if (!semanal) {
      for (let d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
        const key = ymdLocal(d)
        arr.push({
          label: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          total: leadsFiltrados.filter((l) => (l.criadoEm ?? "").slice(0, 10) === key).length,
        })
      }
    } else {
      let s = inicioSemana(new Date(ini))
      while (s <= fim) {
        const e = new Date(s)
        e.setDate(e.getDate() + 6)
        const iniKey = ymdLocal(s)
        const fimKey = ymdLocal(e)
        arr.push({
          label: s.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
          total: leadsFiltrados.filter((l) => {
            const k = (l.criadoEm ?? "").slice(0, 10)
            return k >= iniKey && k <= fimKey
          }).length,
        })
        s.setDate(s.getDate() + 7)
      }
    }
    return arr
  }, [leadsFiltrados, periodoRange])

  // Item 3 — Previsão ponderada do pipeline por etapa
  const pipeline = useMemo(() => {
    const ativos = leads.filter((l) => !l.arquivadoEm && l.status !== "fechado" && l.status !== "perdido")
    const totalValor = ativos.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)
    const previsao = ativos.reduce((s, l) => s + (l.valorNegociacao ?? 0) * PIPELINE_PROB[l.status], 0)
    const porEtapa = ETAPAS_PIPELINE.map((status) => {
      const lista = ativos.filter((l) => l.status === status)
      const valor = lista.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)
      return { status, count: lista.length, valor, ponderado: valor * PIPELINE_PROB[status], prob: Math.round(PIPELINE_PROB[status] * 100) }
    }).filter((r) => r.count > 0 || r.valor > 0)
    return { totalValor, previsao, porEtapa }
  }, [leads])

  // Item 5 — Funil de conversão (leads ativos por etapa + % sobre o total)
  const funil = useMemo(() => {
    const ativos = leadsFiltrados.filter((l) => l.status !== "perdido")
    const base = Math.max(1, ativos.length)
    return FUNIL.map((status) => {
      const count = ativos.filter((l) => l.status === status).length
      return { status, count, pct: Math.round((count / base) * 100) }
    })
  }, [leadsFiltrados])

  // Item 5 — Performance por corretor (leads, fechados, conversão, valor)
  const performance = useMemo(
    () =>
      corretores
        .map((c) => {
          const lista = leadsFiltrados.filter((l) => l.corretorId === c.id)
          const fechados = fechadosNoPeriodo.filter((l) => l.corretorId === c.id)
          return {
            id: c.id,
            nome: c.nome.split(" ")[0],
            total: lista.length,
            fechados: fechados.length,
            conversao: lista.length ? Math.round((fechados.length / lista.length) * 100) : 0,
            valor: fechados.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0),
          }
        })
        .filter((r) => r.total > 0 || r.fechados > 0),
    [leadsFiltrados, fechadosNoPeriodo, corretores],
  )

  const propostasAndamento = leads.filter((l) => !l.arquivadoEm && l.status === "negociando")
  const propostasFechadas = leads.filter((l) => !l.arquivadoEm && l.status === "fechado")
  const listaProp = subAba === "andamento" ? propostasAndamento : propostasFechadas
  const totalAba = listaProp.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)

  if (!user || !isGestorNivel(user.role) || !podeVendas(user.role)) return <p className="py-16 text-center text-muted-foreground">Acesso restrito aos gestores de vendas.</p>

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 w-full" /><Skeleton className="h-72 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeading title="Dashboard de Gestão" subtitle="Visão geral da equipe, funil e propostas." badge="Visão gerencial" />

      {/* Filtro de período */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-muted-foreground">Período:</span>
        {PERIODOS.map((p) => (
          <button key={p.key} onClick={() => setPeriodo(p.key)} className={tab(periodo === p.key)}>
            {p.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">01 · Hoje</p>
      <div className="-mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Users} label="Leads ativos" value={String(kpis.ativos)} />
        <Kpi icon={CalendarCheck} label="Visitas esta semana" value={String(kpis.visitasSemana)} />
        <Kpi icon={TrendingUp} label="Valor em propostas" value={brl(kpis.valorPropostas)} />
        <Kpi icon={CircleDollarSign} label="Valor total fechado" value={brl(kpis.valorFechado)} accent />
      </div>

      {/* Charts */}
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">02 · Funil e origem</p>
      <div className="-mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Leads por corretor</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={leadsPorCorretor}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="nome" tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                <Tooltip />
                <Bar dataKey="total" fill="#b22222" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Origem dos leads</CardTitle></CardHeader>
          <CardContent>
            {origemData.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">Sem leads no período</p>
            ) : (
              <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
                <div className="h-[180px] w-[180px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={origemData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={false} isAnimationActive={false}>
                        {origemData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex w-full min-w-0 flex-col gap-2">
                  {origemData.map((d, i) => {
                    const total = origemData.reduce((s, x) => s + x.value, 0)
                    const pct = total ? Math.round((d.value / total) * 100) : 0
                    return (
                      <div key={d.name} className="flex items-center gap-2 text-sm">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="min-w-0 flex-1 truncate text-foreground">{d.name}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{d.value}</span> · {pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Item 3 — Pipeline + Item 5 — Funil */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2"><Target className="size-4 text-primary" /> Previsão de vendas</CardTitle>
            <p className="text-xs text-muted-foreground">Valor ponderado pela probabilidade de cada etapa</p>
          </CardHeader>
          <CardContent className="pt-3">
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Previsão (ponderada)</p>
                <p className="font-display text-xl font-bold text-primary tabular-nums">{brl(pipeline.previsao)}</p>
              </div>
              <div className="rounded-xl bg-muted/60 p-3">
                <p className="text-xs text-muted-foreground">Total no pipeline</p>
                <p className="font-display text-xl font-bold tabular-nums">{brl(pipeline.totalValor)}</p>
              </div>
            </div>
            {pipeline.porEtapa.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem propostas em andamento</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {pipeline.porEtapa.map((r) => (
                  <div key={r.status} className="flex items-center gap-3">
                    <Badge variant={STATUS_VARIANT[r.status]} className="w-36 shrink-0 justify-start">{STATUS_LABEL[r.status]}</Badge>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${r.prob}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{brl(r.ponderado)}</span> <span className="text-[10px]">({r.prob}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle>Funil de conversão</CardTitle><p className="text-xs text-muted-foreground">{periodoLabel}</p></CardHeader>
          <CardContent className="pt-3">
            {funil.every((f) => f.count === 0) ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem leads ativos</p>
            ) : (
              <div className="flex flex-col gap-2">
                {funil.filter((f) => f.count > 0).map((f) => (
                  <div key={f.status} className="flex items-center gap-3">
                    <span className="w-40 shrink-0 truncate text-sm font-medium text-foreground">{STATUS_LABEL[f.status]}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${Math.max(3, f.pct)}%`, backgroundColor: STATUS_ACCENT[f.status] }}
                      />
                    </div>
                    <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{f.count}</span> · {f.pct}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Item 2 — Tendência + Item 5 — Performance */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-0">
            <CardTitle>Tendência de cadastros</CardTitle>
            <p className="text-xs text-muted-foreground">{periodoLabel}</p>
          </CardHeader>
          <CardContent className="pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={tendencia}>
                <defs>
                  <linearGradient id="gradTendencia" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#b22222" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#b22222" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#71717a" tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} width={28} />
                <Tooltip />
                <Area type="monotone" dataKey="total" name="Leads" stroke="#b22222" strokeWidth={2} fill="url(#gradTendencia)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle>Performance por corretor</CardTitle><p className="text-xs text-muted-foreground">{periodoLabel}</p></CardHeader>
          <CardContent className="pt-3">
            {performance.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Sem dados de corretores</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-2 font-medium">Corretor</th>
                      <th className="px-2 py-2 font-medium">Status</th>
                      <th className="px-2 py-2 text-right font-medium">Uso hoje</th>
                      <th className="px-2 py-2 text-right font-medium">Leads</th>
                      <th className="px-2 py-2 text-right font-medium">Fechados</th>
                      <th className="px-2 py-2 text-right font-medium">Conv.</th>
                      <th className="px-2 py-2 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((p) => (
                      <tr key={p.nome} className="border-b border-border/60 last:border-0">
                        <td className="px-2 py-2.5 font-medium">{p.nome}</td>
                        <td className="px-2 py-2.5"><OnlineDot online={!!online[p.id]} showLabel /></td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{fmtDuracao(usoHoje[p.id])}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{p.total}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums text-emerald-600">{p.fechados}</td>
                        <td className="px-2 py-2.5 text-right tabular-nums">{p.conversao}%</td>
                        <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-primary">{brl(p.valor)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Kanban geral */}
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">03 · Pipeline</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight sm:text-3xl">Kanban Geral</h2>
          </div>
        </div>
        <Suspense fallback={<div className="h-[520px] rounded-xl border border-dashed border-border bg-card/40" />}>
          <KanbanBoard leads={leads} showCorretor currentCorretorId={corretores[0]?.id ?? ""} isGestor heightClass="h-[520px]" />
        </Suspense>
      </div>

      {/* Propostas */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle>Propostas</CardTitle>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setSubAba("andamento")} className={tab(subAba === "andamento")}>Em andamento</button>
            <button onClick={() => setSubAba("fechadas")} className={tab(subAba === "fechadas")}>Aprovadas / Fechadas</button>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="mb-3 rounded-lg bg-muted px-4 py-2 text-sm">
            {subAba === "andamento" ? "Total em andamento: " : "Total fechado: "}
            <span className="font-display font-bold text-primary">{brl(totalAba)}</span>
          </div>
          {listaProp.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma proposta registrada</p>
          ) : (
            <div className="flex flex-col gap-2">
              {listaProp.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-medium">{l.nome}</p>
                    <p className="text-xs text-muted-foreground">{l.imovelRef || "Sem imóvel"} · {userName(l.corretorId)} · {fmtDate(l.atualizadoEm)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={l.status === "fechado" ? "green" : "accent"}>{l.status === "fechado" ? "Fechado" : "Negociando"}</Badge>
                    <span className="font-display font-bold text-primary">{brl(l.valorNegociacao)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
  return (
    <div className="group rounded-xl border border-border bg-card p-5 transition-colors duration-150 hover:border-foreground/30">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-4xl font-extrabold tracking-tight tabular-nums sm:text-5xl">{value}</p>
        <div className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted",
          accent ? "text-foreground" : "text-muted-foreground",
        )}>
          <Icon className="size-5" />
        </div>
      </div>
      <p className="mt-2 truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</p>
    </div>
  )
}

function tab(active: boolean) {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`
}
