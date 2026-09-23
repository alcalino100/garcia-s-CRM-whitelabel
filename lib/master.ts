import { supabase } from "@/lib/supabase/client"

// Painel Master: acesso exclusivo do proprietário.
// Por env (NEXT_PUBLIC_MASTER_EMAIL) para cada whitelabel ter o seu dono;
// default = Colucci. O link do menu nem é renderizado para os demais.
export const MASTER_EMAIL = (process.env.NEXT_PUBLIC_MASTER_EMAIL || "guilherme@colucci.com").toLowerCase()

export function isMasterEmail(email: string | null | undefined): boolean {
  return (email || "").toLowerCase().trim() === MASTER_EMAIL
}

export interface BrandLinks {
  site: string
  instagram: string
  suporte: string
}

export interface BrandSettings {
  id: string
  brand_name: string
  logo_url: string | null
  favicon_url: string | null
  cor_primaria: string
  fonte_titulo: string
  fonte_texto: string
  sidebar_bg: string
  sidebar_fg: string
  sidebar_accent: string
  links: BrandLinks
}

export const BRAND_DEFAULTS: BrandSettings = {
  id: "main",
  brand_name: "Sua Imobiliária",
  logo_url: null,
  favicon_url: null,
  cor_primaria: "#b22222",
  fonte_titulo: "Space Grotesk",
  fonte_texto: "Inter",
  sidebar_bg: "#54595f",
  sidebar_fg: "#d4d4d8",
  sidebar_accent: "#45494e",
  links: { site: "", instagram: "", suporte: "" },
}

// Fontes permitidas (Google Fonts) — whitelist contra injeção.
export const FONTES_TITULO = ["Space Grotesk", "Archivo", "Sora", "Montserrat", "Poppins", "Inter"]
export const FONTES_TEXTO = ["Inter", "Roboto", "Archivo", "Sora", "Montserrat", "Poppins"]

// Marca embutida no HTML pelo servidor (sem flash). Nulo no SSR/pré-render.
export function getInitialBrand(): Partial<BrandSettings> | null {
  try {
    if (typeof window === "undefined") return null
    const w = (window as unknown as { __BRAND__?: Partial<BrandSettings> }).__BRAND__
    return w ?? null
  } catch {
    return null
  }
}
// Falha silenciosa.
// Aplica a identidade na sessão atual (CSS vars + título + favicon + fontes).
// Falha silenciosa.
export function applyBrand(b: Partial<BrandSettings>): void {
  try {
    if (typeof document === "undefined") return
    if (b.cor_primaria) document.documentElement.style.setProperty("--primary", b.cor_primaria)
    if (b.brand_name) document.title = `${b.brand_name} — CRM`
    if (b.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel='icon']")
      if (!link) {
        link = document.createElement("link")
        link.rel = "icon"
        document.head.appendChild(link)
      }
      link.href = b.favicon_url
    }
    const fams = [b.fonte_titulo, b.fonte_texto].filter(
      (f): f is string => !!f && [...FONTES_TITULO, ...FONTES_TEXTO].includes(f),
    )
    if (fams.length) {
      const id = "master-fonts"
      if (!document.getElementById(id)) {
        const link = document.createElement("link")
        link.id = id
        link.rel = "stylesheet"
        link.href = `https://fonts.googleapis.com/css2?${[...new Set(fams)].map((f) => `family=${f.replace(/ /g, "+")}:wght@400;500;600;700`).join("&")}&display=swap`
        document.head.appendChild(link)
      }
      if (b.fonte_texto) document.documentElement.style.setProperty("--font-inter", `'${b.fonte_texto}', sans-serif`)
      if (b.fonte_titulo) document.documentElement.style.setProperty("--font-jakarta", `'${b.fonte_titulo}', sans-serif`)
    }
  } catch { /* best-effort */ }
}

export async function loadBrand(): Promise<{ ok: boolean; settings: BrandSettings; faltaTabela: boolean }> {
  try {
    const { data, error } = await supabase.from("workspace_settings").select("*").eq("id", "main").maybeSingle()
    if (error) {
      const faltaTabela = String(error.message || "").toLowerCase().includes("does not exist")
        || String((error as { code?: string }).code || "") === "42P01"
      return { ok: false, settings: BRAND_DEFAULTS, faltaTabela }
    }
    if (!data) return { ok: true, settings: BRAND_DEFAULTS, faltaTabela: false }
    const d = data as Record<string, unknown>
    return {
      ok: true,
      faltaTabela: false,
      settings: {
        id: "main",
        brand_name: String(d.brand_name ?? BRAND_DEFAULTS.brand_name),
        logo_url: (d.logo_url as string | null) ?? null,
        favicon_url: (d.favicon_url as string | null) ?? null,
        cor_primaria: String(d.cor_primaria ?? BRAND_DEFAULTS.cor_primaria),
        sidebar_bg: String(d.sidebar_bg ?? BRAND_DEFAULTS.sidebar_bg),
        sidebar_fg: String(d.sidebar_fg ?? BRAND_DEFAULTS.sidebar_fg),
        sidebar_accent: String(d.sidebar_accent ?? BRAND_DEFAULTS.sidebar_accent),
        fonte_titulo: String(d.fonte_titulo ?? BRAND_DEFAULTS.fonte_titulo),
        fonte_texto: String(d.fonte_texto ?? BRAND_DEFAULTS.fonte_texto),
        links: { ...BRAND_DEFAULTS.links, ...((d.links ?? {}) as Partial<BrandLinks>) },
      },
    }
  } catch {
    return { ok: false, settings: BRAND_DEFAULTS, faltaTabela: false }
  }
}

export async function saveBrand(s: BrandSettings): Promise<{ ok: boolean; erro?: string }> {
  try {
    const { error } = await supabase.from("workspace_settings").upsert({
      id: "main",
      brand_name: s.brand_name,
      logo_url: s.logo_url || null,
      favicon_url: s.favicon_url || null,
      cor_primaria: s.cor_primaria,
      sidebar_bg: s.sidebar_bg,
      sidebar_fg: s.sidebar_fg,
      sidebar_accent: s.sidebar_accent,
      fonte_titulo: s.fonte_titulo,
      fonte_texto: s.fonte_texto,
      links: s.links,
      updated_at: new Date().toISOString(),
    }, { onConflict: "id" })
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) }
  }
}
