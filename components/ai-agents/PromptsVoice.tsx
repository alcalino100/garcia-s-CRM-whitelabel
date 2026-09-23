"use client"
import { useAIAgentsStore } from "@/lib/ai-agents-store"
import { Card, CardContent, CardHeader, CardTitle, Label, Textarea, Input, Badge } from "@/components/ui/primitives"
import { MessageSquare, Mic } from "lucide-react"

export function PromptsVoice({ id }: { id: string }){
  const agent = useAIAgentsStore(s=> s.agents.find(a=>a.id===id))
  const update = useAIAgentsStore(s=> s.updateAgent)
  if(!agent) return null
  return (
    <div className="grid gap-6">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><MessageSquare className="size-5" /></div>
        <div><h3 className="font-display text-base font-bold">Prompts & Voz</h3><p className="text-xs text-muted-foreground">Instruções que definem personalidade e limites da IA</p></div>
      </div>

      <Card className="border-emerald-500/20">
        <CardHeader><CardTitle className="text-sm">System Prompt (principal)</CardTitle><p className="text-xs text-muted-foreground">Quem é a IA, qual seu papel na reativação. Ex: "Você é a assistente da Patrícia..."</p></CardHeader>
        <CardContent><Textarea rows={8} value={agent.systemPrompt} onChange={e=>update(id,{systemPrompt:e.target.value})} placeholder="Você é uma assistente especialista em reativação de leads frios. Objetivo: reengajar e agendar visita..." className="font-mono text-sm" /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">Instruções Adicionais</CardTitle></CardHeader>
        <CardContent><Textarea rows={4} value={agent.additionalInstructions} onChange={e=>update(id,{additionalInstructions:e.target.value})} placeholder="Ex: Sempre ofereça visita, nunca prometa desconto sem autorização, use tom acolhedor..." /></CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Mic className="size-4" /> Voz da Marca</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5"><Label>Brand Voice</Label><Input value={agent.brandVoice} onChange={e=>update(id,{brandVoice:e.target.value})} placeholder="Ex: Profissional, acolhedora, objetiva" /></div>
          <div className="flex flex-wrap gap-1.5">
            {["Profissional","Acolhedora","Objetiva","Consultiva","Descontraída"].map(v=>(
              <Badge key={v} variant={agent.brandVoice.includes(v)?"default":"outline"} className="cursor-pointer" onClick={()=>{
                const has = agent.brandVoice.includes(v)
                const next = has ? agent.brandVoice.replace(v,"").replace(",,",",").trim() : [agent.brandVoice, v].filter(Boolean).join(", ")
                update(id,{brandVoice: next})
              }}>{v}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
