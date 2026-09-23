export type BotTemplate = "vendas" | "locacao" | "suporte"
export type Channel = "whatsapp" | "instagram" | "site" | "sms"

export type AIAgent = {
  id: string
  name: string
  description?: string
  botTemplate: BotTemplate
  channels: Channel[]
  responseMode: "auto" | "sugestao"
  waitTimeMs: number
  messageCap: number
  isActive: boolean
  systemPrompt: string
  additionalInstructions: string
  brandVoice: string
  goals: { id:string; name:string; type:string; prompt:string }[]
  knowledgeBase?: { id:string; name:string; documents:{id:string; name:string; type:string}[] }
  testInstance?: string
  rules?: any
}

export const mockAgents: AIAgent[] = [
  {
    id: "ai_patricia_01",
    name: "Patrícia - Reativação",
    description: "IA para reativação de base da Patrícia (Tráfego Pago)",
    botTemplate: "vendas",
    channels: ["whatsapp"],
    responseMode: "auto",
    waitTimeMs: 2000,
    messageCap: 10,
    isActive: true,
    systemPrompt: "Você é uma assistente especialista em reativação de leads frios de Tráfego Pago...",
    additionalInstructions: "Sempre ofereça visita, nunca prometa desconto sem autorização.",
    brandVoice: "Profissional, acolhedora, objetiva",
    goals: [{ id:"g1", name:"Agendar visita", type:"booking", prompt:"Pergunte disponibilidade para visita"}],
    knowledgeBase: { id:"kb1", name:"Base de imóveis", documents: [{id:"d1", name:"tabela_imoveis.pdf", type:"pdf"}] }
  },
  {
    id: "ai_geral_02",
    name: "Agente - Vendas",
    description: "IA geral de vendas",
    botTemplate: "vendas",
    channels: ["whatsapp","site"],
    responseMode: "sugestao",
    waitTimeMs: 3000,
    messageCap: 5,
    isActive: false,
    systemPrompt: "Você é assistente de vendas...",
    additionalInstructions: "",
    brandVoice: "Consultivo",
    goals: []
  }
]
