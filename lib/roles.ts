import type { Modulo, Role } from "./mock-data"

export type Nivel = "corretor" | "gestor" | "master" | "leitor"

export const ROLE_LIST: Role[] = [
  "corretor",
  "gestor",
  "gestor_master",
  "corretor_vendas",
  "gestor_vendas",
  "corretor_locacao",
  "gestor_locacao",
  "leitor",
]

export const ROLE_LABEL: Record<Role, string> = {
  corretor: "Corretor (Vendas + Locação)",
  gestor: "Gestor (Vendas + Locação)",
  gestor_master: "Gestor Master",
  corretor_vendas: "Corretor de Vendas",
  gestor_vendas: "Gestor de Vendas",
  corretor_locacao: "Corretor de Locação",
  gestor_locacao: "Gestor de Locação",
  leitor: "Leitor (somente leitura)",
}

// Agrupamento para os selects de perfil (Gestão de Acessos / Admin)
export const ROLE_GROUPS: { label: string; roles: Role[] }[] = [
  { label: "Acesso completo", roles: ["gestor_master"] },
  { label: "Vendas + Locação", roles: ["corretor", "gestor"] },
  { label: "Somente Vendas", roles: ["corretor_vendas", "gestor_vendas"] },
  { label: "Somente Locação", roles: ["corretor_locacao", "gestor_locacao"] },
  { label: "Somente leitura", roles: ["leitor"] },
]

export function nivelRole(role: Role): Nivel {
  if (role === "gestor_master") return "master"
  if (role === "corretor" || role === "corretor_vendas" || role === "corretor_locacao") return "corretor"
  if (role === "leitor") return "leitor"
  return "gestor"
}

export function isGestorNivel(role: Role): boolean {
  const n = nivelRole(role)
  return n === "gestor" || n === "master"
}

export function isMaster(role: Role): boolean {
  return role === "gestor_master"
}

// Admin (gestão de equipe/acessos) fica restrito ao gestor legado ou master
export function isAdminRole(role: Role): boolean {
  return role === "gestor" || role === "gestor_master"
}

// Qualquer gestor (inclusive de módulo, ex.: gestor_locacao) gerencia a equipe
export function podeGerenciarEquipe(role: Role): boolean {
  return isGestorNivel(role)
}

export function modulosRole(role: Role): Modulo[] {
  switch (role) {
    case "corretor_vendas":
    case "gestor_vendas":
      return ["vendas"]
    case "corretor_locacao":
    case "gestor_locacao":
      return ["locacao"]
    default:
      return ["vendas", "locacao"]
  }
}

export function podeModulo(role: Role, modulo: Modulo): boolean {
  return modulosRole(role).includes(modulo)
}

export function podeVendas(role: Role): boolean {
  return podeModulo(role, "vendas")
}

export function podeLocacao(role: Role): boolean {
  return podeModulo(role, "locacao")
}

// Corretores "de carteira" (atribuíveis a leads) dentro de um módulo
export function isCorretorDe(role: Role, modulo: Modulo): boolean {
  if (role === "corretor") return true
  if (modulo === "vendas") return role === "corretor_vendas"
  return role === "corretor_locacao"
}

// Página de gestão de um módulo exige nível gestor + acesso ao módulo
export function podeGerenciar(role: Role, modulo: Modulo): boolean {
  return isGestorNivel(role) && podeModulo(role, modulo)
}

// Rota inicial após login
export function homeDaRole(role: Role): string {
  if (role === "leitor") return "/relatorios"
  const locacaoSo = podeLocacao(role) && !podeVendas(role)
  if (locacaoSo) return isGestorNivel(role) ? "/locacao/dashboard" : "/locacao"
  return isGestorNivel(role) ? "/dashboard-gestao" : "/painel-corretor"
}
