"use client"

import { useEffect, useMemo, useState } from "react"
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts"
import { Check, Coins, Handshake, Banknote, BadgeCheck, PieChart as PieIcon, Pencil, X } from "lucide-react"
import { useLocacao } from "@/lib/locacao-store"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeLocacao } from "@/lib/roles"
import { Card, CardContent, CardHeader, CardTitle, Badge, Select, Skeleton } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import { brl, fmtDate, refsTexto } from "@/lib/locacao-labels"
import type { LocacaoLead } from "@/lib/locacao-labels"
import { cn } from "@/lib/utils"

type Aba = "fechamentos" | "negociacoes"

// Gestores autorizados a registrar/editar comissão por lead
const COMISSAO_EDITORES = new Set([
  "6c2875b4-0d11-4370-b9fd-3c13b5257bd4", // Patricia
  "d6c9e533-a530-4559-bf07-60938e02b874", // Kleber
  "c044c57d-8186-4d15-acd8-4d86169e3c1a", // Guilherme
])

function dataEvento(l: LocacaoLead, aba: Aba): string {
  return aba === "fechamentos" ? (l.locadoEm ?? l.atualizadoEm) : (l.negociandoEm ?? l.atualizadoEm)
}
function mesKey(iso: string): string {
  return (iso || "").slice(0, 7)
}
function fmtMes(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })
}
function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const dia = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${dia}`
}
// Semana começa na segunda-feira
function inicioSemana(d: Date): Date {
  const x = new Date(d)
  const dia = x.getDay() // 0=dom, 1=seg ...
  const delta = dia === 0 ? -6 : 1 - dia
  x.setDate(x.getDate() + delta)
  return x
}
function fmtRange(ini: string, fim: string): string {
  if (!ini && !fim) return "Todos os períodos"
  const f = (s: string) => (s ? new Date(s + "T00:00:00").toLocaleDateString("pt-BR") : "…")
  return `${f(ini)} — ${f(fim)}`
}

const PRESETS: { label: string; get: () => { ini: string; fim: string } }[] = [
  { label: "Hoje", get: () => { const h = new Date(); return { ini: ymd(h), fim: ymd(h) } } },
  { label: "Essa semana", get: () => { const h = new Date(); return { ini: ymd(inicioSemana(h)), fim: ymd(h) } } },
  { label: "Esse mês", get: () => { const h = new Date(); return { ini: ymd(new Date(h.getFullYear(), h.getMonth(), 1)), fim: ymd(h) } } },
  { label: "Mês passado", get: () => { const h = new Date(); return { ini: ymd(new Date(h.getFullYear(), h.getMonth() - 1, 1)), fim: ymd(new Date(h.getFullYear(), h.getMonth(), 0)) } } },
  { label: "Últimos 3 meses", get: () => { const h = new Date(); const ini = new Date(h); ini.setMonth(ini.getMonth() - 3); return { ini: ymd(ini), fim: ymd(h) } } },
  { label: "Últimos 12 meses", get: () => { const h = new Date(); const ini = new Date(h); ini.setFullYear(ini.getFullYear() - 1); return { ini: ymd(ini), fim: ymd(h) } } },
  { label: "Todos", get: () => ({ ini: "", fim: "" }) },
]

export default function LocacaoContratosPage() {
  const { leads, corretores, userName, updateLead } = useLocacao()
  const { user } = useAuth()
  if (!user || !isGestorNivel(user.role) || !podeLocacao(user.role)) return <p className="py-16 text-center text-muted-foreground">Acesso restrito aos gestores de locação.</p>
  const podeEditarComissao = !!user && COMISSAO_EDITORES.has(user.id)
  const [loading, setLoading] = useState(true)
  const [aba, setAba] = useState<Aba>("fechamentos")
  const [dataInicio, setDataInicio] = useState("")
  const [dataFim, setDataFim] = useState("")
  const [corretor, setCorretor] = useState("todos")
  const [buscaRef, setBuscaRef] = useState("")
  const [editandoComissao, setEditandoComissao] = useState<string | null>(null)
  const [comissaoDraft, setComissaoDraft] = useState("")
  const [salvandoComissao, setSalvandoComissao] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 600)
    return () => clearTimeout(t)
  }, [])

  function iniciarEdicaoComissao(l: LocacaoLead) {
    setEditandoComissao(l.id)
    setComissaoDraft(l.valorComissao != null ? String(l.valorComissao) : "")
  }

  async function salvarComissao(l: LocacaoLead) {
    const texto = comissaoDraft.trim().replace(",", ".")
    const valor = texto === "" ? null : Number(texto)
    if (valor != null && Number.isNaN(valor)) return
    setSalvandoComissao(true)
    const r = await updateLead(l.id, { valorComissao: valor })
    setSalvandoComissao(false)
    if (r.ok) setEditandoComissao(null)
  }

  const base = useMemo(() => {
    const fechados = leads.filter((l) => l.status === "locado")
    const negociando = leads.filter((l) => l.status === "negociando")
    return { fechados, negociando }
  }, [leads])

  const comRef = useMemo(() => {
    const lista = aba === "fechamentos" ? base.fechados : base.negociando
    const q = buscaRef.trim().toLowerCase()
    if (!q) return lista
    return lista.filter((l) => {
      const refs = [l.imovelRef, refsTexto(l), l.nome]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
      return refs.includes(q)
    })
  }, [aba, base, buscaRef])

  const noPeriodo = useMemo(() => {
    const ini = dataInicio ? new Date(dataInicio + "T00:00:00").getTime() : -Infinity
    const fim = dataFim ? new Date(dataFim + "T23:59:59.999").getTime() : Infinity
    return comRef.filter((l) => {
      const t = new Date(dataEvento(l, aba)).getTime()
      return t >= ini && t <= fim
    })
  }, [comRef, aba, dataInicio, dataFim])

  const filtrados = useMemo(() => {
    return noPeriodo
      .filter((l) => corretor === "todos" || l.corretorId === corretor)
      .sort((a, b) => (dataEvento(b, aba) > dataEvento(a, aba) ? 1 : -1))
  }, [noPeriodo, corretor, aba])

  const kpis = useMemo(() => {
    const qtd = filtrados.length
    const total = filtrados.reduce((s, l) => s + (l.valorAluguel ?? 0), 0)
    const ticket = qtd ? Math.round(total / qtd) : 0
    const top = corretores
      .map((c) => ({ nome: c.nome, total: filtrados.filter((l) => l.corretorId === c.id).reduce((s, l) => s + (l.valorAluguel ?? 0), 0) }))
      .sort((a, b) => b.total - a.total)[0]
    const totalComissao = filtrados.reduce((s, l) => s + (l.valorComissao ?? 0), 0)
    return { qtd, total, ticket, top: top?.nome ?? "—", totalComissao }
  }, [filtrados, corretores])

  const porMes = useMemo(() => {
    const m = new Map<string, { key: string; total: number; qtd: number }>()
    for (const l of noPeriodo) {
      if (corretor !== "todos" && l.corretorId !== corretor) continue
      const k = mesKey(dataEvento(l, aba))
      const e = m.get(k) ?? { key: k, total: 0, qtd: 0 }
      e.total += l.valorAluguel ?? 0
      e.qtd += 1
      m.set(k, e)
    }
    return Array.from(m.values()).sort((a, b) => (a.key > b.key ? 1 : -1)).map((e) => ({ ...e, label: fmtMes(e.key) }))
  }, [noPeriodo, corretor, aba])

  const porCorretor = useMemo(() => {
    const max = Math.max(...noPeriodo.map((l) => l.valorAluguel ?? 0).concat([0]))
    return corretores
      .map((c) => {
        const lista = noPeriodo.filter((l) => l.corretorId === c.id)
        const total = lista.reduce((s, l) => s + (l.valorAluguel ?? 0), 0)
        return { nome: c.nome.split(" ")[0], total, qtd: lista.length, pct: max ? Math.round((total / max) * 100) : 0 }
      })
      .filter((r) => r.qtd > 0)
      .sort((a, b) => b.total - a.total)
  }, [noPeriodo, corretores])

  const cor = aba === "fechamentos" ? "#16a34a" : "#b22222"
  const corLabel = aba === "fechamentos" ? "Locado" : "Negociando"

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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          title="Contratos de Locação"
          subtitle="Locações fechadas e negociações por período, corretor e referência."
          badge="Comissões e locações"
        />
        <div className="flex gap-2">
          <button onClick={() => setAba("fechamentos")} className={tab(aba === "fechamentos")}>Locados</button>
          <button onClick={() => setAba("negociacoes")} className={tab(aba === "negociacoes")}>Negociações</button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-muted-foreground">Período:</span>
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => { const r = p.get(); setDataInicio(r.ini); setDataFim(r.fim) }}
              className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium transition hover:border-primary hover:text-primary">
              {p.label}
            </button>
          ))}
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
          <Select value={corretor} onChange={(e) => setCorretor(e.target.value)} aria-label="Filtrar por corretor" className="w-52">
            <option value="todos">Todos os corretores</option>
            {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <input
            value={buscaRef}
            onChange={(e) => setBuscaRef(e.target.value)}
            placeholder="Buscar por ref ou cliente..."
            className="w-60 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi icon={Handshake} label={aba === "fechamentos" ? "Locados" : "Negociações"} value={String(kpis.qtd)} />
        <Kpi icon={Banknote} label="Valor total" value={brl(kpis.total)} accent />
        <Kpi icon={BadgeCheck} label="Ticket médio" value={brl(kpis.ticket)} />
        <Kpi icon={Coins} label="Total comissões" value={brl(kpis.totalComissao)} />
        <Kpi icon={PieIcon} label="Corretor líder" value={kpis.top} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Mês a mês */}
        <Card className="lg:col-span-2">
          <CardHeader>          <CardTitle>Mês a mês — total em {corLabel === "Locado" ? "locações" : "negociações"}</CardTitle></CardHeader>
          <CardContent>
            {porMes.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nenhum registro neste período</p>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={porMes}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 12 }} stroke="#71717a" tickLine={false} axisLine={false} />
                  <Tooltip formatter={(v: number) => brl(v)} />
                  <Bar dataKey="total" radius={[4, 4, 0, 0]}>
                    {porMes.map((_, i) => <Cell key={i} fill={cor} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Por corretor */}
        <Card>
          <CardHeader><CardTitle>Por corretor</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3">
            {porCorretor.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sem dados no período</p>
            ) : porCorretor.map((r) => (
              <div key={r.nome} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{r.nome}</span>
                  <span className="text-muted-foreground">{r.qtd} · {brl(r.total)}</span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(r.pct, 4)}%`, background: cor }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Lista detalhada */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle>Detalhamento</CardTitle>
          <p className="text-xs text-muted-foreground">{fmtRange(dataInicio, dataFim)} · {filtrados.length} registro(s)</p>
        </CardHeader>
        <CardContent className="pt-4">
          {filtrados.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhum registro encontrado com os filtros atuais</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-3">Data</th>
                    <th className="py-2 pr-3">Cliente</th>
                    <th className="py-2 pr-3">Referência</th>
                    <th className="py-2 pr-3">Tipo</th>
                    <th className="py-2 pr-3">Corretor</th>
                    <th className="py-2 pr-3 text-right">Valor</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3 text-right">Comissão</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((l) => (
                    <tr key={l.id} className="border-b border-border/60 last:border-0">
                      <td className="whitespace-nowrap py-2.5 pr-3 text-muted-foreground">{fmtDate(dataEvento(l, aba))}</td>
                      <td className="py-2.5 pr-3 font-medium">
                        <span className="flex items-center gap-1.5">
                          {l.nome}
                          {podeEditarComissao && (
                            <button
                              onClick={() => iniciarEdicaoComissao(l)}
                              title={l.valorComissao != null ? "Editar comissão" : "Adicionar comissão"}
                              aria-label={`Editar comissão de ${l.nome}`}
                              className="rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-primary"
                            >
                              <Pencil className="size-3.5" />
                            </button>
                          )}
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">{refsTexto(l) || "—"}</td>
                      <td className="py-2.5 pr-3">{aba === "fechamentos" ? (l.tipoImovelDesejado || "—") : "—"}</td>
                      <td className="py-2.5 pr-3">{userName(l.corretorId)}</td>
                      <td className="py-2.5 pr-3 text-right font-display font-bold text-primary">{brl(l.valorAluguel)}</td>
                      <td className="py-2.5 pr-3"><Badge variant={aba === "fechamentos" ? "green" : "accent"}>{corLabel}</Badge></td>
                      <td className="py-2.5 pr-3 text-right">
                        {editandoComissao === l.id ? (
                          <span className="flex items-center justify-end gap-1">
                            <input
                              autoFocus
                              value={comissaoDraft}
                              onChange={(e) => setComissaoDraft(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") salvarComissao(l); if (e.key === "Escape") setEditandoComissao(null) }}
                              placeholder="0,00"
                              inputMode="decimal"
                              className="w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm outline-none focus:border-ring"
                            />
                            <button onClick={() => salvarComissao(l)} disabled={salvandoComissao} aria-label="Salvar comissão" className="rounded p-1 text-emerald-600 transition hover:bg-emerald-50 disabled:opacity-40">
                              <Check className="size-4" />
                            </button>
                            <button onClick={() => setEditandoComissao(null)} aria-label="Cancelar" className="rounded p-1 text-muted-foreground transition hover:bg-muted">
                              <X className="size-4" />
                            </button>
                          </span>
                        ) : (
                          <span className={l.valorComissao != null ? "font-semibold" : "text-muted-foreground"}>
                            {l.valorComissao != null ? brl(l.valorComissao) : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={7} className="py-2.5 pr-3 text-right font-semibold">Total de comissões</td>
                    <td className="py-2.5 pr-3 text-right font-display text-base font-bold text-primary">{brl(kpis.totalComissao)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Kpi({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string; accent?: boolean }) {
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
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function tab(active: boolean) {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`
}
