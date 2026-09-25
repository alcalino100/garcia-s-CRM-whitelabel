"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Search, SearchX, X } from "lucide-react"
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd"
import { Button } from "@/components/ui/button"
import { Dialog, Input, Label, Select, Textarea, useToast } from "@/components/ui/primitives"
import { LeadCard } from "@/components/lead-card"
import { LeadForm, type LeadFormValues } from "@/components/lead-form"
import { useSaleCelebration, SESSION_ID } from "@/components/sale-celebration"
import { supabase } from "@/lib/supabase/client"
import { useLeads } from "@/lib/leads-store"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel } from "@/lib/roles"
import { LEAD_STATUSES, MOTIVOS_EXCLUSAO, STATUS_ACCENT, STATUS_LABEL, TEMPERATURAS, TEMP_LABEL, brl, comTagsEntradaAutomacao, normalizePhone, refsTexto } from "@/lib/labels"
import { CORRETOR_HIDDEN } from "@/lib/pipeline-stages"
import { ORIGENS, type Lead, type LeadStatus, type Origem, type Temperatura } from "@/lib/mock-data"
import { lerFiltros, ORIGEM_SLUG, queryFiltros, STATUS_SLUG } from "@/lib/leads-filtros"
import { cn } from "@/lib/utils"

const TIPO_IMOVEL_VENDIDO = [
  "Casa",
  "Casa em condomínio fechado",
  "Apartamento",
  "Terreno",
  "Terreno em condomínio fechado",
  "Comercial - Casa",
  "Comercial - Barracão",
]

