import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/constants'
import { analyticsApi, medicationApi } from '@/services/api'

export interface AnalyticsFilters {
  from?: string | null
  to?: string | null
}

function toParams(filters: AnalyticsFilters) {
  return { desde: filters.from ?? undefined, hasta: filters.to ?? undefined }
}

export function useAnalytics(filters: AnalyticsFilters) {
  const servicesQuery = useQuery({
    queryKey: queryKeys.analytics.services(filters),
    queryFn: () => analyticsApi.getServices(toParams(filters)),
  })

  const triageQuery = useQuery({
    queryKey: queryKeys.analytics.triage(filters),
    queryFn: () => analyticsApi.getTriage(toParams(filters)),
  })

  const surgeriesQuery = useQuery({
    queryKey: queryKeys.analytics.surgeries(),
    queryFn: () => analyticsApi.getSurgeries(),
  })

  return { servicesQuery, triageQuery, surgeriesQuery }
}

/** Consumo de medicamentos: serie temporal, top consumidos y desglose por área — con filtro opcional por medicamento. */
export function useMedicationConsumption(filters: AnalyticsFilters, code: string | null) {
  const params = { ...toParams(filters), code: code ?? undefined }

  return useQuery({
    queryKey: queryKeys.medications.consumption(params),
    queryFn: () => medicationApi.consumption(params),
  })
}

/** Catálogo compacto de medicamentos (código + nombre) para poblar el selector de filtro. */
export function useMedicationCatalog() {
  const query = useQuery({
    queryKey: queryKeys.medications.list({ limit: 100 }),
    queryFn: () => medicationApi.list({ limit: 100 }),
    staleTime: 60_000,
  })

  return { medications: query.data?.data ?? [], isLoading: query.isLoading }
}
