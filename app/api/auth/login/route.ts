import { NextRequest, NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function POST(req: NextRequest) {
  const { email, senha } = await req.json().catch(() => ({ email: "", senha: "" }))
  if (!email || !senha) {
    return NextResponse.json({ ok: false }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from("usuarios")
    .select("id, nome, email, role, status, senha_hash, criado_em")
    .eq("email", String(email).trim().toLowerCase())
    .eq("status", "ativo")
    .maybeSingle()

  if (error || !data) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const senhaOk = await bcrypt.compare(senha, data.senha_hash)
  if (!senhaOk) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  // Corte Auth (progressivo): espelha no Supabase Auth com a MESMA senha
  // validada acima — sem reset em massa. Best-effort: nunca quebra o login.
  try {
    const normEmail = String(email).trim().toLowerCase()
    let wsId = "main"
    try {
      const r = await supabaseAdmin.from("usuarios").select("workspace_id").eq("id", data.id).maybeSingle()
      const w = (r.data as { workspace_id?: string } | null)?.workspace_id
      if (w) wsId = w
    } catch { /* coluna pode não existir ainda (031 pendente) */ }
    const meta = { workspace_id: wsId, role: data.role, legacy_id: data.id }
    const listed = await supabaseAdmin.auth.admin.listUsers({ perPage: 100 })
    const existing = (listed.data?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === normEmail)
    if (existing) {
      await supabaseAdmin.auth.admin.updateUserById(existing.id, {
        password: senha,
        app_metadata: meta,
        user_metadata: { nome: data.nome },
      })
    } else {
      const created = await supabaseAdmin.auth.admin.createUser({
        email: normEmail,
        password: senha,
        email_confirm: true,
        app_metadata: meta,
        user_metadata: { nome: data.nome },
      })
      const newId = created.data?.user?.id
      if (newId) {
        try {
          await supabaseAdmin.from("usuarios").update({ auth_user_id: newId }).eq("id", data.id)
        } catch { /* 031 pendente */ }
      }
    }
  } catch (e) {
    console.error("[auth] espelho supabase:", e instanceof Error ? e.message : e)
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: data.id,
      nome: data.nome,
      email: data.email,
      role: data.role,
      ativo: data.status === "ativo",
      criadoEm: data.criado_em,
    },
  })
}
