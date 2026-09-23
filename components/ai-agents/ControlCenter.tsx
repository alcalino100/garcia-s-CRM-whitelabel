"use client"
import { useEffect, useState } from "react"
import { Activity, Clock, Tag, MessageSquare, Users, LayoutDashboard, SlidersHorizontal, Save, Loader2, Phone, ArrowUpRight, FileBarChart } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, Badge, Input, Label, Select } from "@/components/ui/primitives"
import { useToast } from "@/components/ui/primitives"
import { cn } from "@/lib/utils"
import { DAY_LABELS } from "@/lib/ai/rules"
import type { AgentRules } from "@/lib/ai/rules"

type Conversa = {
  convId: string; status: string; ai_responding: boolean; canal: string
  telefone: string | null; instancia: string | null
  lead: { id: string; nome: string; status: string; origem: string } | null
  tags: string[]; nome: string
  primeiraResposta: string | null; ultimaMensagem: string | null
  dia: string; hora: string; diaSemana: string; totalMensagensIa: number
}
type Dash = {
  ok: boolean
  agente: any
  resumo: { conversas: number; mensagens: number; ativas: number; pausadas: number; comLead: number; porDia: { dia:string; conversas:number; mensagens:number }[]; porTag: Record<string,number>; porInstancia: Record<string,number>; todasTags: string[] }
  conversas: Conversa[]
}
type Instancia = { instance_name: string; corretorNome: string; status: string }
type Contexto = { origens: string[]; statuses: string[]; tags: string[] }

const DEFAULTS: AgentRules = {
  enable: true,
  schedule: { enabled: true, days: [1,2,3,4,5,6], start: "08:00", end: "19:00", timezone: "America/Sao_Paulo" },
  target: { origensPermitidas: ["Tráfego Pago"], tags: [], tagsModo: "none", numeroTeste: [], statusBloqueados: ["perdido","escalated"] },
  style: { maxLines: 2, maxQuestions: 1, emojis: "poucos", tom: "acolhedor, claro e direto", proativarReativacao: true, saudacaoDefault: "", responseMode: "auto", waitMs: 0, maxMessages: 0 },
  coordination: { paraleloComAutomacao: false, pausarPorInatividade: false, tempoInatividadeMin: 30 },
  channels: ["whatsapp"],
  whitelistInstances: [],
}

function toggleVal<R> (arr: R[], v: R): R[] { return arr.includes(v) ? arr.filter(x=>x!==v) : [...arr, v] }

