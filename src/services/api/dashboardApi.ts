import { requestData } from './apiClient'
import type { DashboardDemand, DashboardOccupancy, DashboardSummary, DashboardWaitTimes, DateRangeParams } from '@/types'

export const dashboardApi = {
  getSummary: (params?: DateRangeParams) =>
    requestData<DashboardSummary>({ method: 'GET', url: '/dashboard/summary', params }),

  getOccupancy: (params?: DateRangeParams) =>
    requestData<DashboardOccupancy>({ method: 'GET', url: '/dashboard/occupancy', params }),

  getWaitTimes: (params?: DateRangeParams) =>
    requestData<DashboardWaitTimes>({ method: 'GET', url: '/dashboard/wait-times', params }),

  getDemand: (params?: DateRangeParams) =>
    requestData<DashboardDemand>({ method: 'GET', url: '/dashboard/demand', params }),
}
