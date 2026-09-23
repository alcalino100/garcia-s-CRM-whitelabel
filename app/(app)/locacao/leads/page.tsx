"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts"
import { UserPlus, CalendarRange, Activity, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react"
import { useLocacao } from "@/lib/locacao-store"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeLocacao } from "@/lib/roles"
import { Card, CardContent, CardHeader, CardTitle, Badge, Select, Skeleton } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import { LOCACAO_STATUSES, refsTexto, LOCACAO_STATUS_LABEL, LOCACAO_STATUS_VARIANT, TEMP_LABEL, TEMP_VARIANT, resumoPreferencias } from "@/lib/locacao-labels"
import { ORIGENS, type Origem } from "@/lib/mock-data"
import type { LocacaoLead, LocacaoStatus } from "@/lib/locacao-labels"
import { cn } from "@/lib/utils"

type Periodo = { ini: string; fim: string }

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dia = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dia}`
}

// Semana começa na segunda-feira
function inicioSemana(d: Date): Date {
  const x = new Date(d)
  const dia = x.getDay()
  const delta = dia === 0 ? -6 : 1 - dia
  x.setDate(x.getDate() + delta)
  return x
}

function addDays(ymdStr: string, days: number): string {
  const [y, m, d] = ymdStr.split("-").map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + days)
  return ymd(dt)
}

function variacao(cur: number, prev: number): number | null {
  if (prev === 0) return cur > 0 ? 100 : null
  if (cur === 0) return -100
  return ((cur - prev) / prev) * 100
}

const PRESETS: { label: string; get: () => Periodo }[] = [
  { label: "Hoje", get: () => { const h = new Date(); return { ini: ymd(h), fim: ymd(h) } } },
  { label: "Ontem", get: () => { const h = new Date(); h.setDate(h.getDate() - 1); return { ini: ymd(h), fim: ymd(h) } } },
  { label: "Esta semana", get: () => { const h = new Date(); return { ini: ymd(inicioSemana(h)), fim: ymd(h) } } },
  { label: "Semana passada", get: () => { const h = new Date(); const ini = inicioSemana(h); ini.setDate(ini.getDate() - 7); const fim = new Date(ini); fim.setDate(fim.getDate() + 6); return { ini: ymd(ini), fim: ymd(fim) } } },
  { label: "Este mês", get: () => { const h = new Date(); return { ini: ymd(new Date(h.getFullYear(), h.getMonth(), 1)), fim: ymd(h) } } },
  { label: "Mês passado", get: () => { const h = new Date(); return { ini: ymd(new Date(h.getFullYear(), h.getMonth() - 1, 1)), fim: ymd(new Date(h.getFullYear(), h.getMonth(), 0)) } } },
  { label: "Últimos 7 dias", get: () => { const h = new Date(); const ini = new Date(h); ini.setDate(ini.getDate() - 6); return { ini: ymd(ini), fim: ymd(h) } } },
  { label: "Últimos 30 dias", get: () => { const h = new Date(); const ini = new Date(h); ini.setDate(ini.getDate() - 29); return { ini: ymd(ini), fim: ymd(h) } } },
  { label: "Este ano", get: () => { const h = new Date(); return { ini: ymd(new Date(h.getFullYear(), 0, 1)), fim: ymd(h) } } },
  { label: "Todos", get: () => ({ ini: "", fim: "" }) },
]

function fmtDia(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" })
}

export default function LocacaoLeadsPage() {
  const { user } = useAuth()
  const { leads, corretores, userName } = useLocacao()
  const [loading, setLoading] = useState(true)
  const [dataInicio, setDataInicio] = useState(() => ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1)))
  const [dataFim, setDataFim] = useState(() => ymd(new Date()))
  const [corretor, setCorretor] = useState("todos")
  const [origem, setOrigem] = useState<Origem | "todas">("todas")
  const [status, setStatus] = useState<LocacaoStatus | "todos">("todos")

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  const noPeriodo = useMemo(() => {
    const ini = dataInicio || "0000-00-00"
    const fim = dataFim || "9999-99-99"
    return leads.filter((l) => {
      const d = (l.criadoEm || "").slice(0, 10)
      return d >= ini && d <= fim
    })
  }, [leads, dataInicio, dataFim])

  const filtrados = useMemo(() => {
    const lista = noPeriodo.filter(
      (l) =>
        (corretor === "todos" || l.corretorId === corretor) &&
        (origem === "todas" || l.origem === origem) &&
        (status === "todos" || l.status === status),
    )
    return [...lista].sort((a, b) => (b.criadoEm || "").localeCompare(a.criadoEm || ""))
  }, [noPeriodo, corretor, origem, status])

  const kpis = useMemo(() => {
    const total = filtrados.length
    const iniT = new Date(dataInicio + "T00:00:00")
    const fimT = new Date(dataFim + "T00:00:00")
    const dias = total && !isNaN(iniT.getTime()) && !isNaN(fimT.getTime())
      ? Math.max(1, Math.round((fimT.getTime() - iniT.getTime()) / 86400000) + 1)
      : 1
    const ativos = filtrados.filter((l) => !["locado", "perdido"].includes(l.status)).length
    const locados = filtrados.filter((l) => l.status === "locado").length
    return { total, media: total / dias, ativos, locados }
  }, [filtrados, dataInicio, dataFim])

  const dias = useMemo(() => {
    const iniT = new Date(dataInicio + "T00:00:00")
    const fimT = new Date(dataFim + "T00:00:00")
    if (!dataInicio || !dataFim || isNaN(iniT.getTime()) || isNaN(fimT.getTime())) return 0
    return Math.max(1, Math.round((fimT.getTime() - iniT.getTime()) / 86400000) + 1)
  }, [dataInicio, dataFim])

  const comparativo = useMemo(() => {
    if (!dataInicio || !dataFim) return null
    const prevIni = addDays(dataInicio, -dias)
    const prevFim = addDays(dataInicio, -1)
    const noRange = (l: LocacaoLead) => {
      const d = (l.criadoEm || "").slice(0, 10)
      return d >= prevIni && d <= prevFim
    }
    const prevLeads = leads.filter((l) => (corretor === "todos" || l.corretorId === corretor) && (origem === "todas" || l.origem === origem) && (status === "todos" || l.status === status) && noRange(l))
    const prevAtivos = prevLeads.filter((l) => !["locado", "perdido"].includes(l.status)).length
    const prevLocados = prevLeads.filter((l) => l.status === "locado").length
    return {
      prevIni,
      prevFim,
      total: { cur: filtrados.length, prev: prevLeads.length },
      media: { cur: kpis.media, prev: dias ? prevLeads.length / dias : 0 },
      ativos: { cur: kpis.ativos, prev: prevAtivos },
      locados: { cur: kpis.locados, prev: prevLocados },
    }
  }, [dataInicio, dataFim, dias, leads, corretor, origem, status, filtrados, kpis])

  const porDia = useMemo(() => {
    const m = new Map<string, { key: string; total: number }>()
    for (const l of filtrados) {
      const k = (l.criadoEm || "").slice(0, 10)
      if (!k) continue
      const e = m.get(k) ?? { key: k, total: 0 }
      e.total++
      m.set(k, e)
    }
    return Array.from(m.values()).sort((a, b) => a.key.localeCompare(b.key)).map((e) => ({ ...e, label: fmtDia(e.key) }))
  }, [filtrados])

  const porStatus = useMemo(() => {
    const m = new Map<LocacaoStatus, number>()
    for (const l of filtrados) m.set(l.status, (m.get(l.status) ?? 0) + 1)
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1])
  }, [filtrados])

  const porOrigem = useMemo(() => {
    return ORIGENS
      .map((o) => ({ origem: o, total: filtrados.filter((l) => l.origem === o).length }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
  }, [filtrados])

  if (!user || !isGestorNivel(user.role) || !podeLocacao(user.role)) {
    return <p className="py-16 text-center text-muted-foreground">Acesso restrito aos gestores.</p>
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-64 w-full lg:col-span-2" /><Skeleton className="h-64 w-full" />
        </div>
        <Skeleton className="h-72 w-full" />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeading
        title="Leads de Locação Cadastrados"
        subtitle="Acompanhe os leads cadastrados por dia, semana, mês e período personalizado."
        badge="Visão gerencial"
      />

      {/* Filtros de período */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Período:</span>
          {PRESETS.map((p) => {
            const r = p.get()
            const active = dataInicio === r.ini && dataFim === r.fim
            return (
              <button key={p.label} onClick={() => { setDataInicio(r.ini); setDataFim(r.fim) }}
                className={cn(
                  "rounded-lg border px-3 py-1.5 text-sm font-medium transition",
                  active
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background hover:border-primary hover:text-primary",
                )}>
                {p.label}
              </button>
            )
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">De</span>
            <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Até</span>
            <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)}
              className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>
          <Select value={corretor} onChange={(e) => setCorretor(e.target.value)} aria-label="Filtrar por corretor" className="w-44">
            <option value="todos">Corretor: todos</option>
            {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select value={origem} onChange={(e) => setOrigem(e.target.value as Origem | "todas")} aria-label="Filtrar por origem" className="w-40">
            <option value="todas">Origem: todas</option>
            {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
          <Select value={status} onChange={(e) => setStatus(e.target.value as LocacaoStatus | "todos")} aria-label="Filtrar por status" className="w-48">
            <option value="todos">Status: todos</option>
            {LOCACAO_STATUSES.map((s) => <option key={s} value={s}>{LOCACAO_STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={UserPlus} label="Cadastrados no período" value={String(kpis.total)}
          variacao={comparativo ? variacao(comparativo.total.cur, comparativo.total.prev) : null}
          compareTitle={comparativo ? `Anterior: ${fmtDia(comparativo.prevIni)} — ${fmtDia(comparativo.prevFim)}` : undefined} />
        <Kpi icon={CalendarRange} label="Média por dia" value={kpis.media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          variacao={comparativo ? variacao(comparativo.media.cur, comparativo.media.prev) : null}
          compareTitle={comparativo ? `Anterior: ${fmtDia(comparativo.prevIni)} — ${fmtDia(comparativo.prevFim)}` : undefined} />
        <Kpi icon={Activity} label="Ativos" value={String(kpis.ativos)}
          variacao={comparativo ? variacao(comparativo.ativos.cur, comparativo.ativos.prev) : null}
          compareTitle={comparativo ? `Anterior: ${fmtDia(comparativo.prevIni)} — ${fmtDia(comparativo.prevFim)}` : undefined} />
        <Kpi icon={CheckCircle2} label="Locados" value={String(kpis.locados)} accent
          variacao={comparativo ? variacao(comparativo.locados.cur, comparativo.locados.prev) : null}
          compareTitle={comparativo ? `Anterior: ${fmtDia(comparativo.prevIni)} — ${fmtDia(comparativo.prevFim)}` : undefined} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Cadastros por dia */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Cadastros por dia</CardTitle></CardHeader>
          <CardContent>
            {porDia.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lead cadastrado no período</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porDia}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                  <Tooltip />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {porDia.map((_, i) => <Cell key={i} fill="#b22222" />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Resumo */}
        <Card>
          <CardHeader><CardTitle>Resumo do período</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por status</h3>
              <div className="flex flex-wrap gap-1.5">
                {porStatus.length === 0 && <p className="text-sm text-muted-foreground">Sem dados</p>}
                {porStatus.map(([s, n]) => (
                  <Badge key={s} variant={LOCACAO_STATUS_VARIANT[s]}>{LOCACAO_STATUS_LABEL[s]} · {n}</Badge>
                ))}
              </div>
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Por origem</h3>
              <div className="flex flex-wrap gap-1.5">
                {porOrigem.length === 0 && <p className="text-sm text-muted-foreground">Sem dados</p>}
                {porOrigem.map((r) => (
                  <Badge key={r.origem} variant="gray">{r.origem} · {r.total}</Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lista */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle>Lista de leads cadastrados</CardTitle>
          <p className="text-xs text-muted-foreground">
            {dataInicio || dataFim ? `${fmtDia(dataInicio || "2000-01-01")} — ${fmtDia(dataFim || "2099-12-31")}` : "Todos os períodos"} · {filtrados.length} {filtrados.length === 1 ? "lead" : "leads"}
          </p>
        </CardHeader>
        <CardContent className="pt-4">
          {filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lead cadastrado com os filtros atuais</p>
          ) : (
            <div className="flex flex-col gap-2">
              {filtrados.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
                  <Link href={`/locacao/${l.id}`} className="min-w-0 font-medium hover:text-primary">
                    {l.nome}
                  </Link>
                  {refsTexto(l) && <Badge variant="gray">{refsTexto(l)}</Badge>}
                  <Badge variant={LOCACAO_STATUS_VARIANT[l.status]}>{LOCACAO_STATUS_LABEL[l.status]}</Badge>
                  <Badge variant={TEMP_VARIANT[l.temperatura]}>{TEMP_LABEL[l.temperatura]}</Badge>
                  <span className="hidden rounded-md bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground sm:inline">{resumoPreferencias(l)}</span>
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{l.origem}</span>
                    <span>{userName(l.corretorId)}</span>
                    <span>{fmtDateLead(l.criadoEm)}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function fmtDateLead(iso: string) {
  const [y, m, d] = (iso || "").slice(0, 10).split("-").map(Number)
  if (!y) return "—"
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })
}

function Kpi({ icon: Icon, label, value, accent, variacao: v, compareTitle }: { icon: any; label: string; value: string; accent?: boolean; variacao?: number | null; compareTitle?: string }) {
  return (
    <div className={cn(
      "group rounded-xl border border-border bg-card p-px transition-colors duration-150 hover:border-foreground/25",
      accent && "from-accent/25 via-accent/5",
    )}>
      <Card className="h-full rounded-[calc(var(--radius-xl)-1px)]">
        <CardContent className="flex h-full items-center gap-4 p-4 pt-5">
          <div className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 transition-all duration-300 group-hover:scale-110 group-hover:-rotate-3",
            accent
              ? "bg-accent/10 text-accent ring-accent/25 shadow-[0_0_18px_rgb(196_30_36/0.45)]"
              : "bg-primary/10 text-primary ring-primary/25 shadow-[0_0_16px_rgb(178_34_34/0.35)]",
          )}>
            <Icon className="size-5" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-xs text-muted-foreground">{label}</p>
            <p className="truncate font-display text-xl font-bold tabular-nums">{value}</p>
            {v != null && (
              <p title={compareTitle} className={cn(
                "mt-0.5 flex items-center gap-1 text-xs font-semibold tabular-nums",
                v >= 0 ? "text-emerald-600" : "text-red-600",
              )}>
                {v >= 0 ? <TrendingUp className="size-3.5 shrink-0" /> : <TrendingDown className="size-3.5 shrink-0" />}
                {v >= 0 ? "+" : ""}{v.toFixed(0)}% vs. período anterior
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
