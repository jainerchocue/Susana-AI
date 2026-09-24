import type { KPI } from '@/types'
import { EmptyState } from '@/components/ui'
import { KPICard } from './KPICard'

export interface KPIGridProps {
  kpis: KPI[]
  isLoading?: boolean
}

const SKELETON_COUNT = 4

/** Grid responsivo de indicadores clave: 1 columna en móvil, 2 en tablet, 4 en escritorio. */
export function KPIGrid({ kpis, isLoading = false }: KPIGridProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <KPICard
            key={`kpi-skeleton-${index}`}
            title=""
            value={0}
            unit=""
            period=""
            status="good"
            isLoading
          />
        ))}
      </div>
    )
  }

  if (kpis.length === 0) {
    return (
      <EmptyState
        title="Sin indicadores disponibles"
        description="No hay indicadores clave para mostrar en este momento."
      />
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.map((kpi) => (
        <KPICard
          key={kpi.id}
          title={kpi.title}
          value={kpi.value}
          unit={kpi.unit}
          trend={kpi.trend}
          trendValue={kpi.trendValue}
          period={kpi.period}
          status={kpi.status}
          description={kpi.description}
        />
      ))}
    </div>
  )
}
