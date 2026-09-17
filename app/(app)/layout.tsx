"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { BellRing, Building2, CalendarDays, KanbanSquare, LayoutDashboard, LogOut, Menu, KeyRound, Shield, ScrollText, BarChart3, ClipboardCheck, FileSignature, MessageCircle, MessagesSquare, UserCircle, UsersRound, X, Handshake, UserPlus, Zap, Workflow, Inbox, ChevronDown, Bot, Crown } from "lucide-react"
import { useAuth } from "@/lib/auth-context"
import type { Role } from "@/lib/mock-data"
import { isAdminRole, isGestorNivel, nivelRole, podeLocacao, podeVendas } from "@/lib/roles"
import { applyBrand, isMasterEmail, loadBrand, type BrandSettings } from "@/lib/master"
import { ToastProvider } from "@/components/ui/primitives"
import { BRTClock } from "@/lib/timezone"
import { LeadsProvider, useLeads } from "@/lib/leads-store"
import { LocacaoProvider } from "@/lib/locacao-store"
import { AutomationProvider } from "@/lib/automation-store"
import { PresenceProvider } from "@/lib/presence"
import { EmergencyPauseButton } from "@/components/automation/EmergencyPauseButton"
import { ColucciLogo } from "@/components/colucci-logo"
import { NotificationBell } from "@/components/notification-bell"
import { DailySummary } from "@/components/daily-summary"
import { SaleCelebrationProvider } from "@/components/sale-celebration"
import { cn } from "@/lib/utils"

// Mostra a foto de perfil (se houver) ou as iniciais. Precisa estar dentro do LeadsProvider.
function TopbarAvatar({ userId, initials }: { userId: string; initials: string }) {
  const { users } = useLeads()
  const avatar = users.find((u) => u.id === userId)?.avatar
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar || "/placeholder.svg"} alt="Foto de perfil" className="size-9 rounded-full object-cover" />
  }
  return <div className="flex size-9 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{initials}</div>
}

const NAV: { href: string; label: string; icon: any; roles: Role[] }[] = [
  { href: "/inbox", label: "Inbox", icon: Inbox, roles: ["gestor"] },
  { href: "/contacts", label: "Contacts", icon: UsersRound, roles: ["gestor"] },
  { href: "/follow-ups", label: "Follow-ups", icon: Zap, roles: ["gestor"] },
  { href: "/painel-corretor", label: "Kanban", icon: KanbanSquare, roles: ["corretor", "gestor"] },
  { href: "/agenda", label: "Agenda", icon: CalendarDays, roles: ["corretor", "gestor"] },
  { href: "/dashboard-gestao", label: "Dashboard", icon: LayoutDashboard, roles: ["gestor"] },
  { href: "/chat", label: "Chat", icon: MessagesSquare, roles: ["gestor"] },
  { href: "/cadastros", label: "Leads Cadastrados", icon: UserPlus, roles: ["gestor"] },
  { href: "/fechamento", label: "Fechamentos", icon: Handshake, roles: ["gestor"] },
  { href: "/auditoria", label: "Auditoria de Leads", icon: ClipboardCheck, roles: ["gestor"] },
  { href: "/auditoria/registros", label: "Registros de Auditoria", icon: ScrollText, roles: ["gestor"] },
  { href: "/meta-ads", label: "Meta Ads", icon: BarChart3, roles: ["gestor"] },
  { href: "/configuracoes/whatsapp", label: "Conexões WhatsApp", icon: MessageCircle, roles: ["gestor"] },
  { href: "/perfil", label: "Meu Perfil", icon: UserCircle, roles: ["corretor", "gestor"] },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, roles: ["leitor"] },
]

