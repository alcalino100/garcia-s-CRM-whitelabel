"use client"

import { useLeads } from "@/lib/leads-store"

// Letreiro vivo do CRM (assinatura em movimento): gira os números do dia.
// Dados do store já carregado — custo zero de queries.
export function CrmTicker() {
  let items: string[] = []
  try {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { leads } = useLeads()
    const hoje = new Date().toISOString().slice(0, 10)
    const novosHoje = leads.filter((l) => (l.criadoEm ?? "").slice(0, 10) === hoje).length
    const emAtend = leads.filter((l) => l.status === "em_atendimento").length
    const aguard = leads.filter((l) => l.status === "atendimento_humano").length
    const emAutom = leads.filter((l) => l.status === "em_automacao").length
    items = [
      `${novosHoje} novos hoje`,
      `${emAtend} em atendimento`,
      `${aguard} aguardando corretor`,
      `${emAutom} na automação`,
    ]
  } catch {
    items = []
  }
  if (!items.length) return null
  const faixa = [...items, ...items, ...items, ...items]
  return (
    <div aria-hidden className="ticker overflow-hidden border-b border-border bg-card">
      <div className="ticker-track flex w-max items-center gap-8 whitespace-nowrap px-4 py-1.5">
        {faixa.map((t, i) => (
          <span key={i} className="flex items-center gap-8 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {t} <span className="text-foreground">·</span>
          </span>
        ))}
      </div>
    </div>
  )
}
