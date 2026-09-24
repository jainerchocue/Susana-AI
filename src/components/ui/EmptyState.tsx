import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'

export function EmptyState({
  title = 'Sin datos disponibles',
  description,
  icon,
  action,
  className,
}: {
  title?: string
  description?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'animate-fade-in flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      {icon && <div className="mb-1 text-ink-300">{icon}</div>}
      <p className="text-sm font-medium text-ink-700">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-500">{description}</p>}
      {action}
    </div>
  )
}
