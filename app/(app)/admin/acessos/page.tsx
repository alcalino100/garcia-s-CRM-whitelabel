"use client"

import { useState } from "react"
import { Plus, Pencil } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import { isMaster, modulosRole, podeGerenciarEquipe, ROLE_GROUPS, ROLE_LABEL } from "@/lib/roles"
import type { Modulo } from "@/lib/mock-data"
import { useLeads } from "@/lib/leads-store"
import { Button } from "@/components/ui/button"
import { Badge, Card, Dialog, Input, Label, Select, Table, TD, TH, THead, TR, useToast } from "@/components/ui/primitives"
import { PageHeading } from "@/components/ui/page-heading"
import { ROLE_VARIANT } from "@/lib/labels"
import type { Role, User } from "@/lib/mock-data"

type FormState = { nome: string; email: string; senha: string; role: Role; ativo: boolean }
const empty: FormState = { nome: "", email: "", senha: "", role: "corretor", ativo: true }

export default function AcessosPage() {
  const { user } = useAuth()
  const { users, addUser, updateUser } = useLeads()
  const toast = useToast()
  const [editing, setEditing] = useState<User | null>(null)
  const [novo, setNovo] = useState(false)
  const [form, setForm] = useState<FormState>(empty)
  const [error, setError] = useState("")

  if (!podeGerenciarEquipe(user?.role ?? "corretor")) {
    return <p className="py-16 text-center text-muted-foreground">Acesso restrito a gestores.</p>
  }

  const canManageMaster = isMaster(user?.role ?? "corretor")

  // Gestor de módulo só gerencia perfis do(s) seu(s) módulo(s); master vê todos
  const mods = modulosRole(user?.role ?? "corretor")
  const temModulo = (m: Modulo) => mods.includes(m)
  const roleGroups = ROLE_GROUPS.map((g) => ({
    ...g,
    roles: g.roles.filter((r) => {
      if (r === "gestor_master") return canManageMaster
      if (r === "corretor" || r === "gestor") return temModulo("vendas") && temModulo("locacao")
      if (r === "corretor_vendas" || r === "gestor_vendas") return temModulo("vendas")
      if (r === "corretor_locacao" || r === "gestor_locacao") return temModulo("locacao")
      if (r === "leitor") return true
      return false
    }),
  })).filter((g) => g.roles.length > 0)

  function openNovo() {
    setForm(empty); setError(""); setNovo(true)
  }
  function openEdit(u: User) {
    if (u.role === "gestor_master" && !canManageMaster) {
      setError("Você não pode editar um Gestor Master.")
      return
    }
    // Senha nunca é prefiltrada (só existe como hash) — em branco na edição = manter a atual.
    setForm({ nome: u.nome, email: u.email, senha: "", role: u.role, ativo: u.ativo }); setError(""); setEditing(u)
  }

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((s) => ({ ...s, [k]: v }))
  }

  function validate(isEdit: boolean) {
    if (!form.nome.trim()) return "Informe o nome."
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) return "E-mail inválido."
    // Na edição, campo em branco = manter a senha atual; se digitado, vale a regra de tamanho mínimo.
    if (!isEdit || form.senha) {
      if (form.senha.length < 6) return "A senha deve ter ao menos 6 caracteres."
    }
    if (form.role === "gestor_master" && !canManageMaster) return "Você não pode atribuir o perfil Gestor Master."
    return ""
  }

  async function submitNovo(e: React.FormEvent) {
    e.preventDefault()
    const v = validate(false)
    if (v) { setError(v); return }
    const res = await addUser(form)
    if (!res.ok) { setError(res.error!); return }
    toast("Usuário cadastrado com sucesso.")
    setNovo(false)
  }
  async function submitEdit(e: React.FormEvent) {
    e.preventDefault()
    const v = validate(true)
    if (v) { setError(v); return }
    const res = await updateUser(editing!.id, form)
    if (!res.ok) { setError(res.error!); return }
    toast("Alterações salvas.")
    setEditing(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeading title="Gestão de Acessos" subtitle="Gerencie corretores e gestores da equipe." badge="Equipe" />
        <Button onClick={openNovo}><Plus className="size-4" /> Novo Usuário</Button>
      </div>

      <Card>
        <Table>
          <THead>
            <TR><TH>Nome</TH><TH>E-mail</TH><TH>Perfil</TH><TH>Status</TH><TH>Ações</TH></TR>
          </THead>
          <tbody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium">{u.nome}</TD>
                <TD className="text-muted-foreground">{u.email}</TD>
                <TD><Badge variant={ROLE_VARIANT[u.role]}>{ROLE_LABEL[u.role]}</Badge></TD>
                <TD><Badge variant={u.ativo ? "green" : "gray"}>{u.ativo ? "Ativo" : "Inativo"}</Badge></TD>
                <TD><Button variant="outline" size="sm" disabled={u.role === "gestor_master" && !canManageMaster} onClick={() => openEdit(u)}><Pencil className="size-3.5" /> Editar</Button></TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </Card>

      <Dialog open={novo} onClose={() => setNovo(false)} title="Novo Usuário">
        <UserForm form={form} set={set} error={error} onSubmit={submitNovo} onCancel={() => setNovo(false)} submitLabel="Cadastrar" canManageMaster={canManageMaster} roleGroups={roleGroups} isEdit={false} />
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title="Editar Usuário">
        <UserForm form={form} set={set} error={error} onSubmit={submitEdit} onCancel={() => setEditing(null)} submitLabel="Salvar alterações" canManageMaster={canManageMaster} roleGroups={roleGroups} isEdit />
      </Dialog>
    </div>
  )
}

function UserForm({
  form, set, error, onSubmit, onCancel, submitLabel, canManageMaster, roleGroups, isEdit,
}: {
  form: FormState
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void
  error: string
  onSubmit: (e: React.FormEvent) => void
  onCancel: () => void
  submitLabel: string
  canManageMaster: boolean
  roleGroups: { label: string; roles: Role[] }[]
  isEdit: boolean
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <Label htmlFor="un">Nome *</Label>
        <Input id="un" value={form.nome} onChange={(e) => set("nome", e.target.value)} />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="ue">E-mail *</Label>
        <Input id="ue" type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="us">{isEdit ? "Nova senha" : "Senha *"}</Label>
          <Input id="us" type="password" autoComplete="new-password" placeholder={isEdit ? "Deixe em branco para manter a atual" : undefined} value={form.senha} onChange={(e) => set("senha", e.target.value)} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="ur">Perfil</Label>
          <Select id="ur" value={form.role} onChange={(e) => set("role", e.target.value as Role)}>
            {roleGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.roles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.ativo} onChange={(e) => set("ativo", e.target.checked)} className="size-4 accent-[var(--primary)]" />
        Usuário ativo
      </label>
      {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="mt-1 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button type="submit">{submitLabel}</Button>
      </div>
    </form>
  )
}
