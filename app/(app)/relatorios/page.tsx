"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase/client"
import { isGestorNivel } from "@/lib/roles"
import { Card, CardContent, CardHeader, CardTitle, Select } from "@/components/ui/primitives"

// Leitura pura: papel leitor (e gestores) veem métricas, sem nenhuma ação.
export default function RelatoriosPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [dias, setDias] = useState(30)
  const [vals, setVals] = useState<Record<string, number | string>>({})

  const permitido = !!user && (user.role === "leitor" || isGestorNivel(user.role))
  useEffect(() => {
    if (!loading && !permitido) router.replace("/painel-corretor")
  }, [loading, permitido, router])

  useEffect(() => {
    if (!permitido) return
    ;(async () => {
      const corte = new Date(Date.now() - dias * 86400000).toISOString()
      const out: Record<string, number | string> = {}
      const logs = async (ev: string) => {
        try {
          const r = await supabase.from("automation_logs").select("id", { count: "exact", head: true }).eq("event_type", ev).gte("created_at", corte)
          return (r as { count: number | null }).count ?? 0
        } catch { return "?" }
      }
      const jobs = async (status: string) => {
        try {
          const r = await supabase.from("automation_jobs").select("id", { count: "exact", head: true }).eq("status", status).gte("sent_at", corte)
          return (r as { count: number | null }).count ?? 0
        } catch { return "?" }
      }
      out.respostas_ia = await logs("ia_resposta_enviada")
      out.handoffs = await logs("ia_handoff_humano")
      out.reativacoes = await logs("lead_reativado_trafego_pago_reativacao_base")
      out.triagens = await logs("lead_followup_sem_resposta_triagem")
      out.msgs_enviadas = await jobs("sent")
      setVals(out)
    })()
  }, [dias, permitido])

  if (loading || !user) return <div className="py-16 text-center text-muted-foreground">Carregando...</div>
  if (!permitido) return null

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-bold">Relatórios</h1>
        <p className="text-xs text-muted-foreground">Visão somente leitura</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Atividade</CardTitle></CardHeader>
        <CardContent>
          <Select value={String(dias)} onChange={(e) => setDias(Number(e.target.value))} className="mb-3 h-8 w-40 text-xs">
            <option value="7">Últimos 7 dias</option>
            <option value="30">Últimos 30 dias</option>
          </Select>
          <div className="grid gap-2 sm:grid-cols-2">
            {[["Respostas da IA", vals.respostas_ia], ["Handoffs p/ humano", vals.handoffs], ["Reativações de base", vals.reativacoes], ["Triagens humanas", vals.triagens], ["Msgs automação enviadas", vals.msgs_enviadas]].map(([label, v]) => (
              <div key={label as string} className="rounded-lg border border-border p-3">
                <p className="text-2xl font-bold">{v === undefined ? "…" : v}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
