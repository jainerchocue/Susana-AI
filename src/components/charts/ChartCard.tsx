import type { ReactNode } from 'react'
import { Card, CardBody, CardHeader, EmptyState, ErrorState, Skeleton } from '@/components/ui'
import { cn } from '@/utils/cn'
import { getDisplayErrorMessage } from '@/utils/errors'

export interface ChartCardProps {
  /** Título del gráfico, mostrado en el encabezado de la tarjeta. */
  title: string
  /** Unidad de medida mostrada junto al título (p. ej. "%", "min"). */
  unit?: string
  /** Período que describen los datos (p. ej. "Últimos 7 días"). */
  period?: string
  isLoading?: boolean
  isError?: boolean
  error?: unknown
  onRetry?: () => void
  /** Indica si no hay datos para graficar. Acepta un booleano o una función perezosa. */
  isEmpty?: boolean | (() => boolean)
  /** Leyenda opcional mostrada debajo del gráfico. */
  legend?: ReactNode
  /** El gráfico en sí (p. ej. un ResponsiveContainer de Recharts). */
  children: ReactNode
  className?: string
}

/**
 * Envoltorio estándar para gráficos: título, unidad, período, leyenda y los
 * estados de carga / error / vacío requeridos por cada visualización.
 */
export function ChartCard({
  title,
  unit,
  period,
  isLoading = false,
  isError = false,
  error,
  onRetry,
  isEmpty = false,
  legend,
  children,
  className,
}: ChartCardProps) {
  const empty = typeof isEmpty === 'function' ? isEmpty() : isEmpty

  return (
    <Card className={cn('animate-fade-up flex flex-col', className)}>
      <CardHeader
        title={
          <span className="inline-flex items-baseline gap-1.5">
            {title}
            {unit && <span className="text-xs font-normal text-ink-500">({unit})</span>}
          </span>
        }
        subtitle={period}
      />
      <CardBody className="flex flex-col gap-3">
        {isLoading ? (
          <Skeleton className="h-65 w-full" />
        ) : isError ? (
          <ErrorState description={getDisplayErrorMessage(error)} onRetry={onRetry} />
        ) : empty ? (
          <EmptyState description="No hay datos disponibles para el período seleccionado." />
        ) : (
          <>
            <div className="h-70 w-full">{children}</div>
            {legend && <div className="text-xs text-ink-500">{legend}</div>}
          </>
        )}
      </CardBody>
    </Card>
  )
}
