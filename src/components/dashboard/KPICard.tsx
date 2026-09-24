import type { SVGProps } from 'react'
import type { KPIStatus, Trend } from '@/types'
import { AnimatedNumber, Badge, Card, Skeleton } from '@/components/ui'
import { cn } from '@/utils/cn'
import { formatNumber, formatPercent } from '@/utils/format'

export interface KPICardProps {
  title: string
  value: number
  unit: string
  trend?: Trend
  trendValue?: number
  period: string
  status: KPIStatus
  description?: string
  isLoading?: boolean
}

const STATUS_LABELS: Record<KPIStatus, string> = {
  good: 'Bueno',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Crítico',
}

const STATUS_BAR_CLASSES: Record<KPIStatus, string> = {
  good: 'bg-status-good',
  medium: 'bg-status-medium',
  high: 'bg-status-high',
  critical: 'bg-status-critical',
}

const TREND_ICON_PATHS: Record<Trend, string> = {
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  flat: 'M5 12h14',
}

const TREND_CHIP_CLASSES: Record<Trend, string> = {
  up: 'bg-status-good-bg text-status-good',
  down: 'bg-status-critical-bg text-status-critical',
  flat: 'bg-surface-100 text-ink-500',
}

const TREND_LABELS: Record<Trend, string> = {
  up: 'Tendencia al alza',
  down: 'Tendencia a la baja',
  flat: 'Tendencia estable',
}

function TrendIcon({ trend, ...props }: { trend: Trend } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={TREND_ICON_PATHS[trend]} />
    </svg>
  )
}

/** Tarjeta compacta para mostrar un indicador clave (KPI) del dashboard. */
export function KPICard({
  title,
  value,
  unit,
  trend,
  trendValue,
  period,
  status,
  description,
  isLoading = false,
}: KPICardProps) {
  if (isLoading) {
    return (
      <Card className="relative overflow-hidden p-5" aria-busy="true">
        <span className="absolute inset-y-0 left-0 w-1 bg-surface-100" aria-hidden="true" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-9 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </Card>
    )
  }

  const formatValue = (raw: number) => (unit === '%' ? formatPercent(raw) : formatNumber(raw))
  const signedTrendValue =
    typeof trendValue === 'number' ? `${trendValue > 0 ? '+' : ''}${formatPercent(trendValue)}` : null

  return (
    <Card
      interactive
      className={cn(
        'animate-fade-up relative overflow-hidden p-5',
        status === 'critical' && 'ring-1 ring-status-critical/20',
      )}
    >
      <span
        className={cn('absolute inset-y-0 left-0 w-1', STATUS_BAR_CLASSES[status])}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-2">
        <h3 className="flex-1 text-sm font-medium text-ink-500">{title}</h3>
        <Badge tone={status} pulse={status === 'critical'}>
          {STATUS_LABELS[status]}
        </Badge>
      </div>

      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-3xl font-semibold tabular-nums tracking-tight text-ink-950">
          <AnimatedNumber value={value} format={formatValue} />
        </span>
        {unit !== '%' && <span className="text-sm font-medium text-ink-500">{unit}</span>}
      </div>

      {(trend || period) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {trend && (
            <span
              className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', TREND_CHIP_CLASSES[trend])}
            >
              <TrendIcon trend={trend} />
              <span className="sr-only">{TREND_LABELS[trend]}</span>
              {signedTrendValue && <span>{signedTrendValue}</span>}
            </span>
          )}
          <span className="text-xs text-ink-500">{period}</span>
        </div>
      )}

      {description && <p className="mt-2 text-xs text-ink-300">{description}</p>}
    </Card>
  )
}