"use client"
import { useEffect, useState } from "react"
import { InboxList, InboxSkeleton } from "./InboxList"
import { ConversaView, ConversaSkeleton } from "./ConversaView"
import { WidgetPanel } from "./WidgetPanel"
import { PanelBoundary } from "./PanelBoundary"
import { useInboxStore } from "@/lib/inbox-store"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase/client"
import { isTelefoneBloqueado } from "@/lib/telefones-bloqueados"
import { Select } from "@/components/ui/primitives"
import type { InboxConversation } from "@/lib/inbox-mock"

function InstanceSelector(){
  const instancia = useInboxStore(s=>s.instanciaSelecionada)
  const setInstancia = useInboxStore(s=>s.setInstancia)
  const [lista, setLista] = useState<{instance_name:string; corretorNome:string; status:string}[]>([])
  useEffect(()=>{
    try{ const saved = localStorage.getItem("inbox-instancia"); if(saved && saved!==instancia) setInstancia(saved)}catch{}
    fetch("/api/whatsapp/instancias").then(r=>r.json()).then(j=>{
      const data = (j.data || []).filter((x:any)=> x.status==="conectado")
      setLista(data)
      // Auto-cura: seleção salva/default pode apontar para instância desconectada
      // (ex.: caiu na sexta) — nesse caso a lista vinha sempre vazia. Corrige
      // para a primeira conectada em vez de consultar instância morta.
      try {
        const atual = localStorage.getItem("inbox-instancia") || instancia
        if (data.length && !data.some((x:any)=> x.instance_name===atual)) {
          setInstancia(data[0].instance_name)
        }
      } catch {}
    }).catch(()=>{})
  },[])
  if(lista.length===0) return <span className="text-slate-500">{instancia}</span>
  return (
    <Select value={instancia} onChange={e=>setInstancia(e.target.value)} className="h-8 w-auto min-w-[180px] text-xs">
      {lista.map(i=> <option key={i.instance_name} value={i.instance_name}>{i.corretorNome} — {i.instance_name}</option>)}
    </Select>
  )
}

function isGestorVendasRole(role: string){
  const r = role as any
  const isGestor = r !== "corretor" && r !== "corretor_vendas" && r !== "corretor_locacao"
  const podeVendas = r === "corretor" || r === "gestor" || r === "gestor_master" || r === "corretor_vendas" || r === "gestor_vendas"
  return isGestor && podeVendas
}

const PATRICIA_ID = "6c2875b4-0d11-4370-b9fd-3c13b5257bd4"
const PATRICIA_INSTANCE = "patricia-6c2875b4"

function mapStatus(s: string): "aguardando_resposta" | "respondido" | "em_follow_up" | "escalated" {
  if(s==="escalated" || s==="escalado") return "escalated" as any
  if(s==="em_followup" || s==="em_follow_up") return "em_follow_up"
  if(s==="novo" || s==="em_atendimento" || s==="atendimento_humano" || s==="aguardando") return "aguardando_resposta"
  return "respondido"
}

