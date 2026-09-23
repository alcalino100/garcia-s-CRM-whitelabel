import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

// Cabeçalho de página: pill hairline + título display + subtítulo.
export function PageHeading({
  title,
  subtitle,
  badge,
  className,
}: {
  title: React.ReactNode
  subtitle?: React.ReactNode
  badge?: string
  className?: string
}) {
  return (
    <div className={cn("min-w-0", className)}>
      {badge && (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Sparkles className="size-3.5" />
          {badge}
        </span>
      )}
      <h1 className={cn("font-display text-3xl font-extrabold tracking-tight sm:text-4xl", badge && "mt-2.5")}>
        <span className="text-foreground">{title}</span>
      </h1>
      {subtitle && <p className="mt-1 max-w-xl text-sm text-muted-foreground text-pretty">{subtitle}</p>}
    </div>
  )
}
