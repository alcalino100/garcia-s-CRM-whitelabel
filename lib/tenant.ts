import { supabase } from "@/lib/supabase/client"

// Fase A multi-tenant: resolução da conta ativa.
// Ordem: ?w=<slug> (troca explícita) > subdomínio (<slug>.dominio) > "main".
// Fase A só RESOLVE (sem enforcement nas queries — Fase B).
export const MAIN_WORKSPACE = "main";

let cachedSlug: string | null = null;

// Conta ativa no navegador (memoizado). Seguro em SSR (default main).
export function getActiveWorkspaceSlug(): string {
  if (cachedSlug) return cachedSlug;
  if (typeof window === "undefined") return MAIN_WORKSPACE;
  cachedSlug = resolveWorkspaceSlug(window.location.host, window.location.search);
  return cachedSlug;
}

// Troca explícita de conta (?w=slug) — recarrega.
export function switchWorkspace(slug: string): void {
  if (typeof window === "undefined") return;
  cachedSlug = null;
  const url = new URL(window.location.href);
  if (slug === MAIN_WORKSPACE) url.searchParams.delete("w");
  else url.searchParams.set("w", slug);
  window.location.href = url.toString();
}

export async function setWorkspaceActive(id: string, active: boolean): Promise<{ ok: boolean; erro?: string }> {
  try {
    const { supabase } = await import("@/lib/supabase/client");
    const { error } = await supabase.from("workspaces").update({ active }).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

export function resolveWorkspaceSlug(host?: string, search?: string): string {
  try {
    if (search) {
      const w = new URLSearchParams(search).get("w");
      if (w && /^[a-z0-9-]{1,40}$/.test(w)) return w;
    }
    const h = (host || "").split(":")[0].toLowerCase();
    const parts = h.split(".");
    // <slug>.dominio.tld (3+ partes) e não-www
    if (parts.length >= 3 && parts[0] !== "www") return parts[0];
  } catch { /* default */ }
  return MAIN_WORKSPACE;
}

export interface Workspace {
  id: string;
  slug: string;
  name: string;
  active: boolean;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  try {
    const { data } = await supabase.from("workspaces").select("id,slug,name,active").order("created_at");
    return ((data ?? []) as Workspace[]);
  } catch {
    return [];
  }
}

export async function createWorkspace(slug: string, name: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    const clean = slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, "").slice(0, 40);
    if (!clean) return { ok: false, erro: "Slug inválido." };
    const { error } = await supabase.from("workspaces").insert({ id: clean, slug: clean, name: name.trim() || clean, active: true });
    if (error) throw new Error(error.message);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
