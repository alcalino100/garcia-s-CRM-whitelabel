"use client"

import { Suspense, useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeVendas } from "@/lib/roles"
import { useLeads } from "@/lib/leads-store"
import { Button } from "@/components/ui/button"
import { Dialog, Skeleton, useToast } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import { KanbanBoard } from "@/components/kanban-board"
import { LeadForm, type LeadFormValues } from "@/components/lead-form"

export default function PainelCorretorPage() {
  const { user } = useAuth()
  const { leads, addLead } = useLeads()
  const toast = useToast()
  const [loading, setLoading] = useState(true)
  const [novo, setNovo] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  if (!user) return null
  if (!podeVendas(user.role)) return null
  if (user.role === "leitor") return null
  const isGestor = isGestorNivel(user.role)
  const myLeads = isGestor ? leads : leads.filter((l) => l.corretorId === user.id)

  const [creating, setCreating] = useState(false)
  async function onCreate(v: LeadFormValues) {
    setCreating(true)
    const result = await addLead(v)
    setCreating(false)
    if (!result.ok) return toast(result.error ?? "Não foi possível criar o lead.", "error")
    setNovo(false)
    toast("Lead criado com sucesso.")
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading
          title="Painel do Corretor"
          subtitle="Arraste os cards entre as etapas para atualizar o status do lead."
          badge={isGestor ? "Visão gerencial" : "Meus leads"}
        />
        <Button onClick={() => setNovo(true)}><Plus className="size-4" /> Novo Lead</Button>
      </div>

      {loading ? (
        <div className="flex w-full gap-4 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex w-72 flex-shrink-0 flex-col gap-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <Suspense fallback={<div className="h-[60vh] rounded-xl border border-dashed border-border bg-card/40" />}>
          <KanbanBoard leads={myLeads} showCorretor={isGestor} currentCorretorId={user.id} isGestor={isGestor} />
        </Suspense>
      )}

      <Dialog open={novo} onClose={() => setNovo(false)} title="Novo Lead">
        <LeadForm
          defaultCorretorId={user.id}
          showCorretor={isGestor}
          showStatus={false}
          submitting={creating}
          onSubmit={onCreate}
          onCancel={() => setNovo(false)}
        />
      </Dialog>
    </div>
  )
}
