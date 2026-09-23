"use client"

import { useState, use } from "react"
import Link from "next/link"
import { ArrowLeft, Clock, MessageSquarePlus, Phone, Mail, Home } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { podeLocacao } from "@/lib/roles"
import { useLocacao } from "@/lib/locacao-store"
import { Button } from "@/components/ui/button"
import { Badge, Card, CardContent, CardHeader, CardTitle, Textarea, useToast } from "@/components/ui/primitives"
import {
  LOCACAO_STATUS_LABEL,
  LOCACAO_STATUS_VARIANT,
  TEMP_LABEL,
  TEMP_VARIANT,
  brl,
  fmtDateTime,
  refsTexto,
} from "@/lib/locacao-labels"
import type { AuditTipo } from "@/lib/mock-data"

export default function LocacaoLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { user } = useAuth()
  if (!user || !podeLocacao(user.role)) return <p className="py-16 text-center text-muted-foreground">Acesso restrito à equipe de locação.</p>
  const { getLead, addInteraction } = useLocacao()
  const toast = useToast()
  const [nota, setNota] = useState("")
  const lead = getLead(id)

  if (!lead) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-muted-foreground">Lead não encontrado.</p>
        <Link href="/locacao"><Button variant="outline"><ArrowLeft className="size-4" /> Voltar</Button></Link>
      </div>
    )
  }

  function salvarNota() {
    if (!nota.trim()) return
    addInteraction(lead!.id, { corretor: user!.nome, texto: nota.trim() })
    setNota("")
    toast("Anotação registrada.")
  }

  type TimelineItem = { id: string; corretor: string; texto: string; timestamp: string; tipo: AuditTipo | "nota" }
  const notaEvents: TimelineItem[] = lead.interacoes.map((it) => ({
    id: it.id,
    corretor: it.corretor,
    texto: it.texto,
    timestamp: it.timestamp,
    tipo: "nota",
  }))
  const timeline: TimelineItem[] = [...notaEvents].sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp))
  const tipoLabel = (t: TimelineItem["tipo"]) => (t === "nota" ? "Anotação" : t)
  const tipoVariant = (t: TimelineItem["tipo"]) => (t === "nota" ? "slate" : "blue")

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link href="/locacao" className="rounded-md p-2 text-muted-foreground hover:bg-muted" aria-label="Voltar"><ArrowLeft className="size-5" /></Link>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold">
              <span className="text-foreground">{lead.nome}</span>
            </h1>
            <Badge variant={LOCACAO_STATUS_VARIANT[lead.status]}>{LOCACAO_STATUS_LABEL[lead.status]}</Badge>
            <Badge variant={TEMP_VARIANT[lead.temperatura]}>{TEMP_LABEL[lead.temperatura]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Ficha de atendimento — Locação</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader><CardTitle>Dados do lead</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <Info icon={Phone} label="Telefone" value={lead.telefone || "—"} />
            <Info icon={Mail} label="E-mail" value={lead.email || "—"} />
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">Referências do imóvel</span>
              {refsTexto(lead) ? (
                <Badge variant="default">{refsTexto(lead)}</Badge>
              ) : (
                <span className="text-sm text-muted-foreground">Nenhuma referência vinculada.</span>
              )}
            </div>
            {lead.tipoImovelDesejado && <Info icon={Home} label="Tipo de imóvel" value={lead.tipoImovelDesejado} />}
            {lead.bairrosDesejados?.length > 0 && <Info icon={Home} label="Bairros de interesse" value={lead.bairrosDesejados.join(", ")} />}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-muted-foreground">Origem</span><span className="font-medium">{lead.origem}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Aluguel máximo</span><span className="font-medium">{lead.aluguelMax ? brl(lead.aluguelMax) : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Quartos</span><span className="font-medium">{lead.quartos || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Garantia</span><span className="font-medium">{lead.garantia || "—"}</span>
            </div>
            {lead.vagas != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Vagas</span><span className="font-medium">{lead.vagas} vaga(s)</span>
              </div>
            )}
            {lead.metragemMin != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Metragem mínima</span><span className="font-medium">{lead.metragemMin} m²</span>
              </div>
            )}
            {lead.aceitaCondominio != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Aceita condomínio</span><span className="font-medium">{lead.aceitaCondominio ? "Sim" : "Não"}</span>
              </div>
            )}
            {lead.salas != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Salas</span><span className="font-medium">{lead.salas} sala(s)</span>
              </div>
            )}
            {lead.atividadeComercial && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Atividade comercial</span><span className="font-medium">{lead.atividadeComercial}</span>
              </div>
            )}
            {lead.valorAluguel != null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Valor do aluguel</span><span className="font-medium text-primary">{brl(lead.valorAluguel)}</span>
              </div>
            )}
            {lead.observacoes && <p className="rounded-lg bg-muted p-3 text-muted-foreground">{lead.observacoes}</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Histórico do Lead</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Textarea value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Adicionar nova anotação de atendimento..." aria-label="Nova anotação" />
              <div className="flex justify-end">
                <Button onClick={salvarNota} disabled={!nota.trim()}><MessageSquarePlus className="size-4" /> Adicionar anotação</Button>
              </div>
            </div>

            {timeline.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Clock className="size-5" /></div>
                <p className="text-sm font-medium text-foreground">Este lead ainda não tem histórico</p>
                <p className="text-xs text-muted-foreground">Os acontecimentos aparecerão aqui automaticamente conforme o lead avança no funil.</p>
              </div>
            ) : (
              <ol className="relative flex flex-col gap-4 border-l border-border pl-5">
                {timeline.map((it) => (
                  <li key={it.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 size-3 rounded-full bg-slate-400 ring-4 ring-card" />
                    <div className="flex flex-col gap-1.5 rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={tipoVariant(it.tipo)}>{tipoLabel(it.tipo)}</Badge>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="size-3" />{fmtDateTime(it.timestamp)}</span>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground">{it.texto}</p>
                      <p className="text-xs text-muted-foreground">por <span className="font-medium text-foreground">{it.corretor}</span></p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function Info({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></div>
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-medium">{value}</span>
      </div>
    </div>
  )
}