export function InboxClient(){
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  // Filtro "Somente Tráfego Pago" ligado por padrão (base da IA), com a escolha
  // persistida — conversas sem lead ficam ocultas com ele ativo (ver contador).
  const [filtroTrafego, setFiltroTrafego] = useState(() => {
    try { return localStorage.getItem("inbox-filtro-trafego") !== "off" } catch { return true }
  })
  const [ocultas, setOcultas] = useState(0)
  const [ocultasBloq, setOcultasBloq] = useState(0)
  const [mostrarBloqueados, setMostrarBloqueados] = useState(() => {
    try { return localStorage.getItem("inbox-mostrar-bloqueados") === "on" } catch { return false }
  })
  const selectedId = useInboxStore(s=>s.selectedId)
  const setSelected = useInboxStore(s=>s.setSelected)
  const setConversas = useInboxStore(s=>s.setConversas)
  const setModoReal = useInboxStore(s=>s.setModoReal)
  const instanciaSelecionada = useInboxStore(s=>s.instanciaSelecionada)
  const isGestorVendas = !!user && isGestorVendasRole(user.role)

  useEffect(()=>{ const t=setTimeout(()=>setLoading(false),800); return()=>clearTimeout(t)},[])

  if(user && !isGestorVendas){
    return <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">Acesso restrito a gestores de Vendas (Patrícia, Guilherme, Kleber). Ricardo e equipe de Locação não têm acesso a esta base.</div>
  }

  // Fase 2: fonte primária = conversas WhatsApp da instância selecionada, enriquece com leads, filtro Tráfego Pago como toggle
  useEffect(()=>{
    if(!isGestorVendas || !user) return
    let cancelled=false
    async function loadReal(){
      try{
        const inst = instanciaSelecionada || PATRICIA_INSTANCE
        const r = await fetch(`/api/whatsapp/chat/conversas?instanceName=${inst}`)
        const j = await r.json()
        const raw: any[] = j.conversas || []
        if(cancelled) return
        // Bloqueados internos ficam ocultos — EXCETO quando há lead vinculado
        // (lead criado manualmente = intenção explícita de acompanhar) ou quando
        // o gestor ativa "Mostrar bloqueados".
        const aposBloqueio = mostrarBloqueados
          ? raw
          : raw.filter((c:any)=> c.leadId || !isTelefoneBloqueado(c.telefone || ""))
        if(!cancelled){
          setOcultasBloq(mostrarBloqueados ? 0 : raw.filter((c:any)=> !c.leadId && isTelefoneBloqueado(c.telefone || "")).length)
        }
        const leadIds = aposBloqueio.filter(c=>c.leadId).map(c=>c.leadId)
        let leadsMap = new Map<string, any>()
        if(leadIds.length>0){
          const { data: leads } = await supabase.from("leads").select("id,origem,status,referencias").in("id", leadIds)
          for(const l of leads||[]) leadsMap.set(l.id, l)
        }
        let filtradas = aposBloqueio
        if(filtroTrafego){
          filtradas = filtradas.filter(c=>{
            if(!c.leadId) return false
            const l = leadsMap.get(c.leadId)
            if(l?.origem !== "Tráfego Pago") return false
            // Teste-IA / tags do lead sempre visíveis no filtro Tráfego Pago
            return true
          })
        }
        if(!cancelled) setOcultas(Math.max(0, raw.length - filtradas.length))
        // Nome do responsável vem da instância selecionada
        const respNome = inst.split("-")[0] || "Patricia"
        const conversas: InboxConversation[] = filtradas.map((c:any)=>({
          id: `real-${c.leadId || c.telefone}`,
          leadId: c.leadId || "",
          leadName: c.nome || c.nomeContato || c.telefone || "Sem nome",
          responsavel: respNome,
          telefone: c.telefone || "",
          email: "",
          status: c.leadId && leadsMap.get(c.leadId) ? mapStatus(leadsMap.get(c.leadId).status) : (c.status ? mapStatus(c.status) : "aguardando_resposta"),
          leadStatus: c.leadId && leadsMap.get(c.leadId) ? (leadsMap.get(c.leadId).status as string) : (c.leadStatus ?? undefined),
          followUpAtivo: c.iaRespondendo !== undefined ? c.iaRespondendo : (c.leadId ? leadsMap.get(c.leadId)?.status === "em_followup" : false),
          tentativasRestantes: c.leadId && leadsMap.get(c.leadId)?.status === "em_followup" ? 2 : undefined,
          proximaTentativaISO: c.leadId && leadsMap.get(c.leadId)?.status === "em_followup" ? new Date(Date.now()+2*3600_000).toISOString() : undefined,
          ultimaMensagem: c.ultima || "",
          timestamp: c.ultimaEm || new Date().toISOString(),
          unread: c.leadId && leadsMap.get(c.leadId)?.status === "novo" ? 1 : 0,
          origem: "WhatsApp" as const,
          iaRespondendo: c.iaRespondendo,
          tags: c.tags || [],
          ia: c.ia && typeof c.ia.responde === "boolean" ? { responde: c.ia.responde, motivo: String(c.ia.motivo || "") } : undefined,
        }))
        if(!cancelled){
          if(conversas.length>0){
            setConversas(conversas)
            setModoReal(true)
          } else {
            setConversas([])
            setModoReal(true)
          }
        }
      }catch{}
    }
    loadReal()
    // Atualização ao vivo: polling a cada 15s (pausa com aba oculta) + ao voltar o foco.
    // Sem isso, mensagens novas só apareciam recarregando a página.
    const iv = setInterval(()=>{ if(!document.hidden) void loadReal() }, 15000)
    const aoFocar = () => { void loadReal() }
    window.addEventListener("focus", aoFocar)
    return()=>{ cancelled=true; clearInterval(iv); window.removeEventListener("focus", aoFocar) }
  }, [isGestorVendas, user, filtroTrafego, mostrarBloqueados, instanciaSelecionada, setConversas, setModoReal])
  if(loading){
    return (
      <div className="flex flex-col gap-4 lg:h-[calc(100vh-11rem)] lg:flex-row">
        <InboxSkeleton />
        <ConversaSkeleton />
        <div className="hidden lg:block w-[240px] shrink-0 rounded-xl border border-slate-800 bg-slate-900 p-4"><div className="h-32 animate-pulse rounded bg-slate-800" /></div>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {isGestorVendas && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={filtroTrafego} onChange={e=>{ const v=e.target.checked; setFiltroTrafego(v); try{ localStorage.setItem("inbox-filtro-trafego", v ? "on" : "off") }catch{} }} className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500" />
            <span className="font-medium text-slate-700 dark:text-slate-300">Somente Tráfego Pago</span>
          </label>
          <span className="hidden sm:inline text-slate-500">{filtroTrafego ? "filtrando base para IA" : "toda a base"}</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={mostrarBloqueados} onChange={e=>{ const v=e.target.checked; setMostrarBloqueados(v); try{ localStorage.setItem("inbox-mostrar-bloqueados", v ? "on" : "off") }catch{} }} className="rounded border-slate-300 text-cyan-500 focus:ring-cyan-500" />
            <span className="font-medium text-slate-700 dark:text-slate-300">Bloqueados{ocultasBloq>0 ? ` (${ocultasBloq})` : ""}</span>
          </label>
          {(() => {
            const mostrarTodas = () => {
              setFiltroTrafego(false)
              setMostrarBloqueados(true)
              try{ localStorage.setItem("inbox-filtro-trafego","off"); localStorage.setItem("inbox-mostrar-bloqueados","on") }catch{}
            }
            return ocultas>0 ? (
              <button onClick={mostrarTodas} className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 hover:bg-amber-500/20 dark:text-amber-400">
                {ocultas} oculta(s) — mostrar todas
              </button>
            ) : null
          })()}
          <span className="ml-auto flex items-center gap-2">Instância: <InstanceSelector /></span>
        </div>
      )}
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-11rem)] lg:flex-row">
      {/* Desktop: 3 colunas | Mobile: drawer Inbox quando conversa aberta */}
      <div className={`${selectedId ? "hidden md:flex" : "flex"} w-full md:w-[280px] shrink-0`}>
        <PanelBoundary nome="da lista"><InboxList /></PanelBoundary>
      </div>
      <div className={`${!selectedId ? "hidden md:flex" : "flex"} min-w-0 flex-1`}>
        <PanelBoundary nome="da conversa"><ConversaView /></PanelBoundary>
      </div>
      {/* Widget: esconde em mobile quando conversa aberta, mostra em desktop sempre */}
      <div className={`${selectedId ? "hidden lg:flex" : "flex"} w-full lg:w-[240px] shrink-0`}>
        <PanelBoundary nome="lateral"><WidgetPanel /></PanelBoundary>
      </div>
      {/* Botão voltar mobile quando conversa selecionada */}
      {selectedId && (
        <button onClick={()=>setSelected(null)} className="fixed bottom-4 left-4 z-20 rounded-full bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-lg md:hidden">← Voltar ao Inbox</button>
      )}
    </div>
    </div>
  )
}
