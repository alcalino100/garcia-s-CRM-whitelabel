import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config"

function db(){ return createClient(SUPABASE_URL, SUPABASE_KEY) }

// Resumo auditável dos campos alterados (segredos nunca entram no log).
function resumoAlteracao(body: any): string {
  const partes: string[] = []
  if (body.name !== undefined) partes.push(`nome="${body.name}"`)
  if (body.isActive !== undefined) partes.push(body.isActive ? "ATIVADA" : "DESATIVADA")
  if (body.testInstance !== undefined) partes.push(`instância-teste="${body.testInstance}"`)
  if (body.responseMode !== undefined) partes.push(`modo="${body.responseMode}"`)
  if (body.modelName !== undefined) partes.push(`modelo="${body.modelName}"`)
  if (body.waitTimeMs !== undefined) partes.push(`espera=${body.waitTimeMs}ms`)
  if (body.messageCap !== undefined) partes.push(`limite=${body.messageCap}`)
  if (body.channels !== undefined) partes.push(`canais=[${(body.channels || []).join(",")}]`)
  if (body.apiToken !== undefined) partes.push("token=alterado")
  if (body.apiEndpoint !== undefined) partes.push("endpoint=alterado")
  if (body.systemPrompt !== undefined) partes.push("prompt-sistema=alterado")
  if (body.additionalInstructions !== undefined) partes.push("instruções=alteradas")
  if (body.brandVoice !== undefined) partes.push("tom-de-voz=alterado")
  if (body.handoffRules !== undefined) partes.push("regras-handoff=alteradas")
  if (body.rules !== undefined) {
    const r = body.rules || {}
    const t = r.target || {}
    if (t.origensPermitidas !== undefined) partes.push(`origens=[${(t.origensPermitidas || []).join(",")}]`)
    if (t.tags !== undefined) partes.push(`tags=[${(t.tags || []).join(",")}]`)
    if (t.numeroTeste !== undefined) partes.push(`números-teste=[${(t.numeroTeste || []).join(",")}]`)
    if (r.enable !== undefined) partes.push(r.enable ? "regras=ON" : "regras=OFF")
    if (r.whitelistInstances !== undefined) partes.push(`instâncias=[${(r.whitelistInstances || []).join(",")}]`)
    if (r.schedule !== undefined) partes.push("horário=alterado")
    if (r.style !== undefined) partes.push("estilo=alterado")
  }
  return partes.length ? partes.join(" · ") : "campos não identificados"
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{id:string}> }){
  const { id } = await params
  const body = await req.json()
  try{
    const patch: any = {}
    if(body.name!==undefined) patch.name = body.name
    if(body.description!==undefined) patch.description = body.description
    if(body.botTemplate!==undefined) patch.bot_template = body.botTemplate
    if(body.channels!==undefined) patch.channels = body.channels
    if(body.responseMode!==undefined) patch.response_mode = body.responseMode
    if(body.waitTimeMs!==undefined) patch.wait_time_ms = body.waitTimeMs
    if(body.messageCap!==undefined) patch.message_cap = body.messageCap
    if(body.apiToken!==undefined) patch.api_token = body.apiToken
    if(body.apiEndpoint!==undefined) patch.api_endpoint = body.apiEndpoint
    if(body.modelName!==undefined) patch.model_name = body.modelName
    if(body.testInstance!==undefined || body.rules!==undefined) {
      const cfgAnterior = ((await db().from("ai_agents").select("config").eq("id", id).maybeSingle()).data?.config) || {}
      const cfg = typeof cfgAnterior === "string" ? JSON.parse(cfgAnterior) : cfgAnterior
      if(body.testInstance!==undefined) cfg.testInstance = body.testInstance
      if(body.rules!==undefined) cfg.rules = body.rules
      patch.config = cfg
    }
    if(body.systemPrompt!==undefined) patch.system_prompt = body.systemPrompt
    if(body.additionalInstructions!==undefined) patch.additional_instructions = body.additionalInstructions
    if(body.brandVoice!==undefined) patch.brand_voice = body.brandVoice
    if(body.handoffRules!==undefined) patch.handoff_rules = body.handoffRules
    if(body.isActive!==undefined) patch.is_active = body.isActive
    patch.updated_at = new Date().toISOString()
    const { data: existing } = await db().from("ai_agents").select("id").eq("id", id).maybeSingle()
    let data, error
    if(existing){
      const r = await db().from("ai_agents").update(patch).eq("id", id).select("*").single()
      data = r.data; error = r.error
    } else {
      // usa dados do mock como base se for um dos agentes conhecidos
      const mockDefaults: any = id==="ai_patricia_01" ? { name:"Patrícia - Reativação", description:"IA para reativação de base da Patrícia (Tráfego Pago)", bot_template:"vendas", channels:["whatsapp"], response_mode:"auto", wait_time_ms:2000, message_cap:10, is_active:true, system_prompt:"Você é uma assistente especialista em reativação de leads frios de Tráfego Pago...", additional_instructions:"Sempre ofereça visita, nunca prometa desconto sem autorização.", brand_voice:"Profissional, acolhedora, objetiva" } : { name: body.name || "Novo Agente", bot_template: "vendas", channels: ["whatsapp"], response_mode: "auto", wait_time_ms: 2000, message_cap: 10, is_active: false }
      const row = { id, ...mockDefaults, ...patch }
      const r = await db().from("ai_agents").insert(row).select("*").single()
      data = r.data; error = r.error
    }
    if(error) throw error
    // Auditoria: toda alteração de agente (liga/desliga, prompt, regras) fica registrada.
    try {
      await db().from("automation_logs").insert({
        event_type: "ia_config_alterada",
        event_title: `Configuração da IA alterada (${(data as any)?.name ?? id})`,
        event_description: resumoAlteracao(body),
        actor_type: "gestor",
      })
    } catch { /* log é best-effort */ }
    return NextResponse.json(data)
  }catch(e:any){
    return NextResponse.json({ error:e.message }, {status:500})
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{id:string}> }){
  const { id } = await params
  try{
    const { error } = await db().from("ai_agents").delete().eq("id", id)
    if(error) throw error
    return NextResponse.json({ success:true })
  }catch(e:any){
    return NextResponse.json({ error:e.message }, {status:500})
  }
}
