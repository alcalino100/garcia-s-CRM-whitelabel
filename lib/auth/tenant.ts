import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/supabase/config";
import {
  ROLE_PERMISSIONS,
  hasPermission as hasPerm,
  legacyToRoleType,
  type PermissionKey,
  type RoleType,
} from "@/lib/db/types";
import { getActiveWorkspaceSlug } from "@/lib/tenant";

function db() {
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

// Fase 1 (transição): tenant = workspace ativo (sessões próprias atuais).
// Fase 1.2b (corte Auth): estas funções passam a ler tenant/role do JWT
// (Supabase Auth + custom claims). Assinaturas NÃO mudam.
export async function getCurrentTenant(): Promise<string> {
  if (typeof window !== "undefined") return getActiveWorkspaceSlug();
  return "main";
}

export async function validateTenant(tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  try {
    const { data } = await db().from("workspaces").select("id,active").eq("id", tenantId).maybeSingle();
    const w = data as { id?: string; active?: boolean } | null;
    return !!w?.id && w.active !== false;
  } catch {
    return false;
  }
}

// Papel do usuário (identificado por e-mail) na conta.
export async function getUserRole(email: string, tenantId: string): Promise<RoleType> {
  try {
    // Membro explícito da conta (Fase B) tem precedência.
    const { data: mem } = await db()
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", tenantId)
      .eq("user_id", email)
      .maybeSingle();
    const r = (mem as { role?: string } | null)?.role;
    if (r === "admin" || r === "manager" || r === "user" || r === "viewer") return r;
    // Fallback: papel legado do usuário na conta.
    const { data: u } = await db()
      .from("usuarios")
      .select("role")
      .eq("email", email)
      .eq("workspace_id", tenantId)
      .maybeSingle();
    return legacyToRoleType(String((u as { role?: string } | null)?.role ?? ""));
  } catch {
    return "viewer";
  }
}

export async function getUserPermissions(email: string, tenantId: string): Promise<PermissionKey[]> {
  const role = await getUserRole(email, tenantId);
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: RoleType, permission: PermissionKey): boolean {
  return hasPerm(role, permission);
}

export async function requirePermission(email: string, tenantId: string, permission: PermissionKey): Promise<void> {
  const role = await getUserRole(email, tenantId);
  if (!hasPermission(role, permission)) {
    throw new Error("Sem permissão");
  }
}
