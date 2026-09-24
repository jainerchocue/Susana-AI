/** Centralized TanStack Query key factory — keeps cache invalidation consistent. */
export const queryKeys = {
  auth: {
    me: () => ['auth', 'me'] as const,
  },
  dashboard: {
    all: ['dashboard'] as const,
    summary: (filters?: unknown) => ['dashboard', 'summary', filters] as const,
    occupancy: (filters?: unknown) => ['dashboard', 'occupancy', filters] as const,
    waitTimes: (filters?: unknown) => ['dashboard', 'wait-times', filters] as const,
    demand: (filters?: unknown) => ['dashboard', 'demand', filters] as const,
  },
  analytics: {
    all: ['analytics'] as const,
    services: (filters?: unknown) => ['analytics', 'services', filters] as const,
    triage: (filters?: unknown) => ['analytics', 'triage', filters] as const,
    surgeries: () => ['analytics', 'surgeries'] as const,
  },
  medications: {
    all: ['medications'] as const,
    list: (params?: unknown) => ['medications', 'list', params] as const,
    critical: () => ['medications', 'critical'] as const,
    consumption: (params?: unknown) => ['medications', 'consumption', params] as const,
  },
  alerts: {
    all: ['alerts'] as const,
    list: (params?: unknown) => ['alerts', 'list', params] as const,
  },
  assistant: {
    all: ['assistant'] as const,
  },
} as const
