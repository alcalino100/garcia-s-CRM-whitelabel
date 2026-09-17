import { createSupabaseServer } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
  workspace_id: string;
  role: string;
}

// Lê o usuário da sessão Supabase (JWT do cookie). Null = sem sessão.
// Base do corte Auth: rotas/RLS passam a usar isto em vez de parâmetro solto.
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    const u = data?.user;
    if (!u?.id) return null;
    const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
    return {
      id: u.id,
      email: u.email ?? "",
      workspace_id: String(meta.workspace_id ?? "main"),
      role: String(meta.role ?? "viewer"),
    };
  } catch {
    return null;
  }
}
