import { useQuery } from '@tanstack/react-query'
import { analyticsApi } from '@/services/api'
import { queryKeys } from '@/constants'

/** Único endpoint real de cirugías: agregados de /analytics/surgeries (sin período — el HIS no trae fecha). */
export function useSurgeriesAnalytics() {
  return useQuery({
    queryKey: queryKeys.analytics.surgeries(),
    queryFn: () => analyticsApi.getSurgeries(),
  })
}