export function KanbanBoard({
  leads,
  showCorretor = false,
  currentCorretorId,
  isGestor = false,
  heightClass = "h-[calc(100vh-13rem)]",
}: {
  leads: Lead[]
  showCorretor?: boolean
  currentCorretorId: string
  isGestor?: boolean
  heightClass?: string
}) {
  const { updateLead, deleteLead, addVisit, addInteraction, notify, logChange, logAudit, assumirLead, visits, corretores, userName } = useLeads()
  const { user } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const filtros = lerFiltros(searchParams)
  const toast = useToast()
  const celebrate = useSaleCelebration()
  const [visitLead, setVisitLead] = useState<Lead | null>(null)
  const [propLead, setPropLead] = useState<Lead | null>(null)
  const [closeLead, setCloseLead] = useState<Lead | null>(null)
  const [editLead, setEditLead] = useState<Lead | null>(null)
  const [assumirDialog, setAssumirDialog] = useState<Lead | null>(null)
  const [uploadMeta, setUploadMeta] = useState<Lead | null>(null)
  const [archiveLead, setArchiveLead] = useState<Lead | null>(null)
  const [desarquivarLead, setDesarquivarLead] = useState<Lead | null>(null)
  const [delLead, setDelLead] = useState<Lead | null>(null)
  const [delMotivo, setDelMotivo] = useState("")
  const [delDetalhe, setDelDetalhe] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [tempFilter, setTempFilter] = useState<Temperatura | "todas">("todas")
  const [query, setQuery] = useState("")
  const [showArchived, setShowArchived] = useState(false)
  const [tagColorMap, setTagColorMap] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch("/api/tags")
      .then(r => r.json())
      .then(j => {
        if (!j.ok || !Array.isArray(j.tags)) return
        const map: Record<string, string> = {}
        for (const t of j.tags) map[t.name] = t.color
        setTagColorMap(map)
      })
      .catch(() => {})
  }, [])

  const usuarioNome = user ? userName(user.id) : "Sistema"
  const canManage = (lead: Lead) => isGestor || lead.corretorId === currentCorretorId

  // Persistência individual apenas para gestores: restaura ao voltar sem query; gravação é feita em updateFiltros/limparFiltros
  useEffect(() => {
    if (!isGestor || !user?.id) return
    if (typeof window === "undefined") return
    if (searchParams.toString()) return
    try {
      const saved = window.localStorage.getItem(`crm-filtros:${user.id}`)
      if (saved) router.replace(`${pathname}?${saved}`, { scroll: false })
    } catch {}
  }, [searchParams, pathname, isGestor, user?.id, router])

  function updateFiltros(patch: Record<string, string | null | undefined>) {
    const qs = new URLSearchParams(searchParams.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") qs.delete(k)
      else qs.set(k, v)
    }
    const s = qs.toString()
    if (isGestor && user?.id && typeof window !== "undefined") {
      try {
        if (s) window.localStorage.setItem(`crm-filtros:${user.id}`, s)
        else window.localStorage.removeItem(`crm-filtros:${user.id}`)
        window.dispatchEvent(new Event("crm-filtros-change"))
      } catch {}
    }
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false })
  }

  function handleEditSubmit(v: LeadFormValues) {
    if (!editLead) return
    if (v.status === "fechado" && editLead.status !== "fechado") {
      // Fechamento só é gravado pelo fluxo obrigatório (REF + tipo do imóvel vendido)
      setFRefs(editLead.refFechamento || refsTexto(editLead))
      setFTipo(editLead.tipoImovelVendido ?? "")
      setCloseLead(editLead)
      setEditLead(null)
      return
    }
    setSubmitting(true)
    const fields: (keyof LeadFormValues)[] = ["nome", "telefone", "email", "imovelRef", "origem", "observacoes", "status", "valorNegociacao", "corretorId", "temperatura"]
    for (const f of fields) {
      const before = (editLead as any)[f]
      const after = (v as any)[f]
      if (String(before ?? "") !== String(after ?? "")) {
        logChange({ usuario: usuarioNome, acao: "edicao", entidade: "lead", campo: f, valorAnterior: String(before ?? "-"), valorNovo: String(after ?? "-") })
        if (f === "temperatura") {
          logAudit({ leadId: editLead.id, leadNome: editLead.nome, usuarioNome, tipo: "temperatura", descricao: `Temperatura alterada: ${String(before)} → ${String(after)}` })
        }
        if (f === "corretorId") {
          logAudit({ leadId: editLead.id, leadNome: editLead.nome, usuarioNome, tipo: "responsavel", descricao: `Responsável alterado: ${userName(String(before))} → ${userName(String(after))}` })
          notify(`Responsável do lead ${editLead.nome} alterado para ${userName(String(after))}`, { tipo: "responsavel", paraRole: "gestor", leadId: editLead.id })
          notify(`Você agora é responsável pelo lead ${editLead.nome}`, { tipo: "responsavel", paraUsuarioId: String(after), leadId: editLead.id })
        }
      }
    }
    const refsBefore = refsTexto(editLead)
    const refsAfter = v.referencias.map((r) => r.ref).join(", ")
    if (refsBefore !== refsAfter) {
      logAudit({ leadId: editLead.id, leadNome: editLead.nome, usuarioNome, tipo: "edicao", descricao: "Referências atualizadas", referencias: refsAfter })
    }
    void (async () => {
      const result = await updateLead(editLead.id, v)
      setSubmitting(false)
      if (!result.ok) return toast(result.error ?? "Não foi possível atualizar o lead.", "error")
      setEditLead(null)
      toast("Lead atualizado com sucesso")
    })()
  }

  function closeDelete() {
    setDelLead(null)
    setDelMotivo("")
    setDelDetalhe("")
  }

  async function handleDeleteConfirm() {
    if (!delLead || submitting) return
    if (!delMotivo) return toast("Selecione o motivo da exclusão.", "error")
    if (!delDetalhe.trim()) return toast("Descreva o motivo da exclusão.", "error")
    setSubmitting(true)
    const alvo = delLead
    const res = await deleteLead(alvo.id, delMotivo, delDetalhe.trim())
    setSubmitting(false)
    if (!res.ok) {
      toast(res.error ?? "Não foi possível excluir o lead.", "error")
      return
    }
    logChange({ usuario: usuarioNome, acao: "exclusao", entidade: "lead", campo: "lead", valorAnterior: `${alvo.nome} — ${alvo.imovelRef || "sem imóvel"} (motivo: ${delMotivo})`, valorNovo: "-" })
    closeDelete()
    toast("Lead excluído com sucesso")
  }

  // visit form
  const [vData, setVData] = useState("")
  const [vHora, setVHora] = useState("10:00")
  const [vCorretor, setVCorretor] = useState("")
  const [vRefs, setVRefs] = useState("")
  const [vObs, setVObs] = useState("")
  // proposal form
  const [pValor, setPValor] = useState("")
  const [pRefs, setPRefs] = useState("")
  const [pObs, setPObs] = useState("")
  // fechamento form
  const [fRefs, setFRefs] = useState("")
  const [fTipo, setFTipo] = useState("")

  function onDragEnd(result: DropResult) {
    const { source, destination, draggableId } = result
    if (!destination || destination.droppableId === source.droppableId) return
    const newStatus = destination.droppableId as LeadStatus
    const lead = leads.find((l) => l.id === draggableId)
    if (!lead || !canManage(lead)) return
    moveLead(lead, newStatus)
  }

  function moveLead(lead: Lead, newStatus: LeadStatus) {
    if (newStatus === "fechado") {
      // status só é gravado após confirmar a referência e o tipo do imóvel vendido
      setFRefs(refsTexto(lead))
      setFTipo(lead.tipoImovelVendido ?? "")
      setCloseLead(lead)
      return
    }

    if (lead.origem === "Tráfego Pago" && newStatus === "em_automacao") {
      // Fase C — reativação: gestor moveu para "Em Automação" → reaquece (frio → morno), permanece no Tráfego Pago
      updateLead(lead.id, { status: newStatus, temperatura: "morno", referencias: comTagsEntradaAutomacao(lead.referencias) })
      logAudit({ leadId: lead.id, leadNome: lead.nome, usuarioNome, tipo: "temperatura", descricao: `Fase C — reativação de Tráfego Pago: ${lead.nome} entrou em "Em Automação"; temperatura reaquecida frio → morno (permanece no funil Tráfego Pago).` })
      notify(`${lead.nome} reativado em "Em Automação" (Tráfego Pago reaquecido por ${usuarioNome})`, { tipo: "pipeline", paraRole: "gestor", leadId: lead.id })
      toast(`Tráfego Pago reativado: ${lead.nome}`)
      return
    }

    updateLead(lead.id, { status: newStatus })
    logAudit({ leadId: lead.id, leadNome: lead.nome, usuarioNome, tipo: "etapa", descricao: `Etapa alterada: ${STATUS_LABEL[lead.status]} → ${STATUS_LABEL[newStatus]}` })
    notify(`${lead.nome} movido para "${STATUS_LABEL[newStatus]}" por ${usuarioNome}`, { tipo: "pipeline", paraRole: "gestor", leadId: lead.id })
    if (lead.corretorId && lead.corretorId !== user?.id) {
      notify(`Seu lead ${lead.nome} foi movido para "${STATUS_LABEL[newStatus]}"`, { tipo: "pipeline", paraUsuarioId: lead.corretorId, leadId: lead.id })
    }

    if (newStatus === "reuniao agendada") {
      setVData(new Date().toISOString().slice(0, 10))
      setVHora("10:00")
      setVCorretor(lead.corretorId || currentCorretorId)
      setVRefs(refsTexto(lead))
      setVObs("")
      setVisitLead(lead)
    } else if (newStatus === "negociando") {
      setPValor(lead.valorNegociacao ? String(lead.valorNegociacao) : "")
      setPRefs(lead.refProposta || refsTexto(lead))
      setPObs("")
      setPropLead(lead)
    } else {
      toast(`${lead.nome} movido para "${STATUS_LABEL[newStatus]}"`)
    }
  }

  function confirmVisit(e: React.FormEvent) {
    e.preventDefault()
    if (!visitLead || !vData) return
    if (!vRefs.trim()) {
      toast("Informe a(s) referência(s) do imóvel da visita.", "error")
      return
    }
    addVisit({ leadId: visitLead.id, data: vData, hora: vHora, corretorId: vCorretor, imovelRef: vRefs.trim(), referencias: vRefs.trim(), observacoes: vObs })
    addInteraction(visitLead.id, { corretor: userName(vCorretor), texto: `Visita agendada para ${vData.split("-").reverse().join("/")} às ${vHora} — Ref: ${vRefs.trim()}.` })
    toast("Visita agendada e enviada para a agenda.")
    setVisitLead(null)
  }

  function confirmProposal(e: React.FormEvent) {
    e.preventDefault()
    if (!propLead) return
    const valor = Number(pValor)
    if (!valor || valor <= 0) {
      toast("Informe um valor válido.", "error")
      return
    }
    if (!pRefs.trim()) {
      toast("Informe a(s) referência(s) da proposta.", "error")
      return
    }
    updateLead(propLead.id, { valorNegociacao: valor, refProposta: pRefs.trim() })
    if (pObs) addInteraction(propLead.id, { corretor: userName(propLead.corretorId), texto: pObs })
    logAudit({ leadId: propLead.id, leadNome: propLead.nome, usuarioNome, tipo: "proposta", descricao: `Proposta registrada: ${brl(valor)} por ${userName(propLead.corretorId)}`, referencias: pRefs.trim() })
    notify(`Nova proposta: ${propLead.nome} — Ref: ${pRefs.trim()} — ${brl(valor)} por ${userName(propLead.corretorId)}`, { tipo: "proposta", paraRole: "gestor", leadId: propLead.id })
    if (propLead.corretorId) {
      notify(`Proposta registrada no seu lead ${propLead.nome}: ${brl(valor)}`, { tipo: "proposta", paraUsuarioId: propLead.corretorId, leadId: propLead.id })
    }
    toast("Proposta registrada. Gestores notificados.")
    // Aviso de WhatsApp é exclusivo de VENDA (a rota recusa sem modulo:"venda").
    fetch("/api/whatsapp/notify-proposta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        nome: propLead.nome,
        valor,
        corretorNome: userName(propLead.corretorId),
        corretorId: propLead.corretorId ?? null,
        refProposta: pRefs.trim(),
        modulo: "venda",
      }),
    }).then(async (r) => {
      if (!r.ok) toast("Proposta salva, mas o aviso de WhatsApp foi bloqueado — recarregue a página (Ctrl/Cmd+Shift+R).", "error")
    }).catch(() => {})
    setPropLead(null)
  }

  function confirmClose(e: React.FormEvent) {
    e.preventDefault()
    if (!closeLead) return
    if (!fRefs.trim()) {
      toast("Informe a(s) referência(s) do fechamento.", "error")
      return
    }
    if (!fTipo) {
      toast("Selecione o tipo do imóvel vendido.", "error")
      return
    }
    updateLead(closeLead.id, { status: "fechado", refFechamento: fRefs.trim(), tipoImovelVendido: fTipo })
    logAudit({ leadId: closeLead.id, leadNome: closeLead.nome, usuarioNome, tipo: "fechamento", descricao: `Fechamento realizado por ${userName(closeLead.corretorId)} — ${brl(closeLead.valorNegociacao)} — Tipo: ${fTipo}`, referencias: fRefs.trim() })
    celebrate({
      nome: closeLead.nome,
      valor: closeLead.valorNegociacao,
      ref: fRefs.trim(),
      tipo: fTipo,
      corretor: userName(closeLead.corretorId),
    })
    // Transmite em tempo real para o corretor do lead e para os gestores
    supabase
      .channel("crm-celebracoes")
      .send({
        type: "broadcast",
        event: "sale",
        payload: {
          nome: closeLead.nome,
          valor: closeLead.valorNegociacao,
          ref: fRefs.trim(),
          tipo: fTipo,
          corretor: userName(closeLead.corretorId),
          session: SESSION_ID,
        },
      })
      .then(() => {})
    setCloseLead(null)
    fetch("/api/meta/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        lead_id: closeLead.id,
        telefone: closeLead.telefone,
        nome: closeLead.nome,
        email: closeLead.email,
        valor: closeLead.valorNegociacao,
        corretor_id: closeLead.corretorId,
        campanha_id: closeLead.metaCampaignId,
        adset_id: closeLead.metaAdsetId,
        ad_id: closeLead.metaAdId,
        utm_campaign: closeLead.utmCampaign,
        utm_adset: closeLead.utmAdset,
        utm_ad: closeLead.utmAd,
        fbc: closeLead.fbc,
        fbp: closeLead.fbp,
      }),
    }).catch(() => {})
    fetch("/api/whatsapp/notify-sale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        nome: closeLead.nome,
        valor: closeLead.valorNegociacao,
        corretorNome: userName(closeLead.corretorId),
        refFechamento: fRefs.trim(),
      }),
    }).catch(() => {})
  }

  async function handleAssumir() {
    if (!assumirDialog || !user) return
    const novoGestor = assumirDialog.gestorResponsavel ? null : user.id
    const res = await updateLead(assumirDialog.id, { gestorResponsavel: novoGestor })
    if (!res.ok) return toast(res.error ?? "Erro ao assumir lead.", "error")
    const msg = novoGestor
      ? `Gestor ${userName(user.id)} assumiu a supervisão do lead ${assumirDialog.nome}`
      : `Gestor ${userName(user.id)} removeu a supervisão do lead ${assumirDialog.nome}`
    logAudit({ leadId: assumirDialog.id, leadNome: assumirDialog.nome, usuarioNome: userName(user.id), tipo: "responsavel", descricao: msg })
    notify(msg, { tipo: "responsavel", paraRole: "gestor", leadId: assumirDialog.id })
    if (assumirDialog.corretorId) {
      notify(novoGestor ? `Seu lead ${assumirDialog.nome} foi assumido pela gestão` : `A supervisão do lead ${assumirDialog.nome} foi removida pela gestão`, { tipo: "responsavel", paraUsuarioId: assumirDialog.corretorId, leadId: assumirDialog.id })
    }
    setAssumirDialog(null)
    toast(novoGestor ? "Lead assumido com sucesso!" : "Supervisão removida.")
  }

  async function handleUploadMeta() {
    if (!uploadMeta || !user || submitting) return
    if (!isGestorNivel(user.role)) {
      setUploadMeta(null)
      return
    }
    setSubmitting(true)
    const alvo = uploadMeta
    try {
      const res = await fetch("/api/meta/lead-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: alvo.id, usuario_id: user.id }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast(data?.erro ?? "Erro ao enviar ao Meta.", "error")
        setSubmitting(false)
        return
      }
      logAudit({
        leadId: alvo.id,
        leadNome: alvo.nome,
        usuarioNome: userName(user.id),
        tipo: "edicao",
        descricao: `Enviado ao Meta (CAPI) manualmente por ${userName(user.id)} — ${brl(alvo.valorNegociacao)}${alvo.refFechamento ? ` — Ref: ${alvo.refFechamento}` : ""}`,
      })
      setUploadMeta(null)
      setSubmitting(false)
      toast(`Enviado ao Meta (${data.events_received ?? 0} evento).`)
    } catch {
      setSubmitting(false)
      toast("Falha de conexão ao enviar.", "error")
    }
  }

  async function handleArquivar() {
    if (!archiveLead || !user || submitting) return
    if (!isGestorNivel(user.role)) {
      setArchiveLead(null)
      return
    }
    setSubmitting(true)
    const alvo = archiveLead
    await updateLead(alvo.id, { arquivadoEm: new Date().toISOString() })
    logAudit({
      leadId: alvo.id,
      leadNome: alvo.nome,
      usuarioNome: userName(user.id),
      tipo: "edicao",
      descricao: `Arquivado por ${userName(user.id)}${alvo.refFechamento ? ` — Ref: ${alvo.refFechamento}` : ""}`,
    })
    if (alvo.corretorId) {
      notify(`Seu lead ${alvo.nome} foi arquivado pela gestão`, { tipo: "fechamento", paraUsuarioId: alvo.corretorId, leadId: alvo.id })
    }
    setArchiveLead(null)
    setSubmitting(false)
    toast("Lead arquivado.")
  }

  async function handleDesarquivar() {
    if (!desarquivarLead || !user || submitting) return
    if (!isGestorNivel(user.role)) {
      setDesarquivarLead(null)
      return
    }
    setSubmitting(true)
    const alvo = desarquivarLead
    await updateLead(alvo.id, { arquivadoEm: null })
    logAudit({
      leadId: alvo.id,
      leadNome: alvo.nome,
      usuarioNome: userName(user.id),
      tipo: "edicao",
      descricao: `Desarquivado por ${userName(user.id)}${alvo.refFechamento ? ` — Ref: ${alvo.refFechamento}` : ""}`,
    })
    setDesarquivarLead(null)
    setSubmitting(false)
    toast("Lead desarquivado.")
  }

  const q = query.trim().toLowerCase()
  const qDigits = normalizePhone(query)
  const matchesQuery = (l: Lead) => {
    if (!q) return true
    const refs = (l.referencias?.map((r) => r.ref).join(" ") ?? "") + " " + (l.imovelRef ?? "")
    if (qDigits && normalizePhone(l.telefone).includes(qDigits)) return true
    return (
      l.nome.toLowerCase().includes(q) ||
      refs.toLowerCase().includes(q) ||
      (l.observacoes ?? "").toLowerCase().includes(q)
    )
  }
  const dentroPeriodo = (l: Lead) => {
    if (!filtros.dataInicio && !filtros.dataFim) return true
    const d = l.atualizadoEm?.slice(0, 10) ?? l.criadoEm?.slice(0, 10) ?? ""
    if (!d) return false
    if (filtros.dataInicio && d < filtros.dataInicio) return false
    if (filtros.dataFim && d > filtros.dataFim) return false
    return true
  }
  const filtered = leads.filter(
    (l) =>
      (showArchived || !l.arquivadoEm) &&
      (tempFilter === "todas" || l.temperatura === tempFilter) &&
      (filtros.origem === "todas" || l.origem === filtros.origem) &&
      (filtros.status === "todos" || l.status === filtros.status) &&
      (isGestor || !CORRETOR_HIDDEN.has(l.status)) &&
      (filtros.corretor === "todos" || l.corretorId === filtros.corretor) &&
      (isGestor || !CORRETOR_HIDDEN.has(l.status)) &&
      dentroPeriodo(l) &&
      matchesQuery(l),
  )
  const byStatus = (s: LeadStatus) => filtered.filter((l) => l.status === s)
  const temFiltros = tempFilter !== "todas" || filtros.origem !== "todas" || filtros.status !== "todos" || filtros.corretor !== "todos" || !!filtros.dataInicio || !!filtros.dataFim || !!q
  const noResults = temFiltros && filtered.length === 0

  const limparFiltros = () => {
    setQuery("")
    setTempFilter("todas")
    if (isGestor && user?.id && typeof window !== "undefined") {
      try { window.localStorage.removeItem(`crm-filtros:${user.id}`) } catch {}
    }
    updateFiltros({ corretor: null, origem: null, status: null, data_inicio: null, data_fim: null })
  }

  const chip = (active: boolean, color?: string) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition",
      active ? (color ?? "border-primary bg-primary text-primary-foreground") : "border-border bg-card text-muted-foreground hover:text-foreground",
    )

  return (
    <>
      <div className="relative mb-3 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-primary/0 via-primary/70 to-primary/0" />
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar por nome, telefone ou ref"
            aria-label="Pesquisar leads"
            className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Limpar pesquisa"
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Temperatura:</span>
          <button type="button" onClick={() => setTempFilter("todas")} className={chip(tempFilter === "todas")}>Todas</button>
          {TEMPERATURAS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTempFilter(t)}
              className={chip(
                tempFilter === t,
                t === "quente" ? "border-red-600 bg-red-600 text-white" : t === "morno" ? "border-amber-500 bg-amber-500 text-white" : "border-slate-500 bg-slate-500 text-white",
              )}
            >
              {TEMP_LABEL[t]}
            </button>
          ))}
          <span className="ml-2 h-5 w-px bg-border" aria-hidden />
          <Select value={filtros.origem} onChange={(e) => { const v = e.target.value as Origem | "todas"; updateFiltros({ origem: v === "todas" ? null : ORIGEM_SLUG[v] }) }} aria-label="Filtrar por origem" className="w-36 text-xs">
            <option value="todas">Origem: todas</option>
            {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
          <Select value={filtros.status} onChange={(e) => { const v = e.target.value as LeadStatus | "todos"; updateFiltros({ status: v === "todos" ? null : STATUS_SLUG[v] }) }} aria-label="Filtrar por status" className="w-44 text-xs">
            <option value="todos">Status: todos</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          {isGestor && (
            <Select value={filtros.corretor} onChange={(e) => updateFiltros({ corretor: e.target.value === "todos" ? null : e.target.value })} aria-label="Filtrar por corretor" className="w-40 text-xs">
              <option value="todos">Corretor: todos</option>
              {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          )}
          <Input type="date" value={filtros.dataInicio} onChange={(e) => updateFiltros({ data_inicio: e.target.value || null })} aria-label="Filtrar por data inicial" className="h-9 w-auto text-xs" />
          <Input type="date" value={filtros.dataFim} onChange={(e) => updateFiltros({ data_fim: e.target.value || null })} aria-label="Filtrar por data final" className="h-9 w-auto text-xs" />
          {temFiltros && (
            <button type="button" onClick={limparFiltros} className="rounded-full border border-dashed border-border px-3 py-1 text-xs font-medium text-primary transition hover:border-primary/40 hover:bg-primary/5">
              Limpar filtros
            </button>
          )}
          <span className="ml-2 h-5 w-px bg-border" aria-hidden />
          <button
            type="button"
            onClick={() => setShowArchived(!showArchived)}
            className={chip(showArchived, "#a1a1aa")}
          >
            {showArchived ? "Ocultar arquivados" : "Mostrar arquivados"}
          </button>
        </div>
      </div>
      {(() => {
        const badges: { label: string; limpar: () => void }[] = []
        if (filtros.corretor !== "todos") {
          const n = corretores.find((c) => c.id === filtros.corretor)?.nome ?? filtros.corretor
          badges.push({ label: `Corretor: ${n}`, limpar: () => updateFiltros({ corretor: null }) })
        }
        if (filtros.origem !== "todas") badges.push({ label: `Origem: ${filtros.origem}`, limpar: () => updateFiltros({ origem: null }) })
        if (filtros.status !== "todos") badges.push({ label: `Status: ${STATUS_LABEL[filtros.status]}`, limpar: () => updateFiltros({ status: null }) })
        if (filtros.dataInicio || filtros.dataFim) {
          const fmt = (d: string) => (d ? d.split("-").reverse().join("/") : "—")
          badges.push({ label: `Período: ${fmt(filtros.dataInicio)} → ${fmt(filtros.dataFim)}`, limpar: () => updateFiltros({ data_inicio: null, data_fim: null }) })
        }
        if (!badges.length) return null
        return (
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Filtros ativos:</span>
            {badges.map((b, i) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 py-0.5 pl-2.5 pr-1 text-xs font-medium">
                {b.label}
                <button type="button" onClick={b.limpar} aria-label={`Remover filtro ${b.label}`} className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition hover:bg-primary/10 hover:text-foreground">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )
      })()}
      {noResults ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-card/60 py-16 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <SearchX className="size-6" />
          </div>
          <p className="text-sm font-medium text-foreground">Nenhum lead encontrado para estes filtros</p>
          <button type="button" onClick={limparFiltros} className="text-xs font-medium text-primary hover:underline">Limpar filtros</button>
        </div>
      ) : (
      <DragDropContext onDragEnd={onDragEnd}>
        <div className="kanban-scroll w-full flex-1 overflow-x-auto overflow-y-hidden pb-3">
          <div className={`flex w-max flex-nowrap gap-4 ${heightClass}`}>
          {(isGestor ? LEAD_STATUSES : LEAD_STATUSES.filter((s) => !CORRETOR_HIDDEN.has(s))).map((status) => {
            const col = byStatus(status)
            return (
              <Droppable droppableId={status} key={status}>
                {(provided, snapshot) => (
                  <div className="flex w-72 flex-shrink-0 flex-col">
                    <div className="mb-2 flex shrink-0 items-center justify-between rounded-t-xl border border-b-0 border-border bg-card px-3 py-2.5 shadow-sm" style={{ borderTopColor: STATUS_ACCENT[status], borderTopWidth: 3, boxShadow: `0 6px 18px -8px ${STATUS_ACCENT[status]}66` }}>
                      <span className="flex items-center gap-2 font-display text-[11px] font-semibold uppercase tracking-[0.08em]">
                        <span className="size-2 rounded-full" style={{ backgroundColor: STATUS_ACCENT[status] }} aria-hidden />
                        {STATUS_LABEL[status]}
                      </span>
                      <span className="flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">{col.length}</span>
                    </div>
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`-mt-2 flex min-h-32 flex-1 flex-col gap-2 overflow-y-auto rounded-b-xl border border-t-0 border-border p-2 transition-colors ${snapshot.isDraggingOver ? "bg-primary/5 ring-2 ring-inset ring-primary/30" : "bg-muted/40"}`}
                    >
                      {col.length === 0 && !snapshot.isDraggingOver && (
                        <p className="px-2 py-6 text-center text-xs text-muted-foreground">Nenhum lead nesta etapa</p>
                      )}
                      {col.map((lead, i) => (
                        <Draggable draggableId={lead.id} index={i} key={lead.id}>
                          {(dp, ds) => (
                            <div
                              ref={dp.innerRef}
                              {...dp.draggableProps}
                              {...dp.dragHandleProps}
                              style={dp.draggableProps.style}
                              className={ds.isDragging ? "opacity-60" : ""}
                            >
                              <LeadCard
                                lead={lead}
                                showCorretor={showCorretor}
                                canManage={canManage(lead)}
                                podeExcluir={isGestor}
                                isGestor={isGestor}
                                tagColorMap={tagColorMap}
                                onOpen={(item) => router.push(`/painel-corretor/${item.id}${queryFiltros(searchParams)}`)}
                                onEdit={(item) => setEditLead(item)}
                                onDelete={(item) => setDelLead(item)}
                                onAssumir={(item) => setAssumirDialog(item)}
                                onEnviarMeta={(item) => setUploadMeta(item)}
                                onArquivar={(item) => setArchiveLead(item)}
                                onDesarquivar={(item) => setDesarquivarLead(item)}
                              />
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            )
          })}
          </div>
        </div>
      </DragDropContext>
      )}

      <Dialog open={!!visitLead} onClose={() => setVisitLead(null)} title="Agendar Visita">
        <form onSubmit={confirmVisit} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Lead: <span className="font-medium text-foreground">{visitLead?.nome}</span> — {visitLead?.imovelRef || "sem imóvel"}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="vd">Data *</Label>
              <Input id="vd" type="date" value={vData} onChange={(e) => setVData(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="vh">Horário *</Label>
              <Input id="vh" type="time" value={vHora} onChange={(e) => setVHora(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vr">Referência(s) do imóvel *</Label>
            <Input id="vr" value={vRefs} onChange={(e) => setVRefs(e.target.value)} placeholder="Ex: AP-1006, CA-2005" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vc">Corretor responsável</Label>
            <Select id="vc" value={vCorretor} onChange={(e) => setVCorretor(e.target.value)}>
              {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="vo">Observações</Label>
            <Textarea id="vo" value={vObs} onChange={(e) => setVObs(e.target.value)} />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setVisitLead(null)}>Cancelar</Button>
            <Button type="submit">Agendar visita</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!propLead} onClose={() => setPropLead(null)} title="Valor da Proposta">
        <form onSubmit={confirmProposal} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Lead: <span className="font-medium text-foreground">{propLead?.nome}</span> — {propLead?.imovelRef || "sem imóvel"}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pv">Valor (R$) *</Label>
            <Input id="pv" type="number" value={pValor} onChange={(e) => setPValor(e.target.value)} placeholder="450000" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="pr">Referência(s) da proposta *</Label>
            <Input id="pr" value={pRefs} onChange={(e) => setPRefs(e.target.value)} placeholder="Ex: AP-1006" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="po">Observações</Label>
            <Textarea id="po" value={pObs} onChange={(e) => setPObs(e.target.value)} />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setPropLead(null)}>Cancelar</Button>
            <Button type="submit">Registrar proposta</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!closeLead} onClose={() => setCloseLead(null)} title="Registrar Fechamento">
        <form onSubmit={confirmClose} className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">Lead: <span className="font-medium text-foreground">{closeLead?.nome}</span> — {closeLead ? brl(closeLead.valorNegociacao) : ""}</p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="fr">Referência(s) do fechamento *</Label>
            <Input id="fr" value={fRefs} onChange={(e) => setFRefs(e.target.value)} placeholder="Ex: AP-1006" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ftipo">Tipo do imóvel vendido *</Label>
            <Select id="ftipo" value={fTipo} onChange={(e) => setFTipo(e.target.value)} aria-label="Tipo do imóvel vendido" required>
              <option value="">Selecione...</option>
              {TIPO_IMOVEL_VENDIDO.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setCloseLead(null)}>Cancelar</Button>
            <Button type="submit">Confirmar fechamento</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!editLead} onClose={() => setEditLead(null)} title="Editar Lead">
        {editLead && (
          <LeadForm
            initial={editLead}
            defaultCorretorId={editLead.corretorId}
            showCorretor={isGestor}
            showStatus
            submitting={submitting}
            onSubmit={handleEditSubmit}
            onCancel={() => setEditLead(null)}
          />
        )}
      </Dialog>

      <Dialog open={!!assumirDialog} onClose={() => setAssumirDialog(null)} title="Assumir Atendimento">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="font-medium text-foreground">{assumirDialog?.nome}</span>
            {assumirDialog && assumirDialog.corretorId && (
              <> — Corretor: <span className="font-medium text-foreground">{userName(assumirDialog.corretorId)}</span></>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {assumirDialog?.gestorResponsavel
              ? `Este lead está atualmente sob responsabilidade de ${userName(assumirDialog.gestorResponsavel)}. Deseja remover a supervisão deste lead?`
              : "Você está assumindo a supervisão deste lead. O corretor será notificado sobre sua supervisão."}
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setAssumirDialog(null)}>Cancelar</Button>
            <Button type="button" onClick={handleAssumir}>
              {assumirDialog?.gestorResponsavel ? "Remover supervisão" : "Assumir lead"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!uploadMeta} onClose={() => (!submitting ? setUploadMeta(null) : undefined)} title="Enviar ao Meta">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="font-medium text-foreground">{uploadMeta?.nome}</span>
            {uploadMeta && uploadMeta.corretorId && (
              <> — Corretor: <span className="font-medium text-foreground">{userName(uploadMeta.corretorId)}</span></>
            )}
          </p>
          {uploadMeta && (
            <p className="text-sm font-display font-semibold text-primary">{brl(uploadMeta.valorNegociacao)}{uploadMeta.refFechamento ? ` — Ref: ${uploadMeta.refFechamento}` : ""}</p>
          )}
          <p className="text-sm text-muted-foreground">
            O evento de compra será enviado ao Meta Ads. O lead <strong className="text-foreground">não</strong> será arquivado — use a opção "Arquivar" depois, se quiser.
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setUploadMeta(null)} disabled={submitting}>Cancelar</Button>
            <Button type="button" onClick={handleUploadMeta} disabled={submitting}>
              {submitting ? "Enviando…" : "Enviar ao Meta"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!archiveLead} onClose={() => (!submitting ? setArchiveLead(null) : undefined)} title="Arquivar Lead">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="font-medium text-foreground">{archiveLead?.nome}</span>
            {archiveLead && archiveLead.corretorId && (
              <> — Corretor: <span className="font-medium text-foreground">{userName(archiveLead.corretorId)}</span></>
            )}
          </p>
          {archiveLead && (
            <p className="text-sm font-display font-semibold text-primary">{brl(archiveLead.valorNegociacao)}{archiveLead.refFechamento ? ` — Ref: ${archiveLead.refFechamento}` : ""}</p>
          )}
          <p className="text-sm text-muted-foreground">
            O lead será <strong className="text-foreground">arquivado</strong> (sai do quadro, mas permanece no histórico). Nenhum evento será enviado ao Meta.
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setArchiveLead(null)} disabled={submitting}>Cancelar</Button>
            <Button type="button" onClick={handleArquivar} disabled={submitting}>
              {submitting ? "Arquivando…" : "Arquivar"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!desarquivarLead} onClose={() => (!submitting ? setDesarquivarLead(null) : undefined)} title="Desarquivar Lead">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Lead: <span className="font-medium text-foreground">{desarquivarLead?.nome}</span>
            {desarquivarLead && desarquivarLead.corretorId && (
              <> — Corretor: <span className="font-medium text-foreground">{userName(desarquivarLead.corretorId)}</span></>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            O lead voltará para o quadro (etapa: <strong className="text-foreground">{desarquivarLead ? STATUS_LABEL[desarquivarLead.status] : ""}</strong>).
          </p>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setDesarquivarLead(null)} disabled={submitting}>Cancelar</Button>
            <Button type="button" onClick={handleDesarquivar} disabled={submitting}>
              {submitting ? "Desarquivando…" : "Desarquivar"}
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!delLead} onClose={() => (!submitting ? closeDelete() : undefined)} title="Excluir Lead">
        <p className="text-sm text-muted-foreground">
          Tem certeza que deseja excluir este lead? Esta ação não pode ser desfeita e será registrada na auditoria.
        </p>
        {delLead && (
          <p className="mt-2 text-sm font-medium text-foreground">{delLead.nome} — {delLead.imovelRef || "sem imóvel"}</p>
        )}
        <div className="mt-4 grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="del-motivo">Motivo da exclusão</Label>
            <Select id="del-motivo" value={delMotivo} onChange={(e) => setDelMotivo(e.target.value)}>
              <option value="">Selecione…</option>
              {MOTIVOS_EXCLUSAO.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="del-detalhe">Detalhe (obrigatório)</Label>
            <Textarea
              id="del-detalhe"
              rows={3}
              value={delDetalhe}
              onChange={(e) => setDelDetalhe(e.target.value)}
              placeholder="Explique o motivo desta exclusão para o registro de auditoria."
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={closeDelete} disabled={submitting}>Cancelar</Button>
          <Button type="button" className="bg-destructive text-white hover:bg-destructive/90" onClick={handleDeleteConfirm} disabled={submitting}>
            {submitting ? "Excluindo…" : "Excluir"}
          </Button>
        </div>
      </Dialog>
    </>
  )
}