export function ControlCenter({ id }: { id: string }) {
  const [aba, setAba] = useState<"dashboard"|"regras">("dashboard")
  const toast = useToast()
  const [dash, setDash] = useState<Dash | null>(null)
  const [loading, setLoading] = useState(true)
  const [instancias, setInstancias] = useState<Instancia[]>([])
  const [contexto, setContexto] = useState<Contexto | null>(null)
  const [rules, setRules] = useState<AgentRules>(DEFAULTS)
  const [saving, setSaving] = useState(false)
  const [dias, setDias] = useState(7)
  const [novoNumero, setNovoNumero] = useState("")

  const soDigitos = (v: string) => (v || "").replace(/\D/g, "")
  const normalizaNumero = (v: string) => {
    const d = soDigitos(v)
    return d.length > 11 && d.startsWith("55") ? d.slice(2) : d
  }

  function addNumeroTeste() {
    const d = soDigitos(novoNumero)
    if (d.length < 10 || d.length > 13) {
      toast("Número inválido — use DDD + número (ex.: 18991976332).", "error")
      return
    }
    const norm = normalizaNumero(d)
    if (rules.target.numeroTeste.some((n) => normalizaNumero(n) === norm)) {
      toast("Esse número já está na lista.", "error")
      return
    }
    setRules({ ...rules, target: { ...rules.target, numeroTeste: [...rules.target.numeroTeste, d] } })
    setNovoNumero("")
  }

  function removerNumeroTeste(n: string) {
    setRules({ ...rules, target: { ...rules.target, numeroTeste: rules.target.numeroTeste.filter((x) => x !== n) } })
  }

  useEffect(() => { carregar(dias) }, [id])
  useEffect(() => { carregarInstancias(); carregarContexto() }, [])

  async function carregarContexto() {
    try {
      const r = await fetch("/api/ai/contexto")
      const j = await r.json()
      if (j.ok && j.contexto) setContexto(j.contexto)
    } catch {}
  }

  async function carregar(days: number) {
    setLoading(true)
    try {
      const r = await fetch(`/api/ai/${id}/dashboard?days=${days}`)
      const j = await r.json()
      if (j.ok) {
        setDash(j)
        setRules(j.regras ? { ...DEFAULTS, ...j.regras } : DEFAULTS)
      }
    } catch {}
    setLoading(false)
  }

  async function carregarInstancias() {
    try { const r = await fetch("/api/whatsapp/instancias"); const j = await r.json(); if (Array.isArray(j)) setInstancias(j) } catch {}
  }

  async function salvarRegras() {
    setSaving(true)
    try {
      const r = await fetch(`/api/ai/${id}`, { method:"PUT", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ rules }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || "falha")
      toast("Regras de atendimento salvas")
    } catch (e:any) { toast(e.message || "Erro ao salvar", "error") }
    setSaving(false)
  }

  const maxMsg = dash ? Math.max(1, ...dash.resumo.porDia.map(d=>d.mensagens)) : 1
  const maxConv = dash ? Math.max(1, ...dash.resumo.porDia.map(d=>d.conversas)) : 1
  const instTotal = Object.entries(dash?.resumo.porInstancia || {}).map(([k,v])=>({ instancia: k, count: v }))
  const tagsTotal = Object.entries(dash?.resumo.porTag || {}).map(([k,v])=>({ tag: k, count: v }))

  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600"><FileBarChart className="size-5" /></div>
        <div>
          <h3 className="font-display text-base font-bold">Centro de Controle — Atendimento IA</h3>
          <p className="text-xs text-muted-foreground">Quem está sendo respondido, quando, onde e como — com controle de regras estilo GoHighLevel</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border">
        <button onClick={()=>setAba("dashboard")} className={cn("flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium", aba==="dashboard" ? "border-cyan-500 text-cyan-600" : "border-transparent text-muted-foreground hover:text-foreground")}><LayoutDashboard className="size-3.5" /> Dashboard de Atendimento</button>
        <button onClick={()=>setAba("regras")} className={cn("flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium", aba==="regras" ? "border-cyan-500 text-cyan-600" : "border-transparent text-muted-foreground hover:text-foreground")}><SlidersHorizontal className="size-3.5" /> Regras (quem/quando/onde/como)</button>
      </div>

      {/* ================= DASHBOARD ================= */}
      {aba==="dashboard" && (
        <>
          {loading ? <p className="py-10 text-center text-sm text-muted-foreground">Carregando dashboard…</p> :
          !dash ? <p className="py-10 text-center text-sm text-muted-foreground">Sem dados ainda.</p> :
          <div className="grid gap-4">
            {/* KPIs */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{dash.resumo.conversas}</p><p className="text-xs text-muted-foreground">Conversas {dias}d</p></CardContent></Card>
              <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold">{dash.resumo.mensagens}</p><p className="text-xs text-muted-foreground">Respostas IA</p></CardContent></Card>
              <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-emerald-600">{dash.resumo.ativas}</p><p className="text-xs text-muted-foreground">Ativas</p></CardContent></Card>
              <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-amber-600">{dash.resumo.pausadas}</p><p className="text-xs text-muted-foreground">Pausadas</p></CardContent></Card>
              <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-bold text-cyan-600">{dash.resumo.comLead}</p><p className="text-xs text-muted-foreground">Com lead</p></CardContent></Card>
            </div>

            {/* Seletor de periodo + gráfico */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm"><Activity className="size-4" /> Mensagens da IA por dia</CardTitle>
                <select value={dias} onChange={(e)=>setDias(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-background px-2 text-xs">
                  {[1,3,7,15,30].map(d=><option key={d} value={d}>{d} dias</option>)}
                </select>
              </CardHeader>
              <CardContent>
                <div className="flex h-40 items-end gap-1">
                  {dash.resumo.porDia.map(d=>(
                    <div key={d.dia} className="group relative flex flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] text-muted-foreground">{d.mensagens || ""}</span>
                      <div className="w-full rounded-t bg-cyan-500/70 transition group-hover:bg-cyan-500" style={{ height: `${(d.mensagens/maxMsg)*100}%`, minHeight: d.mensagens ? 4 : 2 }} title={`${d.dia}: ${d.mensagens} respostas, ${d.conversas} conversas`} />
                      <span className="text-[9px] text-muted-foreground">{d.dia.slice(5)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Por instância e por tag */}
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Phone className="size-4" /> Instâncias que a IA respondeu</CardTitle></CardHeader>
                <CardContent className="grid gap-2">
                  {instTotal.length===0 && <p className="text-xs text-muted-foreground">Nenhuma resposta enviada ainda.</p>}
                  {instTotal.map(({instancia,count})=>(
                    <div key={instancia} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <span className="truncate font-medium">{instancia}</span>
                      <Badge variant="blue">{count} respostas</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Tag className="size-4" /> Respostas por tag do lead</CardTitle></CardHeader>
                <CardContent className="grid gap-2">
                  {tagsTotal.length===0 && <p className="text-xs text-muted-foreground">Nenhuma tag registrada nos leads respondidos.</p>}
                  {tagsTotal.map(({tag,count})=>(
                    <div key={tag} className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2 text-sm">
                      <span className="truncate font-mono">#{tag}</span>
                      <Badge variant="teal">{count}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>

            {/* Tabela de conversas */}
            <Card>
              <CardHeader className="flex items-center gap-2"><CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" /> Quem foi respondido (últimas {dash.conversas.length})</CardTitle></CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <th className="py-2 pr-3">Contato / Lead</th>
                        <th className="py-2 pr-3">Instância</th>
                        <th className="py-2 pr-3">Tags</th>
                        <th className="py-2 pr-3">Quando (1ª)</th>
                        <th className="py-2 pr-3">Última</th>
                        <th className="py-2 pr-3">Respostas</th>
                        <th className="py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.conversas.map(c=>(
                        <tr key={c.convId} className="border-b border-border/50 last:border-0">
                          <td className="py-2 pr-3"><span className="font-medium">{c.nome}</span>{c.telefone && <span className="block text-xs text-muted-foreground">{c.telefone}</span>}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{c.instancia || c.canal}</td>
                          <td className="py-2 pr-3">{c.tags.slice(0,3).map(t=><Badge key={t} variant="teal" className="mr-1 font-mono">#{t}</Badge>)}{c.tags.length>3 && <span className="text-xs text-muted-foreground">+{c.tags.length-3}</span>}</td>
                          <td className="py-2 pr-3 text-xs">{c.primeiraResposta}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">{c.ultimaMensagem}</td>
                          <td className="py-2 pr-3"><Badge variant={c.totalMensagensIa?"blue":"gray"}>{c.totalMensagensIa}</Badge></td>
                          <td className="py-2">{c.ai_responding === false ? <Badge variant="amber">Pausada</Badge> : c.status==="active" ? <Badge variant="green">Ativa</Badge> : <Badge variant="gray">{c.status}</Badge>}</td>
                        </tr>
                      ))}
                      {dash.conversas.length===0 && <tr><td colSpan={7} className="py-6 text-center text-sm text-muted-foreground">Nenhuma conversa no período.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>}
        </>
      )}

      {/* ================= REGRAS ================= */}
      {aba==="regras" && (
        <div className="grid gap-4">
          {/* Master switch */}
          <Card className={cn("border-l-4", rules.enable ? "border-l-emerald-500" : "border-l-red-500")}>
            <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("flex size-10 items-center justify-center rounded-full", rules.enable ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600")}>
                  {rules.enable ? <MessageSquare className="size-5" /> : <Clock className="size-5" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">Automação de resposta deste agente</p>
                  <p className="text-xs text-muted-foreground">{rules.enable ? "Ativa — a IA responde às mensagens conforme as regras abaixo." : "Desativada — este agente não responde à nenhuma mensagem."}</p>
                </div>
              </div>
              <button onClick={()=>setRules({...rules, enable: !rules.enable})} className={cn("relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition", rules.enable ? "bg-emerald-500" : "bg-slate-300")}>
                <span className={cn("absolute size-5 rounded-full bg-white transition", rules.enable ? "left-6" : "left-1")} />
              </button>
            </CardContent>
          </Card>

          {/* QUEM */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Users className="size-4" /> QUEM responder</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <Label>Origens permitidas (deixe vazio = todas)</Label>
                <Input value={rules.target.origensPermitidas.join(", ")} placeholder="Tráfego Pago, Orgânico…" onChange={e=>setRules({...rules, target:{...rules.target, origensPermitidas: e.target.value.split(",").map(s=>s.trim()).filter(Boolean)}})} />
                {contexto && contexto.origens.length>0 && <div className="flex flex-wrap gap-1 pt-1">{contexto.origens.map(o=>(
                  <button key={o} onClick={()=>setRules({...rules, target:{...rules.target, origensPermitidas: toggleVal(rules.target.origensPermitidas, o)}})} title="Origem real do CRM" className={cn("rounded-full border px-2 py-0.5 text-[11px]", rules.target.origensPermitidas.some(x=>x.toLowerCase()===o.toLowerCase()) ? "border-cyan-500 bg-cyan-500/10 text-cyan-700" : "border-border text-muted-foreground")}>{o}</button>
                ))}</div>}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label>Tags obrigatórias</Label>
                  <Input value={rules.target.tags.join(", ")} placeholder="teste-ia, novo lead…" onChange={e=>setRules({...rules, target:{...rules.target, tags: e.target.value.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean)}})} />
                  {dash && dash.resumo.todasTags.length>0 && <div className="flex flex-wrap gap-1 pt-1">{dash.resumo.todasTags.slice(0,10).map(t=>(
                    <button key={t} onClick={()=>setRules({...rules, target:{...rules.target, tags: toggleVal(rules.target.tags, t)}})} className={cn("rounded-full border px-2 py-0.5 text-[11px]", rules.target.tags.includes(t) ? "border-cyan-500 bg-cyan-500/10 text-cyan-700" : "border-border text-muted-foreground")}>#{t}</button>
                  ))}</div>}
                </div>
                <div className="grid gap-1.5">
                  <Label>Modo das tags</Label>
                  <Select value={rules.target.tagsModo} onChange={e=>setRules({...rules, target:{...rules.target, tagsModo: e.target.value as any}})}>
                    <option value="none">Ignorar tags (qualquer lead da origem)</option>
                    <option value="any">Qualquer uma das tags</option>
                    <option value="all">Todas as tags</option>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Números de teste — vários ao mesmo tempo ({rules.target.numeroTeste.length})</Label>
                <p className="text-xs text-muted-foreground">Cada número tem conversa e resposta próprias (sem cruzamento). Vale com ou sem 55. Não esqueça de Salvar.</p>
                {rules.target.numeroTeste.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {rules.target.numeroTeste.map((n) => (
                      <span key={n} className="flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-mono text-[11px] text-cyan-700 dark:text-cyan-300">
                        {n}
                        <button type="button" onClick={() => removerNumeroTeste(n)} aria-label={`Remover ${n}`} className="font-bold hover:text-red-500">×</button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhum número — só leads aptos recebem resposta.</p>
                )}
                <div className="flex gap-2">
                  <Input value={novoNumero} onChange={(e) => setNovoNumero(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNumeroTeste() }} placeholder="Ex.: 18991976332" inputMode="tel" className="font-mono" />
                  <button type="button" onClick={addNumeroTeste} className={cn("shrink-0 rounded-lg bg-cyan-500 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-600")}>+ Adicionar</button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Status de lead que a IA NUNCA responde</Label>
                <Input value={rules.target.statusBloqueados.join(", ")} placeholder="perdido, escalated" onChange={e=>setRules({...rules, target:{...rules.target, statusBloqueados: e.target.value.split(",").map(s=>s.trim().toLowerCase()).filter(Boolean)}})} />
                {contexto && contexto.statuses.length>0 && <div className="flex flex-wrap gap-1 pt-1">{contexto.statuses.map(s=>{
                  const ativo = rules.target.statusBloqueados.includes(s.toLowerCase())
                  return <button key={s} onClick={()=>setRules({...rules, target:{...rules.target, statusBloqueados: toggleVal(rules.target.statusBloqueados, s.toLowerCase())}})} title="Status real do CRM" className={cn("rounded-full border px-2 py-0.5 text-[11px]", ativo ? "border-red-400 bg-red-50 text-red-600" : "border-border text-muted-foreground")}>{s}{ativo ? " (bloqueado)" : ""}</button>
                })}</div>}
              </div>
            </CardContent>
          </Card>

          {/* QUANDO */}
          <Card>
            <CardHeader className="flex items-center gap-2"><CardTitle className="flex items-center gap-2 text-sm"><Clock className="size-4" /> QUANDO responder</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex items-center justify-between">
                <Label>Respeitar horário comercial</Label>
                <button onClick={()=>setRules({...rules, schedule:{...rules.schedule, enabled: !rules.schedule.enabled}})} className={cn("relative inline-flex h-6 w-11 items-center rounded-full", rules.schedule.enabled ? "bg-cyan-500" : "bg-slate-300")}><span className={cn("absolute size-4 rounded-full bg-white", rules.schedule.enabled ? "left-6" : "left-1")} /></button>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div className="grid gap-1.5"><Label>Início</Label><Input type="time" value={rules.schedule.start} onChange={e=>setRules({...rules, schedule:{...rules.schedule, start: e.target.value}})} /></div>
                <div className="grid gap-1.5"><Label>Fim</Label><Input type="time" value={rules.schedule.end} onChange={e=>setRules({...rules, schedule:{...rules.schedule, end: e.target.value}})} /></div>
                <div className="grid gap-1.5"><Label>Fuso</Label><Select value={rules.schedule.timezone} onChange={e=>setRules({...rules, schedule:{...rules.schedule, timezone: e.target.value}})}><option value="America/Sao_Paulo">São Paulo (GMT-3)</option><option value="America/Manaus">Manaus (GMT-4)</option><option value="UTC">UTC</option></Select></div>
                <div className="grid gap-1.5"><Label>Dias</Label><div className="flex flex-wrap gap-1">
                  {DAY_LABELS.map((d,i)=>(<button key={d} onClick={()=>setRules({...rules, schedule:{...rules.schedule, days: toggleVal(rules.schedule.days, i)}})} className={cn("h-7 rounded-md px-2 text-[11px]", rules.schedule.days.includes(i) ? "bg-cyan-500 text-white" : "bg-muted text-muted-foreground")}>{d.slice(0,3)}</button>))}
                </div></div>
              </div>
            </CardContent>
          </Card>

          {/* PARALELO E AUTOMAÇÃO */}
          <Card>
            <CardHeader className="flex items-center gap-2"><CardTitle className="flex items-center gap-2 text-sm"><ArrowUpRight className="size-4" /> PARALELO COM A AUTOMAÇÃO</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-semibold">IA trabalha em paralelo com a automação</p>
                  <p className="text-xs text-muted-foreground">Desligado (recomendado): a automação de follow-up/reativação NÃO envia para leads com conversa IA ativa — evita mensagens duplicadas. Ligado: IA e automação agem independentes para o mesmo lead.</p>
                </div>
                <button onClick={()=>setRules({...rules, coordination:{...rules.coordination, paraleloComAutomacao: !rules.coordination.paraleloComAutomacao}})} className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", rules.coordination.paraleloComAutomacao ? "bg-amber-500" : "bg-emerald-500")}><span className={cn("absolute size-4 rounded-full bg-white transition", rules.coordination.paraleloComAutomacao ? "left-6" : "left-1")} /></button>
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-semibold">Pausar por inatividade</p>
                  <p className="text-xs text-muted-foreground">Se o lead não responder em X minutos, a IA pausa a conversa e devolve o lead para a automação seguir.</p>
                </div>
                <button onClick={()=>setRules({...rules, coordination:{...rules.coordination, pausarPorInatividade: !rules.coordination.pausarPorInatividade}})} className={cn("relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition", rules.coordination.pausarPorInatividade ? "bg-cyan-500" : "bg-slate-300")}><span className={cn("absolute size-4 rounded-full bg-white transition", rules.coordination.pausarPorInatividade ? "left-6" : "left-1")} /></button>
              </div>
              <div className="grid gap-1.5 max-w-48">
                <Label>Tempo de inatividade (minutos)</Label>
                <Input type="number" min={1} max={1440} value={rules.coordination.tempoInatividadeMin} onChange={e=>setRules({...rules, coordination:{...rules.coordination, tempoInatividadeMin: Number(e.target.value)||30}})} />
              </div>
            </CardContent>
          </Card>

          {/* ONDE */}
          <Card>
            <CardHeader className="flex items-center gap-2"><CardTitle className="flex items-center gap-2 text-sm"><Phone className="size-4" /> ONDE responder</CardTitle></CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid gap-2">
                <Label>Instâncias vinculadas</Label>
                <div className="grid gap-2 sm:grid-cols-2">
                  {instancias.map(inst=>{
                    const on = rules.whitelistInstances.includes(inst.instance_name)
                    return (
                      <button key={inst.instance_name} onClick={()=>setRules({...rules, whitelistInstances: toggleVal(rules.whitelistInstances, inst.instance_name)})} className={cn("flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition", on ? "border-cyan-500 bg-cyan-500/10" : "border-border hover:bg-muted")}>
                        <span className="truncate"><span className="font-medium">{inst.instance_name}</span><span className="block text-[11px] text-muted-foreground">{inst.corretorNome}</span></span>
                        {on && <Badge variant="blue">Responder</Badge>}
                      </button>
                    )
                  })}
                </div>
                <p className="text-[11px] text-muted-foreground">Dica: o teste rápido (Bot Settings) também marca uma instância como vinculada — soma com estas.</p>
              </div>
            </CardContent>
          </Card>

          {/* COMO */}
          <Card>
            <CardHeader className="flex items-center gap-2"><CardTitle className="flex items-center gap-2 text-sm"><MessageSquare className="size-4" /> COMO responder (estilo)</CardTitle></CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-1.5"><Label>Tom</Label><Input value={rules.style.tom} onChange={e=>setRules({...rules, style:{...rules.style, tom: e.target.value}})} placeholder="acolhedor, claro e direto" /></div>
              <div className="grid gap-1.5"><Label>Emojis</Label><Select value={rules.style.emojis} onChange={e=>setRules({...rules, style:{...rules.style, emojis: e.target.value as any}})}><option value="none">Nenhum</option><option value="poucos">Poucos (máx. 1)</option><option value="normal">Com moderação</option></Select></div>
              <div className="grid gap-1.5"><Label>Máx. de linhas por resposta</Label><Input type="number" min={1} max={10} value={rules.style.maxLines} onChange={e=>setRules({...rules, style:{...rules.style, maxLines: Number(e.target.value)||2}})} /></div>
              <div className="grid gap-1.5"><Label>Perguntas por mensagem</Label><Select value={rules.style.maxQuestions} onChange={e=>setRules({...rules, style:{...rules.style, maxQuestions: Number(e.target.value)}})}><option value={1}>1</option><option value={2}>2</option><option value={3}>3</option></Select></div>
              <div className="grid gap-1.5"><Label>Modo de resposta</Label><Select value={rules.style.responseMode} onChange={e=>setRules({...rules, style:{...rules.style, responseMode: e.target.value as any}})}><option value="auto">Automático (envia direto)</option><option value="sugestao">Sugestão (humano aprova)</option></Select></div>
              <div className="grid gap-1.5"><Label>Espera antes de responder (ms)</Label><Input type="number" min={0} max={15000} step={500} value={rules.style.waitMs} onChange={e=>setRules({...rules, style:{...rules.style, waitMs: Number(e.target.value)||0}})} /></div>
              <div className="grid gap-1.5"><Label>Máx. respostas da IA por conversa (0 = ilimitado)</Label><Input type="number" min={0} max={100} value={rules.style.maxMessages} onChange={e=>setRules({...rules, style:{...rules.style, maxMessages: Number(e.target.value)||0}})} /></div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Saudação padrão (1ª mensagem — <code>{"{nome_ia}"}</code> é substituído)</Label>
                <Input value={rules.style.saudacaoDefault} onChange={e=>setRules({...rules, style:{...rules.style, saudacaoDefault: e.target.value}})} placeholder="Olá! Sou {nome_ia}. Como posso ajudar?" />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={rules.style.proativarReativacao} onChange={e=>setRules({...rules, style:{...rules.style, proativarReativacao: e.target.checked}})} className="size-4" />
                  Reativar base: relembrar imóvel/follow-up do lead quando a reativação iniciar
                </label>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-end gap-2">
            <button onClick={salvarRegras} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Salvar regras
            </button>
          </div>
        </div>
      )}
    </div>
  )
}