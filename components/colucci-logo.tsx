export function ColucciLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center rounded-lg bg-white px-3 py-2 shadow-sm">
      <img
        src="/logo-colucci.png"
        alt="Logotipo da imobiliária"
        className={compact ? "h-8 w-auto" : "h-10 w-auto"}
      />
    </div>
  )
}