const NAV_LOCACAO: { href: string; label: string; icon: any; roles: Role[] }[] = [
  { href: "/locacao", label: "Kanban de Locação", icon: Building2, roles: ["corretor", "gestor"] },
  { href: "/locacao/leads", label: "Leads de Locação", icon: UsersRound, roles: ["corretor", "gestor"] },
  { href: "/locacao/agenda", label: "Agenda de Locação", icon: CalendarDays, roles: ["corretor", "gestor"] },
  { href: "/locacao/contratos", label: "Contratos", icon: FileSignature, roles: ["gestor"] },
  { href: "/locacao/dashboard", label: "Dashboard Locação", icon: BarChart3, roles: ["gestor"] },
  { href: "/locacao/auditoria", label: "Registros de Auditoria", icon: ScrollText, roles: ["gestor"] },
]

const NAV_AUTOMACOES: { href: string; label: string; icon: any; roles: Role[] }[] = [
  { href: "/automacoes", label: "Dashboard Automações", icon: LayoutDashboard, roles: ["gestor"] },
  { href: "/automacoes/fluxos", label: "Fluxos de Automação", icon: Workflow, roles: ["gestor"] },
  { href: "/automacoes/regras", label: "Regras de Automação", icon: Zap, roles: ["gestor"] },
  { href: "/automacoes/fila", label: "Fila de Envios", icon: ClipboardCheck, roles: ["gestor"] },
  { href: "/automacoes/logs", label: "Logs de Automação", icon: ScrollText, roles: ["gestor"] },
]

const NAV_IA: { href: string; label: string; icon: any; roles: Role[] }[] = [
  { href: "/ai-agents", label: "IA Conversacional", icon: Bot, roles: ["gestor"] },
]

const NAV2: { href: string; label: string; icon: any; roles: Role[] }[] = [
  { href: "/admin", label: "Administração", icon: Shield, roles: ["gestor"] },
  { href: "/admin/notificacoes", label: "Disparador de Notificações", icon: BellRing, roles: ["gestor"] },
  { href: "/admin/logs", label: "Logs", icon: ScrollText, roles: ["gestor"] },
]

