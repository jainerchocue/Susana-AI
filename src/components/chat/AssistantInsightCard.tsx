import type { AssistantInsight, TrendDirection } from '@/features/assistant/insights'
import { AnimatedNumber } from '@/components/ui'
import { IconSparkles } from '@/components/ui/icons'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

const TREND_STYLES: Record<TrendDirection, { classes: string; arrowPath: string; label: string }> = {
  up: { classes: 'bg-status-good-bg text-status-good', arrowPath: 'M6 15l6-6 6 6', label: 'Al alza' },
  down: { classes: 'bg-status-critical-bg text-status-critical', arrowPath: 'M6 9l6 6 6-6', label: 'A la baja' },
  flat: { classes: 'bg-surface-100 text-ink-500', arrowPath: 'M5 12h14', label: 'Estable' },
}

/**
 * Cifra concreta destacada, derivada de los datos reales que ejecutó el backend
 * (nunca del texto libre del modelo). "Tendencia" describe el último punto de la
 * serie frente al anterior — es lectura de datos históricos, no una predicción.
 */
export function AssistantInsightCard({ insight }: { insight: AssistantInsight }) {
  const trendStyle = insight.trend ? TREND_STYLES[insight.trend.direction] : null

  return (
    <div className="animate-scale-in relative overflow-hidden rounded-2xl border border-brand-100 bg-white p-4 shadow-glow-brand">
      <span
        className="pointer-events-none absolute -right-8 -top-10 h-24 w-24 rounded-full bg-accent-400/15 blur-2xl"
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-brand-600">
            <IconSparkles className="h-3 w-3" aria-hidden="true" />
            Dato destacado
          </span>

          {insight.isTopOfMultiple && insight.groupLabel && (
            <p className="mt-1.5 truncate text-sm font-medium text-ink-700">{insight.groupLabel}</p>
          )}

          <AnimatedNumber
            value={insight.value}
            format={(value) => formatNumber(value, 0)}
            className="mt-0.5 block text-3xl font-bold tabular-nums tracking-tight text-ink-950"
          />
          <p className="text-xs text-ink-500 capitalize">{insight.label}</p>
        </div>

        {trendStyle && insight.trend && (
          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold',
              trendStyle.classes,
            )}
          >
            <svg viewBox="0 0 24 24" width={12} height={12} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={trendStyle.arrowPath} />
            </svg>
            {insight.trend.changePct !== null
              ? `${insight.trend.changePct > 0 ? '+' : ''}${formatNumber(insight.trend.changePct, 0)}%`
              : trendStyle.label}
          </span>
        )}
      </div>

      {(insight.isTopOfMultiple || insight.trend) && (
        <p className="relative mt-2 text-[11px] text-ink-300">
          {insight.isTopOfMultiple
            ? 'Mayor valor entre los resultados encontrados.'
            : 'Tendencia frente al punto anterior de la serie histórica.'}
        </p>
      )}
    </div>
  )
}
