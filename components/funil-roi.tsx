"use client"

import { useMemo } from "react"
import { DollarSign, Users, MessageCircle, Search, CalendarCheck, Handshake, Trophy, Banknote, Percent, TrendingUp, TrendingDown, ArrowRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/primitives"
import { cn } from "@/lib/utils"
import type { Lead, LeadStatus } from "@/lib/mock-data"

const COMISSAO_PCT = 0.05

const FUNIL_STAGES: { status: LeadStatus; label: string; icon: any; color: string; gradient: string }[] = [
  { status: "novo", label: "Leads Cadastrados", icon: Users, color: "#0ea5e9", gradient: "from-sky-400 to-sky-500" },
  { status: "em_atendimento", label: "Em Atendimento", icon: MessageCircle, color: "#4f46e5", gradient: "from-indigo-400 to-indigo-500" },
  { status: "escolhendo opcoes", label: "Separando Opções", icon: Search, color: "#6366f1", gradient: "from-violet-400 to-violet-500" },
  { status: "reuniao agendada", label: "Reunião Agendada", icon: CalendarCheck, color: "#f59e0b", gradient: "from-amber-400 to-amber-500" },
  { status: "negociando", label: "Negociando", icon: Handshake, color: "#b22222", gradient: "from-red-400 to-red-600" },
  { status: "fechado", label: "Fechados", icon: Trophy, color: "#16a34a", gradient: "from-emerald-400 to-emerald-600" },
]

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

interface FunilROIProps {
  leads: Lead[]
  investimento: number | null
  loadingMeta: boolean
}

export function FunilROI({ leads, investimento, loadingMeta }: FunilROIProps) {
  const data = useMemo(() => {
    const base = leads.length
    const stages = FUNIL_STAGES.map((stage, i) => {
      const count = leads.filter((l) => l.status === stage.status).length
      const pctOfBase = base > 0 ? (count / base) * 100 : 0
      const prevCount = i > 0 ? leads.filter((l) => l.status === FUNIL_STAGES[i - 1].status).length : base
      const convFromPrev = prevCount > 0 ? (count / prevCount) * 100 : 0
      return { ...stage, count, pctOfBase, convFromPrev }
    })

    const fechados = leads.filter((l) => l.status === "fechado")
    const receita = fechados.reduce((s, l) => s + (l.valorNegociacao ?? 0), 0)
    const comissao = receita * COMISSAO_PCT
    const roi = investimento && investimento > 0 ? ((comissao / investimento) * 100) : null
    const cpl = leads.length > 0 && investimento ? investimento / leads.length : null
    const ticketMedio = fechados.length > 0 ? receita / fechados.length : null
    const conversaoTotal = leads.length > 0 ? (fechados.length / leads.length) * 100 : null

    return { stages, receita, comissao, roi, cpl, ticketMedio, conversaoTotal }
  }, [leads, investimento])

  const maxCount = Math.max(1, ...data.stages.map((s) => s.count))

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* FUNIL VISUAL — 3 colunas */}
      <Card className="lg:col-span-3 overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle>Funil de Conversão</CardTitle>
          <p className="text-xs text-muted-foreground">Do cadastro ao fechamento — todas as etapas do pipeline</p>
        </CardHeader>
        <CardContent className="px-4 pb-6 pt-2">
          {leads.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhum lead no período selecionado</p>
          ) : (
            <div className="flex flex-col items-center gap-0">
              {data.stages.map((stage, i) => {
                const widthPct = 30 + (70 * (1 - stage.count / maxCount))
                const Icon = stage.icon
                const isLast = i === data.stages.length - 1
                return (
                  <div key={stage.status} className="flex w-full flex-col items-center">
                    {/* Bloco do funil */}
                    <div className="relative flex w-full items-center" style={{ minHeight: 56 }}>
                      {/* Lado esquerdo: barra do funil */}
                      <div className="flex flex-1 items-center justify-end pr-3">
                        <div
                          className={cn(
                            "relative flex items-center justify-center rounded-l-xl py-3 pr-4 pl-5 text-white shadow-md transition-all duration-500",
                            `bg-gradient-to-r ${stage.gradient}`,
                          )}
                          style={{
                            width: `${widthPct}%`,
                            clipPath: i === 0
                              ? "polygon(0 0, 100% 0, 100% 100%, 0 100%)"
                              : isLast
                                ? "polygon(0 0, 100% 0, 100% 100%, 0 100%)"
                                : "polygon(0 8%, 100% 0, 100% 100%, 0 92%)",
                          }}
                        >
                          <Icon className="mr-2 size-4 shrink-0 opacity-90" />
                          <span className="truncate text-sm font-bold">{stage.count}</span>
                        </div>
                      </div>

                      {/* Centro: label */}
                      <div className="absolute left-1/2 z-10 -translate-x-1/2">
                        <span className="whitespace-nowrap rounded-full bg-background/90 px-3 py-1 text-xs font-semibold shadow-sm ring-1 ring-border/50">
                          {stage.label}
                        </span>
                      </div>

                      {/* Lado direito: métrica */}
                      <div className="flex flex-1 items-center pl-3">
                        <div
                          className="flex items-center gap-2 rounded-r-xl py-3 pl-4 pr-5"
                          style={{ width: `${widthPct}%` }}
                        >
                          <span className="text-xs font-bold tabular-nums" style={{ color: stage.color }}>
                            {stage.count}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            ({stage.pctOfBase.toFixed(1)}%)
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Seta de conversão entre etapas */}
                    {!isLast && (
                      <div className="relative z-10 -my-1 flex items-center gap-1.5 rounded-full bg-background px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border/40">
                        <ArrowRight className="size-3" />
                        <span>
                          {stage.convFromPrev > 0
                            ? `${stage.convFromPrev.toFixed(0)}% convertem`
                            : "sem conversão"
                          }
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* MÉTRICAS FINANCEIRAS — 2 colunas */}
      <div className="flex flex-col gap-4 lg:col-span-2">
        {/* Investimento */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Investimento</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-xl bg-red-100 text-red-600">
                <DollarSign className="size-5" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Gasto Meta Ads no período</p>
                {loadingMeta ? (
                  <div className="mt-1 h-6 w-28 animate-pulse rounded bg-muted" />
                ) : (
                  <p className="font-display text-2xl font-bold tabular-nums">
                    {investimento != null ? brl(investimento) : "—"}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Receita + Comissão */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Receita & Comissão</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="flex items-center gap-3 rounded-lg bg-emerald-50 p-3 ring-1 ring-emerald-200/60">
              <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                <Banknote className="size-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-emerald-700/70">Receita Total</p>
                <p className="font-display text-lg font-bold tabular-nums text-emerald-700">{brl(data.receita)}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-amber-50 p-3 ring-1 ring-amber-200/60">
              <div className="flex size-9 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                <Percent className="size-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-amber-700/70">Comissão (5%)</p>
                <p className="font-display text-lg font-bold tabular-nums text-amber-700">{brl(data.comissao)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ROI */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Retorno sobre Investimento</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={cn(
              "flex items-center gap-3 rounded-xl p-4 ring-1",
              data.roi != null
                ? data.roi >= 100 ? "bg-emerald-50 ring-emerald-200/60" : data.roi > 0 ? "bg-amber-50 ring-amber-200/60" : "bg-red-50 ring-red-200/60"
                : "bg-muted/50 ring-border/40"
            )}>
              <div className={cn(
                "flex size-12 items-center justify-center rounded-xl",
                data.roi != null
                  ? data.roi >= 100 ? "bg-emerald-100 text-emerald-600" : data.roi > 0 ? "bg-amber-100 text-amber-600" : "bg-red-100 text-red-600"
                  : "bg-muted text-muted-foreground"
              )}>
                {data.roi != null && data.roi >= 0
                  ? <TrendingUp className="size-6" />
                  : <TrendingDown className="size-6" />
                }
              </div>
              <div>
                <p className={cn(
                  "font-display text-3xl font-bold tabular-nums",
                  data.roi != null
                    ? data.roi >= 100 ? "text-emerald-700" : data.roi > 0 ? "text-amber-700" : "text-red-700"
                    : "text-muted-foreground"
                )}>
                  {data.roi != null ? data.roi.toFixed(1) + "%" : "—"}
                </p>
                <p className="text-xs text-muted-foreground">ROI = Comissão ÷ Investimento</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Métricas extras */}
        <div className="grid grid-cols-3 gap-3">
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">CPL</p>
              <p className="font-display text-base font-bold tabular-nums">
                {data.cpl != null ? brl(data.cpl) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Ticket Médio</p>
              <p className="font-display text-base font-bold tabular-nums">
                {data.ticketMedio != null ? brl(data.ticketMedio) : "—"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 text-center">
              <p className="text-[10px] text-muted-foreground">Conversão</p>
              <p className="font-display text-base font-bold tabular-nums">
                {data.conversaoTotal != null ? data.conversaoTotal.toFixed(1) + "%" : "—"}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
