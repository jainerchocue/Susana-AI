import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export interface PageHeaderProps {
  title: ReactNode
  description?: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  className?: string
}

/**
 * Cabecera estándar de página: título, descripción, icono opcional y zona de
 * acciones a la derecha — usada por todas las secciones para mantener jerarquía.
 */
export function PageHeader({ title, description, icon, actions, className }: PageHeaderProps) {
  return (
    <header className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-1 text-ink-300">{icon}</span>}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink-950">{title}</h1>
          {description && <p className="mt-1 max-w-2xl text-sm text-ink-500">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}