"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ChevronDown, ChevronRight, SearchX } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { isGestorNivel, podeVendas } from "@/lib/roles"
import { useLeads } from "@/lib/leads-store"
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Select, Skeleton } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import {
  AUDIT_TIPO_LABEL, AUDIT_TIPO_VARIANT, LEAD_STATUSES, STATUS_LABEL, STATUS_VARIANT,
  TEMPERATURAS, TEMP_LABEL, TEMP_VARIANT, fmtDateTime, refsTexto,
} from "@/lib/labels"
import { ORIGENS, type Lead } from "@/lib/mock-data"

const DIAS_PARADO = 7

// Cor do marcador da linha do tempo por tipo de evento (histórico escrito)
function auditDot(tipo: string) {
  switch (tipo) {
    case "criacao":
    case "fechamento":
      return "bg-emerald-500"
    case "exclusao":
    case "justificativa":
      return "bg-destructive"
    case "etapa":
    case "temperatura":
    case "visita":
      return "bg-amber-500"
    case "proposta":
      return "bg-primary"
    case "qualidade":
    case "responsavel":
      return "bg-slate-400"
    default:
      return "bg-sky-500"
  }
}

export default function AuditoriaPage() {
  const { user } = useAuth()
  const { leads, visits, audit, qualityNotes, corretores, userName } = useLeads()
  const [loading, setLoading] = useState(true)
  const [fCorretor, setFCorretor] = useState("todos")
  const [fStatus, setFStatus] = useState("todos")
  const [fTemp, setFTemp] = useState("todas")
  const [fOrigem, setFOrigem] = useState("todas")
  const [fRef, setFRef] = useState("")
  const [fDe, setFDe] = useState("")
  const [fAte, setFAte] = useState("")
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setLoading(false), 500)
    return () => clearTimeout(t)
  }, [])

  if (user && !podeVendas(user.role)) return null
  const isGestor = isGestorNivel(user?.role ?? "corretor")

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (fCorretor !== "todos" && l.corretorId !== fCorretor) return false
      if (fStatus !== "todos" && l.status !== fStatus) return false
      if (fTemp !== "todas" && l.temperatura !== fTemp) return false
      if (fOrigem !== "todas" && l.origem !== fOrigem) return false
      if (fRef && !refsTexto(l).toUpperCase().includes(fRef.trim().toUpperCase())) return false
      if (fDe && l.criadoEm.slice(0, 10) < fDe) return false
      if (fAte && l.criadoEm.slice(0, 10) > fAte) return false
      return true
    })
  }, [leads, fCorretor, fStatus, fTemp, fOrigem, fRef, fDe, fAte])

  function indicadores(l: Lead): string[] {
    const out: string[] = []
    if (!l.telefone) out.push("Sem telefone")
    if (!l.origem) out.push("Sem origem")
    if (!l.referencias?.length && !l.imovelRef) out.push("Sem referência")
    const dias = Math.floor((Date.now() - +new Date(l.atualizadoEm)) / 86400000)
    if (!["fechado", "perdido"].includes(l.status) && dias >= DIAS_PARADO) out.push(`Parado há ${dias} dias`)
    const leadVisits = visits.filter((v) => v.leadId === l.id)
    if (leadVisits.length > 0 && l.status === "reuniao agendada" && dias >= 3) out.push("Reunião sem retorno")
    if (l.status === "negociando" && dias >= DIAS_PARADO) out.push("Proposta sem atualização")
    return out
  }

  const totalAlertas = useMemo(() => filtered.reduce((s, l) => s + indicadores(l).length, 0), [filtered, visits])

  if (!isGestor) {
    return <p className="py-16 text-center text-muted-foreground">Acesso restrito aos gestores.</p>
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-24 w-full" />
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeading
        title="Auditoria de Leads"
        badge="Qualidade"
        subtitle={<>Conferência operacional e auditoria gerencial. {totalAlertas > 0 && <span className="font-medium text-destructive">{totalAlertas} alerta(s) de qualidade.</span>}</>}
      />

      {/* Filtros */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-3 pt-5 sm:grid-cols-3 lg:grid-cols-7">
          <Select value={fCorretor} onChange={(e) => setFCorretor(e.target.value)} aria-label="Filtrar por corretor">
            <option value="todos">Todos corretores</option>
            {corretores.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </Select>
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filtrar por status">
            <option value="todos">Todos status</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
          <Select value={fTemp} onChange={(e) => setFTemp(e.target.value)} aria-label="Filtrar por temperatura">
            <option value="todas">Todas temperaturas</option>
            {TEMPERATURAS.map((t) => <option key={t} value={t}>{TEMP_LABEL[t]}</option>)}
          </Select>
          <Select value={fOrigem} onChange={(e) => setFOrigem(e.target.value)} aria-label="Filtrar por origem">
            <option value="todas">Todas origens</option>
            {ORIGENS.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
          <Input value={fRef} onChange={(e) => setFRef(e.target.value)} placeholder="Referência..." aria-label="Filtrar por referência" />
          <Input type="date" value={fDe} onChange={(e) => setFDe(e.target.value)} aria-label="Data inicial" />
          <Input type="date" value={fAte} onChange={(e) => setFAte(e.target.value)} aria-label="Data final" />
        </CardContent>
      </Card>

      {/* Lista consolidada */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center text-muted-foreground">
          <SearchX className="size-8" />
          <p className="text-sm">Nenhum lead encontrado com os filtros aplicados.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((l) => {
            const alerts = indicadores(l)
            const timeline = audit.filter((a) => a.leadId === l.id)
            const quali = qualityNotes.filter((q) => q.leadId === l.id)
            const open = expanded === l.id
            return (
              <Card key={l.id}>
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : l.id)}
                  className="flex w-full flex-wrap items-center gap-2 p-4 text-left"
                  aria-expanded={open}
                >
                  {open ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  <span className="font-display text-sm font-semibold">{l.nome}</span>
                  <Badge variant={STATUS_VARIANT[l.status]}>{STATUS_LABEL[l.status]}</Badge>
                  <Badge variant={TEMP_VARIANT[l.temperatura]}>{TEMP_LABEL[l.temperatura]}</Badge>
                  {refsTexto(l) && <Badge variant="gray">{refsTexto(l)}</Badge>}
                  <span className="text-xs text-muted-foreground">{userName(l.corretorId)} · {l.origem}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {alerts.map((a) => (
                      <Badge key={a} variant="red" className="gap-1"><AlertTriangle className="size-3" />{a}</Badge>
                    ))}
                  </span>
                </button>
                {open && (
                  <CardContent className="border-t border-border pt-4">
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                      <div>
                        <h3 className="mb-2 text-sm font-semibold">Linha do tempo</h3>
                        {timeline.length === 0 ? (
                          <p className="py-4 text-sm text-muted-foreground">Nenhum registro de auditoria para este lead ainda.</p>
                        ) : (
                          <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
                            {timeline.map((a) => (
                              <li key={a.id} className="relative">
                                <span className={`absolute -left-[21px] top-1.5 size-2.5 rounded-full ring-4 ring-card ${auditDot(a.tipo)}`} />
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge variant={AUDIT_TIPO_VARIANT[a.tipo]}>{AUDIT_TIPO_LABEL[a.tipo]}</Badge>
                                  <span className="text-xs text-muted-foreground">{fmtDateTime(a.criadoEm)} · {a.usuarioNome}</span>
                                </div>
                                <p className="mt-0.5 text-sm">{a.descricao}</p>
                                {a.referencias && <p className="text-xs text-muted-foreground">Ref: {a.referencias}</p>}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                      <div className="flex flex-col gap-4">
                        <div>
                          <h3 className="mb-2 text-sm font-semibold">Observações de qualidade</h3>
                          {quali.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nenhuma observação registrada.</p>
                          ) : (
                            <div className="flex flex-col gap-2">
                              {quali.map((q) => (
                                <div key={q.id} className="rounded-lg bg-muted/50 p-2.5 text-sm">
                                  <p>{q.texto}</p>
                                  <p className="mt-1 text-xs text-muted-foreground">{q.autorNome} · {fmtDateTime(q.criadoEm)}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Criado em {fmtDateTime(l.criadoEm)} · Atualizado em {fmtDateTime(l.atualizadoEm)}
                          {l.refProposta && <> · Ref. proposta: {l.refProposta}</>}
                          {l.refFechamento && <> · Ref. fechamento: {l.refFechamento}</>}
                        </div>
                        <Link href={`/painel-corretor/${l.id}`} className="text-sm font-medium text-primary hover:underline">Abrir ficha do lead</Link>
                      </div>
                    </div>
                  </CardContent>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
