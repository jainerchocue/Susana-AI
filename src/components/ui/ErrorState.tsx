import { cn } from '@/utils/cn'
import { Button } from './Button'

export function ErrorState({
  title = 'No se pudo cargar la información',
  description = 'Ocurrió un problema al obtener los datos. Intente nuevamente.',
  onRetry,
  className,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'animate-fade-in flex flex-col items-center justify-center gap-2 px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm font-medium text-status-critical">{title}</p>
      <p className="max-w-sm text-xs text-ink-500">{description}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry} className="mt-2">
          Reintentar
        </Button>
      )}
    </div>
  )
}
