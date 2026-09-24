import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/constants'
import { analyticsApi } from '@/services/api'

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
