import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/constants'
import { dashboardApi } from '@/services/api'
import type { DashboardSummary, KPI, KPIStatus } from '@/types'
import { buildPeriodLabel } from '@/utils/date'

export interface DashboardFilters {
  from?: string | null
  to?: string | null
}

function toParams(filters: DashboardFilters) {
  return { desde: filters.from ?? undefined, hasta: filters.to ?? undefined }
}

/**
 * `keepPreviousData` en las cuatro consultas: sin esto, cada cambio de filtro
 * pasaba por un estado de carga en blanco (sin período, sin números) mientras
 * el backend respondía — con el backend real tardando varios segundos, esa
 * pantalla en blanco rompía la sensación de "el filtro sí hizo algo". Ahora
 * los datos anteriores se quedan visibles (con su período) hasta que llegan
 * los nuevos, y `isFetching` queda disponible para mostrar que se está actualizando.
 */
export function useDashboardSummary(filters: DashboardFilters) {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(filters),
    queryFn: () => dashboardApi.getSummary(toParams(filters)),
    placeholderData: keepPreviousData,
  })
}

export function useDashboardOccupancy(filters: DashboardFilters) {
  return useQuery({
    queryKey: queryKeys.dashboard.occupancy(filters),
    queryFn: () => dashboardApi.getOccupancy(toParams(filters)),
    placeholderData: keepPreviousData,
  })
}

export function useDashboardWaitTimes(filters: DashboardFilters) {
  return useQuery({
    queryKey: queryKeys.dashboard.waitTimes(filters),
    queryFn: () => dashboardApi.getWaitTimes(toParams(filters)),
    placeholderData: keepPreviousData,
  })
}

export function useDashboardDemand(filters: DashboardFilters) {
  return useQuery({
    queryKey: queryKeys.dashboard.demand(filters),
    queryFn: () => dashboardApi.getDemand(toParams(filters)),
    placeholderData: keepPreviousData,
  })
}

function occupancyStatus(pct: number): KPIStatus {
  if (pct >= 95) return 'critical'
  if (pct >= 85) return 'high'
  if (pct >= 70) return 'medium'
  return 'good'
}

function waitTimeStatus(minutes: number): KPIStatus {
  if (minutes >= 90) return 'critical'
  if (minutes >= 60) return 'high'
  if (minutes >= 30) return 'medium'
  return 'good'
}

/**
 * El backend no manda KPIs pre-armados: los derivamos localmente de los números reales
 * de /dashboard/summary. "Ocupación" y "Tiempo de espera" sí siguen el filtro de fecha
 * global — su período se toma de `summary.periodo`, que es lo que el backend realmente
 * usó (no lo que el filtro pedía), para que la tarjeta muestre el rango real aplicado.
 * "Ingresos (24h)" y "Alertas activas" son ventanas fijas por diseño del backend — se
 * marcan `live: true` para que la tarjeta lo deje claro en vez de parecer un filtro roto.
 */
export function buildDashboardKpis(summary: DashboardSummary): KPI[] {
  const periodLabel = buildPeriodLabel(summary.periodo.desde, summary.periodo.hasta)

  const kpis: KPI[] = [
    {
      id: 'occupancy',
      title: 'Ocupación general',
      value: summary.occupancy.occupancyPct,
      unit: '%',
      period: periodLabel,
      status: occupancyStatus(summary.occupancy.occupancyPct),
      description: `${summary.occupancy.census} de ${summary.occupancy.physicalBeds} camas físicas`,
    },
    {
      id: 'admissions24h',
      title: 'Ingresos (24h)',
      value: summary.admissions.last24h,
      unit: 'count',
      period: 'Últimas 24 horas',
      status: 'good',
      description: `${summary.admissions.last7d} en los últimos 7 días`,
      live: true,
    },
    {
      id: 'waitTime',
      title: 'Tiempo de espera (p50)',
      value: summary.waitTimeP50Minutes,
      unit: 'min',
      period: periodLabel,
      status: waitTimeStatus(summary.waitTimeP50Minutes),
    },
  ]

  if (summary.alerts) {
    const total = summary.alerts.CRITICAL + summary.alerts.WARNING
    kpis.push({
      id: 'alerts',
      title: 'Alertas activas',
      value: total,
      unit: 'count',
      period: 'En este momento',
      status: summary.alerts.CRITICAL > 0 ? 'critical' : summary.alerts.WARNING > 0 ? 'medium' : 'good',
      description: `${summary.alerts.CRITICAL} críticas · ${summary.alerts.WARNING} de advertencia`,
      live: true,
    })
  }

  return kpis
}
