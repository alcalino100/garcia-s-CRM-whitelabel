"use client"

import { createContext, useContext, useEffect, useState } from "react"
import type { Role, User } from "./mock-data"
import { SUPABASE_KEY, SUPABASE_URL } from "./supabase/config"

// Corte Auth (progressivo): estabelece também a sessão Supabase (cookies),
// usada pelo RLS futuro. Best-effort: nunca bloqueia o login legado.
async function signInSupabase(email: string, senha: string): Promise<void> {
  try {
    const { createBrowserClient } = await import("@supabase/ssr")
    const sb = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_KEY,
    )
    await sb.auth.signInWithPassword({ email, password: senha })
  } catch { /* silencioso de propósito */ }
}

type SessionUser = Omit<User, "senha">

interface AuthCtx {
  user: SessionUser | null
  loading: boolean
  login: (email: string, senha: string) => Promise<{ ok: boolean; role?: Role }>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)
const KEY = "imobcrm.session"

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  // Recupera sessão salva no navegador (mantém login ao recarregar)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setUser(JSON.parse(raw))
    } catch {}
    setLoading(false)
  }, [])

  async function login(email: string, senha: string) {
    // A verificação de senha roda no servidor (app/api/auth/login), que é o
    // único lugar com acesso à coluna senha_hash e faz a comparação com bcrypt.
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha }),
    })
    if (!res.ok) return { ok: false }
    const { ok, user: data } = await res.json()
    if (!ok || !data) return { ok: false }

    const session: SessionUser = {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.role as Role,
      ativo: data.ativo,
      criadoEm: data.criadoEm,
    }
    setUser(session)
    localStorage.setItem(KEY, JSON.stringify(session))
    void signInSupabase(email, senha)
    return { ok: true, role: session.role }
  }

  function logout() {
    setUser(null)
    localStorage.removeItem(KEY)
    try {
      import("@supabase/ssr").then(async ({ createBrowserClient }) => {
        const sb = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL || SUPABASE_URL,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_KEY,
        )
        await sb.auth.signOut().catch(() => {})
      }).catch(() => {})
    } catch { /* silencioso */ }
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider")
  return ctx
}
