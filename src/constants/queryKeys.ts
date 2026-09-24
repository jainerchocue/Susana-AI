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
  imports: {
    all: ['imports'] as const,
    list: (params?: unknown) => ['imports', 'list', params] as const,
    detail: (id: string) => ['imports', 'detail', id] as const,
  },
  procedures: {
    all: ['procedures'] as const,
    list: (params?: unknown) => ['procedures', 'list', params] as const,
  },
  patients: {
    all: ['patients'] as const,
    list: (params?: unknown) => ['patients', 'list', params] as const,
  },
  admissions: {
    all: ['admissions'] as const,
    list: (params?: unknown) => ['admissions', 'list', params] as const,
  },
  triages: {
    all: ['triages'] as const,
    list: (params?: unknown) => ['triages', 'list', params] as const,
  },
  serviceRecords: {
    all: ['service-records'] as const,
    list: (params?: unknown) => ['service-records', 'list', params] as const,
  },
  surgerySchedules: {
    all: ['surgery-schedules'] as const,
    list: (params?: unknown) => ['surgery-schedules', 'list', params] as const,
  },
  users: {
    all: ['users'] as const,
    list: (params?: unknown) => ['users', 'list', params] as const,
  },
  roles: {
    all: ['roles'] as const,
    list: (params?: unknown) => ['roles', 'list', params] as const,
  },
  permissionsCatalog: {
    all: ['permissions-catalog'] as const,
  },
  assistant: {
    all: ['assistant'] as const,
  },
} as const
