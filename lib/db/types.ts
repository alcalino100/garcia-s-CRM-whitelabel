// Multi-tenant (GoHighLevel-style) — tipos canônicos da Fase 1.
// Papéis NOVOS (4 níveis). Mapeamento dos 7 legados em LEGACY_ROLE_MAP.
// Durante a transição, o código legado segue valendo; o corte vem na Fase 2.

export type RoleType = "admin" | "manager" | "user" | "viewer";

export type PermissionKey =
  | "create_lead"
  | "edit_lead"
  | "delete_lead"
  | "manage_pipeline"
  | "manage_whatsapp"
  | "manage_automations"
  | "manage_users"
  | "view_reports"
  | "configure_branding";

export interface PermissionType {
  role: RoleType;
  permissions: PermissionKey[];
}

export interface Tenant {
  id: string;
  slug: string;
  name: string;
  domain?: string | null;
  subscription_tier?: "free" | "starter" | "pro" | "enterprise";
  logo_url?: string | null;
  custom_colors?: { primary?: string; secondary?: string; accent?: string };
  owner_id?: string | null;
  active: boolean;
}

export interface TenantUser {
  id: string;
  tenant_id: string;
  email: string;
  role: RoleType;
  permissions?: Partial<Record<PermissionKey, boolean>>;
}

export const ROLE_PERMISSIONS: Record<RoleType, PermissionKey[]> = {
  admin: ["create_lead", "edit_lead", "delete_lead", "manage_pipeline", "manage_whatsapp", "manage_automations", "manage_users", "view_reports", "configure_branding"],
  manager: ["create_lead", "edit_lead", "delete_lead", "manage_pipeline", "manage_whatsapp", "manage_automations", "view_reports"],
  user: ["create_lead", "edit_lead", "view_reports"],
  viewer: ["view_reports"],
};

export function hasPermission(role: RoleType, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

// Papéis legados (lib/mock-data.ts) → novos. "leitor" não existe ainda = viewer futuro.
export const LEGACY_ROLE_MAP: Record<string, RoleType> = {
  gestor_master: "admin",
  gestor: "manager",
  gestor_vendas: "manager",
  gestor_locacao: "manager",
  corretor: "user",
  corretor_vendas: "user",
  corretor_locacao: "user",
};

export function legacyToRoleType(legacy: string): RoleType {
  return LEGACY_ROLE_MAP[legacy] ?? "viewer";
}
