import LoginForm from "@/components/LoginForm"
import { fetchBrandServer } from "@/lib/brand-server"
import { BRAND_DEFAULTS } from "@/lib/master"

// Página server-side: a logo da marca sai NO HTML (zero dependência de JS/hidratação).
export default async function LoginPage() {
  const brand = await fetchBrandServer().catch(() => BRAND_DEFAULTS)
  const logo = brand.logo_url || "/logo-colucci.png"

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-primary/95 p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 right-1/4 h-80 w-80 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute bottom-[-6rem] left-1/4 h-72 w-72 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute right-[-4rem] top-1/2 h-64 w-64 rounded-full bg-white/5 blur-3xl" />
      </div>
      <div className="relative w-full max-w-md rounded-2xl border-2 border-foreground bg-card p-8 shadow-[8px_8px_0_0_rgb(0_0_0/0.85)]">
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent" />
        <div className="mb-8 flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} alt={brand.brand_name} className="mb-5 h-20 w-auto" />
          <p className="text-sm text-muted-foreground">Acesse sua conta para continuar</p>
        </div>

        <LoginForm />
      </div>
    </main>
  )
}
