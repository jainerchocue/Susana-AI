import { useQuery } from '@tanstack/react-query'
import { dashboardApi } from '@/services/api'
import { queryKeys } from '@/constants'

export interface ServicesFilters {
  from?: string | null
  to?: string | null
}

/** No existe un endpoint /services propio: la ocupación por unidad vive en /dashboard/occupancy (requiere services:read). */
export function useOccupancyByUnit(filters: ServicesFilters) {
  return useQuery({
    queryKey: queryKeys.dashboard.occupancy(filters),
    queryFn: () => dashboardApi.getOccupancy({ desde: filters.from ?? undefined, hasta: filters.to ?? undefined }),
  })
}
