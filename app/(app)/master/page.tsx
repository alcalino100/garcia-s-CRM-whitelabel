"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth-context"
import { supabase } from "@/lib/supabase/client"
import { BRAND_DEFAULTS, FONTES_TEXTO, FONTES_TITULO, applyBrand, isMasterEmail, loadBrand, saveBrand, type BrandSettings } from "@/lib/master"
import { LEAD_STATUSES, TAGS_FLUXO } from "@/lib/labels"
import { listStages, saveStage, createStage, renameStageKey, SYSTEM_STAGE_KEYS, type StageRow } from "@/lib/pipeline-stages"
import { createWorkspace, listWorkspaces, type Workspace } from "@/lib/tenant"
import { ROLE_LABEL } from "@/lib/roles"
import type { Role } from "@/lib/mock-data"
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, Table, TD, TH, THead, TR, Textarea, useToast } from "@/components/ui/primitives"
import { cn } from "@/lib/utils"

const ABAS = [
  { id: "marca", label: "Marca" },
  { id: "ias", label: "IAs & Bots" },
  { id: "automacoes", label: "Automações" },
  { id: "tags", label: "Tags" },
  { id: "equipe", label: "Equipe" },
  { id: "pipelines", label: "Pipelines" },
  { id: "relatorios", label: "Relatórios" },
  { id: "agencia", label: "Agência" },
  { id: "clonar", label: "Clonar" },
] as const

type Aba = (typeof ABAS)[number]["id"]

const btn = (primary = false) =>
  cn("rounded-lg px-3 py-2 text-xs font-semibold transition disabled:opacity-50",
    primary ? "bg-primary text-primary-foreground hover:opacity-90" : "border border-border bg-card hover:bg-muted")

export default function MasterPage() {
  const { user, loading } = useAuth()
  const router = useRouter()
  const [aba, setAba] = useState<Aba>("marca")

  useEffect(() => {
    if (!loading && (!user || !isMasterEmail(user.email))) router.replace("/painel-corretor")
  }, [loading, user, router])

  if (loading || !user) return <div className="py-16 text-center text-muted-foreground">Carregando...</div>
  if (!isMasterEmail(user.email)) return null

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-bold">Master <Badge>proprietário</Badge></h1>
        <p className="text-xs text-muted-foreground">Visível somente para {user.email} · mudanças aplicam na hora</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {ABAS.map((a) => (
          <button key={a.id} type="button" onClick={() => setAba(a.id)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
              aba === a.id ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground")}>
            {a.label}
          </button>
        ))}
      </div>
      {aba === "marca" && <MarcaSection />}
      {aba === "ias" && <IAsSection />}
      {aba === "automacoes" && <AutomacoesSection />}
      {aba === "tags" && <TagsSection />}
      {aba === "equipe" && <EquipeSection />}
      {aba === "pipelines" && <PipelinesSection />}
      {aba === "relatorios" && <RelatoriosSection />}
      {aba === "agencia" && <AgenciaSection />}
      {aba === "clonar" && <ClonarSection />}
    </div>
  )
}