// Gestor de módulo (vendas/locação) gerencia a própria equipe pelo Gestão de Acessos
const ACESSOS_LINK: { href: string; label: string; icon: any; roles: Role[] } = {
  href: "/admin/acessos",
  label: "Gestão de Acessos",
  icon: KeyRound,
  roles: ["gestor"],
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [gestorQuery, setGestorQuery] = useState("")
  const [secVendas, setSecVendas] = useState(true)
  const [secLocacao, setSecLocacao] = useState(false)
  const [secAutomacoes, setSecAutomacoes] = useState(false)
  const [secIA, setSecIA] = useState(true)
  const [secAdmin, setSecAdmin] = useState(false)
  const [brand, setBrand] = useState<BrandSettings | null>(null)

  // White-label: aplica marca salva (cor + título); logo troca na sidebar.

  // Mantém link do Kanban/Dashboard com filtros salvos do gestor — contínuo para Voltar/Avançar e sidebar
  useEffect(() => {
    if (!user || !isGestorNivel(user.role) || typeof window === "undefined") { setGestorQuery(""); return }
    const read = () => {
      try {
        const s = window.localStorage.getItem(`crm-filtros:${user.id}`)
        setGestorQuery(s ? `?${s}` : "")
      } catch { setGestorQuery("") }
    }
    read()
    const onStorage = (e: StorageEvent | Event) => read()
    window.addEventListener("storage", onStorage)
    window.addEventListener("crm-filtros-change", onStorage as EventListener)
    // re-ler ao mudar de rota (sidebar, back/forward)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("crm-filtros-change", onStorage as EventListener)
    }
  }, [user, pathname])

  useEffect(() => {
    loadBrand().then((r) => { applyBrand(r.settings); setBrand(r.settings) }).catch(() => {})
    import("@/lib/pipeline-stages").then((m) => m.loadStagesOverride().catch(() => {})).catch(() => {})
  }, [])

  useEffect(() => {
    if (!loading && !user) router.replace("/login")
  }, [loading, user, router])

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (pathname.startsWith("/locacao")) setSecLocacao(true)
    if (pathname.startsWith("/automacoes")) setSecAutomacoes(true)
    if (pathname.startsWith("/ai-agents")) setSecIA(true)
    if (pathname.startsWith("/admin")) setSecAdmin(true)
    if (pathname.startsWith("/master")) setSecAdmin(true)
    if (pathname.startsWith("/inbox") || pathname.startsWith("/painel-corretor") || pathname.startsWith("/contacts") || pathname.startsWith("/follow-ups")) setSecVendas(true)
  }, [pathname])

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Carregando...</div>
  }

  const nivel = nivelRole(user.role)
  const nivelName = nivel === "master" ? "gestor" : nivel
  const canNivel = (roles: Role[]) => roles.includes(nivelName as Role)
  const items = NAV.filter((n) => podeVendas(user.role) && canNivel(n.roles))
  const itemsLocacao = NAV_LOCACAO.filter((n) => podeLocacao(user.role) && canNivel(n.roles))
  const itemsAutomacoes = NAV_AUTOMACOES.filter((n) => isAdminRole(user.role))
  const itemsIA = NAV_IA.filter((n) => isGestorNivel(user.role))
  const items2 = NAV2.filter((n) => isAdminRole(user.role))
  // Gestor de módulo (ex.: gestor_locacao) vê Gestão de Acessos na seção do seu módulo
  const isModuleGestor = isGestorNivel(user.role) && !isAdminRole(user.role)
  if (isModuleGestor) {
    if (podeVendas(user.role)) items.push(ACESSOS_LINK)
    if (podeLocacao(user.role)) itemsLocacao.push(ACESSOS_LINK)
  } else if (isAdminRole(user.role)) {
    // Admin legado e master gerenciam toda a equipe pela seção Administração
    items2.push(ACESSOS_LINK)
  }
  // Painel Master: SOMENTE o e-mail do proprietário (invisível aos demais)
  if (user && isMasterEmail(user.email)) {
    items2.push({ href: "/master", label: "Master", icon: Crown, roles: ["gestor"] })
  }
  const initials = user.nome.split(" ").map((n) => n[0]).slice(0, 2).join("")

  function handleLogout() {
    logout()
    router.replace("/login")
  }

  function renderItems(navItems: { href: string; label: string; icon: any }[]) {
    return navItems.map((item) => {
      const active = item.href === "/admin" || item.href === "/auditoria" || item.href === "/locacao" || item.href === "/automacoes"
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(item.href + "/")
      const href = (item.href === "/painel-corretor" || item.href === "/dashboard-gestao") && gestorQuery && !item.href.includes("?")
        ? `${item.href}${gestorQuery}` : item.href
      return (
        <Link key={item.href} href={href}
          className={cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
            active ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-white")}>
          <item.icon className="size-4.5" />
          {item.label}
        </Link>
      )
    })
  }

  const SidebarContent = (
    <>
      <div className="flex items-center px-5 py-5">
        {brand?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logo_url} alt={brand.brand_name} className="h-10 w-auto rounded-lg bg-white px-3 py-2 shadow-sm" />
        ) : (
          <ColucciLogo />
        )}
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3">
        {items.length > 0 && (
          <div>
            <button onClick={()=>setSecVendas(v=>!v)} className="flex w-full items-center justify-between px-3 pt-2 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <span>Vendas</span><ChevronDown className={`size-3.5 transition ${secVendas ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {secVendas && <div className="mt-1 flex flex-col gap-1">{renderItems(items)}</div>}
          </div>
        )}
        {itemsLocacao.length > 0 && (
          <div>
            <button onClick={()=>setSecLocacao(v=>!v)} className="flex w-full items-center justify-between px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <span>Locação</span><ChevronDown className={`size-3.5 transition ${secLocacao ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {secLocacao && <div className="mt-1 flex flex-col gap-1">{renderItems(itemsLocacao)}</div>}
          </div>
        )}
        {itemsAutomacoes.length > 0 && (
          <div>
            <button onClick={()=>setSecAutomacoes(v=>!v)} className="flex w-full items-center justify-between px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <span>Automações</span><ChevronDown className={`size-3.5 transition ${secAutomacoes ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {secAutomacoes && <div className="mt-1 flex flex-col gap-1">{renderItems(itemsAutomacoes)}</div>}
          </div>
        )}
        {itemsIA.length > 0 && (
          <div>
            <button onClick={()=>setSecIA(v=>!v)} className="flex w-full items-center justify-between px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <span>IA Conversacional</span><ChevronDown className={`size-3.5 transition ${secIA ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {secIA && <div className="mt-1 flex flex-col gap-1">{renderItems(itemsIA)}</div>}
          </div>
        )}
        {items2.length > 0 && (
          <div>
            <button onClick={()=>setSecAdmin(v=>!v)} className="flex w-full items-center justify-between px-3 pt-4 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 hover:text-sidebar-foreground">
              <span>Administração</span><ChevronDown className={`size-3.5 transition ${secAdmin ? "rotate-0" : "-rotate-90"}`} />
            </button>
            {secAdmin && <div className="mt-1 flex flex-col gap-1">{renderItems(items2)}</div>}
          </div>
        )}
      </nav>
      <div className="border-t border-sidebar-border px-3 py-4">
        {isAdminRole(user.role) && (
          <div className="mb-3">
            <EmergencyPauseButton compact />
          </div>
        )}
        <span className="px-3 text-xs uppercase tracking-wide text-sidebar-foreground/70">
          {nivel === "master" ? "Gestor Master" : nivel === "gestor" ? "Gestor" : nivel === "leitor" ? "Leitor" : "Corretor"}
        </span>
      </div>
    </>
  )

  return (
    <ToastProvider>
      <SaleCelebrationProvider>
      <LeadsProvider>
      <AutomationProvider>
      <LocacaoProvider>
      <PresenceProvider>
      <DailySummary />
      <div className="flex min-h-screen bg-background">
        {/* Sidebar desktop */}
        <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col bg-sidebar lg:flex">{SidebarContent}</aside>

        {/* Sidebar mobile */}
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-foreground/40" onClick={() => setOpen(false)} />
            <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-sidebar">
              <button onClick={() => setOpen(false)} aria-label="Fechar menu" className="absolute right-3 top-4 text-sidebar-foreground"><X className="size-5" /></button>
              {SidebarContent}
            </aside>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col overflow-x-hidden lg:pl-64">
          {/* Topbar */}
          <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card px-4 lg:px-6">
            <button onClick={() => setOpen(true)} aria-label="Abrir menu" className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden">
              <Menu className="size-5" />
            </button>
            <div className="ml-auto flex items-center gap-3">
              <BRTClock />
              <NotificationBell />
              <div className="text-right">
                <p className="text-sm font-medium leading-tight">{user.nome}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
              <TopbarAvatar userId={user.id} initials={initials} />
              <button onClick={handleLogout} aria-label="Sair" className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-destructive">
                <LogOut className="size-5" />
              </button>
            </div>
          </header>

          <main className="relative min-w-0 flex-1 overflow-x-hidden p-4 lg:p-6">
            {/* Leve toque de cor de fundo, discreto */}
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -top-32 left-1/2 h-96 w-[40rem] -translate-x-1/2 rounded-full bg-primary/[0.04] blur-3xl" />
            </div>
            <div className="relative z-10">{children}</div>
          </main>
        </div>
      </div>
      </PresenceProvider>
      </LocacaoProvider>
      </AutomationProvider>
      </LeadsProvider>
      </SaleCelebrationProvider>
    </ToastProvider>
  )
}
