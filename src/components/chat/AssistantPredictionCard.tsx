import type { AssistantPrediction } from '@/features/assistant/insights'
import { Badge } from '@/components/ui'
import { IconChartLine } from '@/components/ui/icons'
import { cn } from '@/utils/cn'
import { formatNumber } from '@/utils/format'

const TREND_TONE: Record<'alza' | 'baja', { classes: string; symbol: string }> = {
  alza: { classes: 'bg-status-good-bg text-status-good', symbol: '▲' },
  baja: { classes: 'bg-status-critical-bg text-status-critical', symbol: '▼' },
}

/** Serie mínima (último valor observado + pronóstico) como barras — sin librería de gráficos, son 4 puntos. */
function ForecastBars({ lastObserved, forecast }: { lastObserved: number | null; forecast: number[] }) {
  const points = [
    ...(lastObserved !== null ? [{ value: lastObserved, isForecast: false }] : []),
    ...forecast.map((value) => ({ value, isForecast: true })),
  ]
  if (points.length === 0) return null
  const max = Math.max(...points.map((p) => p.value), 1)

  return (
    <div className="mt-3 flex items-end gap-1.5">
      {points.map((point, index) => (
        <div key={index} className="flex flex-1 flex-col items-center gap-1">
          <div className="flex h-16 w-full items-end">
            <div
              className={cn('w-full rounded-t', point.isForecast ? 'bg-accent-400/60' : 'bg-brand-600')}
              style={{ height: `${Math.max((point.value / max) * 100, 6)}%` }}
            />
          </div>
          <span className="text-[10px] tabular-nums text-ink-500">{formatNumber(point.value, 0)}</span>
        </div>
      ))}
    </div>
  )
}

export function AssistantPredictionCard({ prediction }: { prediction: AssistantPrediction }) {
  const trend = prediction.trendDirection ? TREND_TONE[prediction.trendDirection] : null

  return (
    <div className="animate-scale-in relative overflow-hidden rounded-2xl border border-accent-200 bg-white p-4 shadow-glow-accent">
      <div className="flex items-start justify-between gap-3">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-accent-700">
          <IconChartLine className="h-3 w-3" aria-hidden="true" />
          Predicción · {prediction.label}
        </span>
        {trend && prediction.trendPct !== null && (
          <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold', trend.classes)}>
            {trend.symbol} {prediction.trendPct > 0 ? '+' : ''}
            {formatNumber(prediction.trendPct, 0)}%
          </span>
        )}
      </div>

      <ForecastBars lastObserved={prediction.lastObserved} forecast={prediction.forecast} />

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
        {prediction.lastObserved !== null && (
          <span>
            Último observado: <span className="font-medium text-ink-700">{formatNumber(prediction.lastObserved, 0)}</span>
          </span>
        )}
        {prediction.forecast.length > 0 && (
          <span>
            Pronóstico: <span className="font-medium text-ink-700">{prediction.forecast.map((v) => formatNumber(v, 0)).join(' → ')}</span>
          </span>
        )}
        {prediction.backgroundTrend && <span>Tendencia de fondo: {prediction.backgroundTrend}</span>}
      </div>

      {prediction.topFeatures.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {prediction.topFeatures.map((feature) => (
            <Badge key={feature} tone="neutral" className="normal-case">
              {feature}
            </Badge>
          ))}
        </div>
      )}

      {prediction.mae !== null && (
        <p className="mt-2 text-[11px] text-ink-300">
          Margen de error estimado (MAE) ~{formatNumber(prediction.mae, 0)} — orientativo, no sustituye el criterio clínico.
        </p>
      )}
    </div>
  )
}