function MarcaSection() {
  const toast = useToast()
  const { user } = useAuth()
  const [form, setForm] = useState<BrandSettings>(BRAND_DEFAULTS)
  const [faltaTabela, setFaltaTabela] = useState(false)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null)

  useEffect(() => {
    loadBrand().then((r) => { setForm(r.settings); setFaltaTabela(r.faltaTabela); applyBrand(r.settings) })
  }, [])

  const salvar = async () => {
    setSaving(true)
    const r = await saveBrand(form)
    setSaving(false)
    if (!r.ok) { toast(`Falha ao salvar: ${r.erro}`, "error"); return }
    applyBrand(form)
    toast("Marca aplicada.")
  }

  const enviarArquivo = async (kind: "logo" | "favicon", file: File) => {
    setUploading(kind)
    try {
      const buf = await file.arrayBuffer()
      let bin = ""
      const bytes = new Uint8Array(buf)
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
      const r = await fetch("/api/master/brand-upload", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email ?? "", kind, filename: file.name, mime: file.type, dataBase64: btoa(bin) }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.erro || "falha")
      const patch = kind === "logo" ? { logo_url: j.url as string } : { favicon_url: j.url as string }
      setForm((f) => ({ ...f, ...patch }))
      toast(`${kind === "logo" ? "Logo" : "Favicon"} enviado — salve para aplicar.`)
    } catch (e) { toast(`Falha no upload: ${e instanceof Error ? e.message : e}`, "error") }
    setUploading(null)
  }

  return (
    <Card>
      <CardHeader><CardTitle>Marca (white-label)</CardTitle></CardHeader>
      <CardContent>
        {faltaTabela && (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            Tabela <code>workspace_settings</code> ainda não existe — rode <code>scripts/026_workspace_settings.sql</code> no SQL Editor do Supabase e recarregue.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5"><Label>Nome da marca</Label>
            <Input value={form.brand_name} onChange={(e) => setForm({ ...form, brand_name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label>URL da logo (ou envie abaixo)</Label>
            <Input value={form.logo_url ?? ""} placeholder="https://..." onChange={(e) => setForm({ ...form, logo_url: e.target.value || null })} /></div>
          <div className="grid gap-1.5"><Label>Favicon (URL ou envio)</Label>
            <Input value={form.favicon_url ?? ""} placeholder="https://..." onChange={(e) => setForm({ ...form, favicon_url: e.target.value || null })} /></div>
          <div className="grid gap-1.5"><Label>Fonte dos títulos</Label>
            <Select value={form.fonte_titulo} onChange={(e) => setForm({ ...form, fonte_titulo: e.target.value })}>
              {FONTES_TITULO.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select></div>
          <div className="grid gap-1.5"><Label>Fonte dos textos</Label>
            <Select value={form.fonte_texto} onChange={(e) => setForm({ ...form, fonte_texto: e.target.value })}>
              {FONTES_TEXTO.map((f) => <option key={f} value={f}>{f}</option>)}
            </Select></div>
          <div className="grid gap-1.5"><Label>Cor primária</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={form.cor_primaria} onChange={(e) => setForm({ ...form, cor_primaria: e.target.value })} className="h-9 w-12 cursor-pointer rounded border border-input bg-background" />
              <Input value={form.cor_primaria} onChange={(e) => setForm({ ...form, cor_primaria: e.target.value })} />
            </div></div>
          <div className="grid gap-1.5"><Label>Link do site</Label>
            <Input value={form.links.site} onChange={(e) => setForm({ ...form, links: { ...form.links, site: e.target.value } })} /></div>
          <div className="grid gap-1.5"><Label>Instagram</Label>
            <Input value={form.links.instagram} onChange={(e) => setForm({ ...form, links: { ...form.links, instagram: e.target.value } })} /></div>
          <div className="grid gap-1.5"><Label>Suporte (WhatsApp)</Label>
            <Input value={form.links.suporte} onChange={(e) => setForm({ ...form, links: { ...form.links, suporte: e.target.value } })} /></div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={salvar} disabled={saving} className={btn(true)}>{saving ? "Salvando..." : "Salvar e aplicar"}</button>
          <Label className={btn()}>Enviar logo
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarArquivo("logo", f); e.target.value = "" }} />
          </Label>
          <Label className={btn()}>Enviar favicon
            <input type="file" accept="image/png,image/jpeg,image/webp,image/x-icon,image/svg+xml" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarArquivo("favicon", f); e.target.value = "" }} />
          </Label>
          {uploading && <span className="text-xs text-muted-foreground">Enviando {uploading}...</span>}
          {form.logo_url && <img src={form.logo_url} alt="logo" className="h-9 w-auto rounded border border-border bg-white px-2 py-1" />}
        </div>
      </CardContent>
    </Card>
  )
}

interface AgenteRow { id: string; name: string; is_active: boolean; model_name?: string; config?: unknown }

function cfgOf(a: AgenteRow): Record<string, unknown> {
  const c = a.config
  if (!c) return {}
  if (typeof c === "string") { try { return JSON.parse(c) } catch { return {} } }
  return c as Record<string, unknown>
}

function IAsSection() {
  const toast = useToast()
  const [agentes, setAgentes] = useState<AgenteRow[]>([])
  const [loading, setLoading] = useState(true)

  const carregar = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/ai")
      const j = await r.json()
      const arr = (Array.isArray(j) ? j : j.agents ?? j.data ?? []) as AgenteRow[]
      setAgentes(arr)
    } catch { setAgentes([]) }
    setLoading(false)
  }
  useEffect(() => { carregar() }, [])

  const alternar = async (a: AgenteRow) => {
    try {
      const r = await fetch(`/api/ai/${a.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive: !a.is_active }) })
      if (!r.ok) throw new Error("falha")
      toast(`${a.name} ${!a.is_active ? "ativado" : "desativado"}.`)
      carregar()
    } catch { toast("Falha ao alternar.", "error") }
  }

  return (
    <Card>
      <CardHeader><CardTitle>IAs & Bots</CardTitle></CardHeader>
      <CardContent>
        {loading ? <p className="text-xs text-muted-foreground">Carregando...</p> : (
          <Table>
            <THead><TR><TH>Agente</TH><TH>Modelo</TH><TH>Instância</TH><TH>Status</TH><TH></TH></TR></THead>
            <tbody>
              {agentes.map((a) => {
                const cfg = cfgOf(a)
                const rules = (cfg.rules ?? {}) as { enable?: boolean }
                return (
                  <TR key={a.id}>
                    <TD>{a.name}</TD>
                    <TD className="text-xs text-muted-foreground">{a.model_name ?? "—"}</TD>
                    <TD className="text-xs text-muted-foreground">{String(cfg.testInstance ?? "—")}</TD>
                    <TD><Badge>{a.is_active && rules.enable !== false ? "ativo" : "off"}</Badge></TD>
                    <TD className="flex gap-2">
                      <button type="button" onClick={() => alternar(a)} className={btn()}>{a.is_active ? "Desativar" : "Ativar"}</button>
                      <Link href="/ai-agents" className={btn()}>Abrir bot</Link>
                    </TD>
                  </TR>
                )
              })}
            </tbody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function AutomacoesSection() {
  const toast = useToast()
  const { user } = useAuth()
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [dry, setDry] = useState("")
  const [busy, setBusy] = useState(false)
  const [runOut, setRunOut] = useState("")

  const carregar = async () => {
    try {
      const r = await fetch("/api/automation/worker")
      setStatus(await r.json())
    } catch { setStatus(null) }
  }
  useEffect(() => { carregar() }, [])

  const pausar = async (pausado: boolean) => {
    setBusy(true)
    try {
      const r = await fetch("/api/automation/global-pause", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pausado }) })
      if (!r.ok) throw new Error("falha")
      toast(pausado ? "Tudo pausado." : "Tudo retomado.")
      carregar()
    } catch { toast("Falha.", "error") }
    setBusy(false)
  }

  const simular = async () => {
    setDry("...")
    try {
      const r = await fetch("/api/automation/regressao-inatividade?dry=1")
      const j = await r.json()
      setDry(JSON.stringify(j, null, 1).slice(0, 2000))
    } catch { setDry("falha (verifique CRON_SECRET/login)") }
  }

  const executar = async () => {
    setBusy(true)
    setRunOut("executando (até ~4 min, não feche)...")
    try {
      const r = await fetch("/api/automation/worker-run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email ?? "" }),
      })
      const j = await r.json()
      setRunOut(JSON.stringify(j, null, 1).slice(0, 2000))
      if (j.ok) toast("Rodada concluída.")
      else toast(`Falha: ${j.erro ?? j.error ?? "?"}`, "error")
      carregar()
    } catch { setRunOut("falha de rede"); toast("Falha.", "error") }
    setBusy(false)
  }

  const s = (status ?? {}) as Record<string, unknown>
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Motor de automações</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            Ativas: {String(s.active_automations ?? "?")} · Pausadas: {String(s.paused_automations ?? "?")} · Jobs pendentes: {String(s.pending_jobs ?? "?")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={executar} className={btn(true)}>Executar agora</button>
            <button type="button" disabled={busy} onClick={() => pausar(true)} className={btn()}>Pausar tudo</button>
            <button type="button" disabled={busy} onClick={() => pausar(false)} className={btn()}>Retomar tudo</button>
            <Link href="/automacoes" className={btn()}>Abrir automações</Link>
            <Link href="/automacoes/logs" className={btn()}>Ver logs</Link>
          </div>
          {runOut && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-2 text-[11px]">{runOut}</pre>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Simular regressão (dry-run, não move nada)</CardTitle></CardHeader>
        <CardContent>
          <button type="button" onClick={simular} className={btn(true)}>Rodar simulação</button>
          {dry && <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-muted p-2 text-[11px]">{dry}</pre>}
        </CardContent>
      </Card>
    </div>
  )
}

function TagsSection() {
  const toast = useToast()
  const [agentes, setAgentes] = useState<{ id: string; name: string; tags: string[] }[]>([])
  const [novo, setNovo] = useState<Record<string, string>>({})

  const carregar = async () => {
    try {
      const { data } = await supabase.from("ai_agents").select("id,name,config")
      const rows = ((data ?? []) as { id: string; name: string; config: unknown }[]).map((a) => {
        const c = typeof a.config === "string" ? JSON.parse(a.config) : (a.config ?? {})
        const t = ((c as { rules?: { target?: { tags?: unknown } } }).rules?.target?.tags ?? []) as unknown[]
        return { id: a.id, name: a.name, tags: t.map((x) => String(x)) }
      })
      setAgentes(rows)
    } catch { setAgentes([]) }
  }
  useEffect(() => { carregar() }, [])

  const salvarTags = async (id: string, tags: string[]) => {
    try {
      const { data } = await supabase.from("ai_agents").select("config").eq("id", id).maybeSingle()
      const raw = (data as { config: unknown } | null)?.config
      const cfg = (typeof raw === "string" ? JSON.parse(raw) : (raw ?? {})) as { rules?: { target?: Record<string, unknown> } }
      cfg.rules = cfg.rules ?? {}
      cfg.rules.target = { ...(cfg.rules.target ?? {}), tags }
      const r = await fetch(`/api/ai/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rules: cfg.rules }) })
      if (!r.ok) throw new Error("falha")
      toast("Tags salvas.")
      carregar()
    } catch { toast("Falha ao salvar tags.", "error") }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Tags do ciclo (a IA atende quem tem)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {TAGS_FLUXO.map((t) => <Badge key={t}>{t}</Badge>)}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">automacao → entra · respondeu-automacao → respondeu · nao-respondeu-automacao + followup → follow-up · saem todas no handoff/perdido.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tags-alvo por agente</CardTitle></CardHeader>
        <CardContent>
          {agentes.map((a) => (
            <div key={a.id} className="mb-3 rounded-lg border border-border p-2">
              <p className="text-sm font-semibold">{a.name}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {a.tags.map((t) => (
                  <button key={t} type="button" title="remover" onClick={() => salvarTags(a.id, a.tags.filter((x) => x !== t))}
                    className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs hover:border-destructive/50 hover:text-destructive">{t} ×</button>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Input placeholder="nova tag" value={novo[a.id] ?? ""} onChange={(e) => setNovo({ ...novo, [a.id]: e.target.value })} className="h-8 text-xs" />
                <button type="button" className={btn()} onClick={() => {
                  const v = (novo[a.id] ?? "").trim().toLowerCase()
                  if (!v) return
                  salvarTags(a.id, [...a.tags, v]); setNovo({ ...novo, [a.id]: "" })
                }}>Adicionar</button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

function EquipeSection() {
  const toast = useToast()
  const [users, setUsers] = useState<{ id: string; nome: string; email: string; role: Role }[]>([])
  const carregar = async () => {
    const { data } = await supabase.from("usuarios").select("id,nome,email,role").order("nome")
    setUsers(((data ?? []) as { id: string; nome: string; email: string; role: Role }[]))
  }
  useEffect(() => { carregar() }, [])

  const trocar = async (id: string, role: Role) => {
    const { error } = await supabase.from("usuarios").update({ role }).eq("id", id)
    if (error) { toast("Falha.", "error"); return }
    toast("Perfil atualizado.")
    carregar()
  }

  return (
    <Card>
      <CardHeader><CardTitle>Equipe ({users.length})</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <THead><TR><TH>Nome</TH><TH>E-mail</TH><TH>Perfil</TH></TR></THead>
          <tbody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD>{u.nome}</TD>
                <TD className="text-xs text-muted-foreground">{u.email}</TD>
                <TD>
                  <Select value={u.role} onChange={(e) => trocar(u.id, e.target.value as Role)} className="h-8 text-xs">
                    {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </Select>
                </TD>
              </TR>
            ))}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  )
}

const VARIANTS = ["blue", "indigo", "sky", "cyan", "violet", "orange", "slate", "teal", "purple", "amber", "accent", "green", "gray", "red"]

function PipelinesSection() {
  const toast = useToast()
  const [rows, setRows] = useState<StageRow[]>([])
  const [faltaTabela, setFaltaTabela] = useState(false)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [saving, setSaving] = useState<string | null>(null)
  const [novaEtapa, setNovaEtapa] = useState("")
  const [novaChave, setNovaChave] = useState<Record<string, string>>({})

  const carregar = async () => {
    const r = await listStages()
    setRows(r.rows); setFaltaTabela(r.faltaTabela)
    const out: Record<string, number> = {}
    await Promise.all(LEAD_STATUSES.map(async (s) => {
      try {
        const q = await supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", s)
        out[s] = (q as { count: number | null }).count ?? 0
      } catch { out[s] = -1 }
    }))
    setCounts(out)
  }
  useEffect(() => { carregar() }, [])

  const salvar = async (row: StageRow) => {
    setSaving(row.key)
    const r = await saveStage(row)
    setSaving(null)
    if (!r.ok) { toast(`Falha: ${r.erro}`, "error"); return }
    toast(`Etapa "${row.label}" salva — recarregando para aplicar.`)
    setTimeout(() => window.location.reload(), 800)
  }

  const set = (key: string, patch: Partial<StageRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const [aberta, setAberta] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader><CardTitle>Pipeline de vendas (editável)</CardTitle></CardHeader>
      <CardContent>
        {faltaTabela && (
          <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
            Rode <code>scripts/027_pipeline_stages.sql</code> no Supabase e recarregue. Sem a tabela, valem os valores do código.
          </p>
        )}
        <p className="mb-2 text-xs text-muted-foreground">Etapas de sistema têm a chave travada (automações dependem delas) — rótulo/cor/ordem liberados. Etapas custom valem como vitrine (kanban/filtros).</p>
        <div className="mb-2 flex flex-wrap gap-2">
          <Input placeholder="Nova etapa (ex.: Pós-venda)" value={novaEtapa} onChange={(e) => setNovaEtapa(e.target.value)} className="h-8 max-w-56 text-xs" />
          <button type="button" className={btn(true)} onClick={async () => {
            if (!novaEtapa.trim()) { toast("Dê um nome.", "error"); return }
            const r = await createStage(novaEtapa.trim())
            if (!r.ok) { toast(`Falha: ${r.erro}`, "error"); return }
            toast(`Etapa criada.`)
            setNovaEtapa(""); carregar()
          }}>Criar etapa</button>
        </div>
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const open = aberta === r.key
            const n = counts[r.key]
            return (
              <div key={r.key} className="rounded-xl border border-border">
                <button type="button" onClick={() => setAberta(open ? null : r.key)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: r.accent }} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.label}</span>
                    <span className="block font-mono text-[11px] text-muted-foreground">{r.key} · ordem {r.ordem}</span>
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums">
                    {n === undefined ? "…" : n < 0 ? "?" : n}
                  </span>
                  <span className="flex gap-1 text-[11px]">
                    {!r.visivel_corretor && <span className="rounded-full border border-border px-1.5 py-0.5 text-muted-foreground">gestor</span>}
                    {!r.ativo && <span className="rounded-full border border-dashed border-border px-1.5 py-0.5 text-muted-foreground">off</span>}
                  </span>
                  <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
                </button>
                {open && (
                  <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
                    <div className="grid gap-1.5"><Label>Rótulo</Label>
                      <Input value={r.label} onChange={(e) => set(r.key, { label: e.target.value })} className="h-8 text-xs" /></div>
                    <div className="grid gap-1.5"><Label>Chave {SYSTEM_STAGE_KEYS.has(r.key) ? "(sistema: travada)" : "(muda etapa + leads)"}</Label>
                      {SYSTEM_STAGE_KEYS.has(r.key) ? (
                        <span className="font-mono text-[11px] text-muted-foreground">{r.key} 🔒</span>
                      ) : (
                        <div className="flex gap-1">
                          <Input value={novaChave[r.key] ?? r.key} onChange={(e) => setNovaChave({ ...novaChave, [r.key]: e.target.value })} className="h-8 font-mono text-xs" />
                          <button type="button" className={btn()} onClick={async () => {
                            const nk = (novaChave[r.key] ?? "").trim()
                            if (!nk || nk === r.key) return
                            const res = await renameStageKey(r.key, nk)
                            if (!res.ok) { toast(`Falha: ${res.erro}`, "error"); return }
                            toast("Chave renomeada — recarregando.")
                            setTimeout(() => window.location.reload(), 800)
                          }}>Mudar</button>
                        </div>
                      )}</div>
                    <div className="grid gap-1.5"><Label>Ordem</Label>
                      <Input type="number" value={r.ordem} onChange={(e) => set(r.key, { ordem: Number(e.target.value) })} className="h-8 text-xs" /></div>
                    <div className="grid gap-1.5"><Label>Cor</Label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={r.accent} onChange={(e) => set(r.key, { accent: e.target.value })} className="h-8 w-10 cursor-pointer rounded border border-input bg-background" />
                        <Select value={r.variant} onChange={(e) => set(r.key, { variant: e.target.value })} className="h-8 text-xs">
                          {VARIANTS.map((v) => <option key={v} value={v}>{v}</option>)}
                        </Select>
                      </div></div>
                    <div className="flex items-end gap-4 pb-1">
                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.visivel_corretor} onChange={(e) => set(r.key, { visivel_corretor: e.target.checked })} className="size-4" /> Corretor vê</label>
                      <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={r.ativo} onChange={(e) => set(r.key, { ativo: e.target.checked })} className="size-4" /> Ativa</label>
                      <button type="button" disabled={saving === r.key} onClick={() => salvar(r)} className={btn(true)}>Salvar</button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function RelatoriosSection() {
  const [dias, setDias] = useState(7)
  const [vals, setVals] = useState<Record<string, number | string>>({})
  useEffect(() => {
    ;(async () => {
      const corte = new Date(Date.now() - dias * 86400000).toISOString()
      const out: Record<string, number | string> = {}
      const jobs = async (status: string) => {
        try {
          const r = await supabase.from("automation_jobs").select("id", { count: "exact", head: true }).eq("status", status).gte("sent_at", corte)
          return (r as { count: number | null }).count ?? 0
        } catch { return "?" }
      }
      const logs = async (ev: string) => {
        try {
          const r = await supabase.from("automation_logs").select("id", { count: "exact", head: true }).eq("event_type", ev).gte("created_at", corte)
          return (r as { count: number | null }).count ?? 0
        } catch { return "?" }
      }
      out.respostas_ia = await logs("ia_resposta_enviada")
      out.handoffs = await logs("ia_handoff_humano")
      out.triagens = await logs("lead_followup_sem_resposta_triagem")
      out.reativacoes = await logs("lead_reativado_trafego_pago_reativacao_base")
      out.msgs_enviadas = await jobs("sent")
      setVals(out)
    })()
  }, [dias])

  return (
    <Card>
      <CardHeader><CardTitle>Relatórios</CardTitle></CardHeader>
      <CardContent>
        <Select value={String(dias)} onChange={(e) => setDias(Number(e.target.value))} className="mb-3 h-8 w-40 text-xs">
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
        </Select>
        <div className="grid gap-2 sm:grid-cols-2">
          {[["Respostas da IA", vals.respostas_ia], ["Handoffs p/ humano", vals.handoffs], ["Reativações de base", vals.reativacoes], ["Triagens humanas", vals.triagens], ["Msgs automação enviadas", vals.msgs_enviadas]].map(([label, v]) => (
            <div key={label as string} className="rounded-lg border border-border p-3">
              <p className="text-2xl font-bold">{v === undefined ? "…" : v}</p>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AgenciaSection() {
  const toast = useToast()
  const [contas, setContas] = useState<Workspace[]>([])
  const [faltaTabela, setFaltaTabela] = useState(false)
  const [slug, setSlug] = useState("")
  const [nome, setNome] = useState("")

  const carregar = async () => {
    const rows = await listWorkspaces()
    setContas(rows)
    setFaltaTabela(false)
    if (!rows.length) {
      try {
        const r = await supabase.from("workspaces").select("id").limit(1)
        if (r.error) setFaltaTabela(true)
      } catch { setFaltaTabela(true) }
    }
  }
  useEffect(() => { carregar() }, [])

  const criar = async () => {
    if (!slug.trim()) { toast("Informe o slug (ex.: cliente-x).", "error"); return }
    const r = await createWorkspace(slug, nome)
    if (!r.ok) { toast(`Falha: ${r.erro}`, "error"); return }
    toast(`Conta criada. Isolamento total vem na Fase B; por ora, provisione a infra dela.`)
    setSlug(""); setNome(""); carregar()
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Contas (agência) — Fase A: cadastro</CardTitle></CardHeader>
        <CardContent>
          {faltaTabela && (
            <p className="mb-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
              Rode <code>scripts/028_workspaces.sql</code> no Supabase e recarregue.
            </p>
          )}
          <Table>
            <THead><TR><TH>Slug</TH><TH>Nome</TH><TH>Status</TH></TR></THead>
            <tbody>
              {contas.map((c) => (
                <TR key={c.id}>
                  <TD className="font-mono text-xs">{c.slug}</TD>
                  <TD>{c.name}</TD>
                  <TD><Badge>{c.active ? "ativa" : "pausada"}</Badge></TD>
                </TR>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input placeholder="slug (ex.: imobiliaria-y)" value={slug} onChange={(e) => setSlug(e.target.value)} className="h-9 max-w-56 text-xs" />
            <Input placeholder="nome da conta" value={nome} onChange={(e) => setNome(e.target.value)} className="h-9 max-w-56 text-xs" />
            <button type="button" onClick={criar} className={btn(true)}>Criar conta</button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Fase B: isolamento por módulo, onboarding (usuários/marca/pipelines da conta) e suspensão.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function ClonarSection() {
  const toast = useToast()

  const exportar = async () => {
    try {
      const get = async (t: string, sel = "*") => (await supabase.from(t).select(sel).limit(5000)).data ?? []
      const pack = {
        exportado_em: new Date().toISOString(),
        workspace_settings: await get("workspace_settings"),
        pipeline_stages: await get("pipeline_stages"),
        ai_agents: await get("ai_agents"),
        automations: await get("automations"),
        automation_message_templates: await get("automation_message_templates"),
      }
      const blob = new Blob([JSON.stringify(pack, null, 1)], { type: "application/json" })
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob)
      a.download = `crm-clone-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(a.href)
      toast("Pacote de clone baixado.")
    } catch { toast("Falha ao exportar.", "error") }
  }

  const importar = async (f: File) => {
    try {
      const pack = JSON.parse(await f.text()) as Record<string, { id?: string }[]>
      for (const t of ["workspace_settings", "pipeline_stages", "ai_agents", "automations", "automation_message_templates"] as const) {
        const rows = pack[t] ?? []
        for (const row of rows) {
          const { error } = await supabase.from(t).upsert(row, { onConflict: "id" })
          if (error) throw new Error(`${t}: ${error.message}`)
        }
      }
      toast("Clone restaurado.")
    } catch (e) { toast(`Falha: ${e instanceof Error ? e.message : e}`, "error") }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Clonar workspace</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">Exporta marca + IAs + automações + templates em JSON. Importar restaura por id (sobrescreve). Infra (projeto Vercel + banco novo) segue roteiro à parte.</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={exportar} className={btn(true)}>Exportar clone</button>
          <Label className={btn()}>Importar clone
            <input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = "" }} />
          </Label>
        </div>
        <Textarea readOnly rows={6} className="mt-3 text-[11px]" value={"Roteiro infra do clone:\n1. Novo projeto no Supabase → rode scripts/002..026 em ordem\n2. Novo projeto na Vercel (mesmo repo/branch) + envs\n3. Importe este JSON no Master do novo CRM\n4. Reconecte Evolution/Meta"} />
      </CardContent>
    </Card>
  )
}
