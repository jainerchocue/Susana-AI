import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { importsApi } from '@/services/api'
import type { ImportStatus } from '@/types'

const POLL_INTERVAL_MS = 2000
const ACTIVE_STATUSES: ImportStatus[] = ['PENDING', 'RUNNING']

/**
 * Sigue un trabajo de importación: hace polling cada 2s mientras esté PENDING/RUNNING
 * y se detiene solo al llegar a un estado terminal, avisando con un toast en ese momento.
 */
export function useImportJobDetail(id: string | null) {
  const queryClient = useQueryClient()
  const previousStatusRef = useRef<ImportStatus | null>(null)

  useEffect(() => {
    previousStatusRef.current = null
  }, [id])

  const jobQuery = useQuery({
    queryKey: queryKeys.imports.detail(id ?? ''),
    queryFn: () => importsApi.get(id as string),
    enabled: id !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_STATUSES.includes(status) ? POLL_INTERVAL_MS : false
    },
  })

  useEffect(() => {
    const job = jobQuery.data
    if (!job) return
    const wasActive = previousStatusRef.current !== null && ACTIVE_STATUSES.includes(previousStatusRef.current)

    if (wasActive && job.status === 'COMPLETED') {
      toast.success('Importación completada', `${job.inserted} de ${job.processed} registros insertados.`)
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.all })
    } else if (wasActive && job.status === 'FAILED') {
      toast.error('La importación falló', job.message ?? 'Revise los errores del archivo.')
      queryClient.invalidateQueries({ queryKey: queryKeys.imports.all })
    }

    previousStatusRef.current = job.status
  }, [jobQuery.data, queryClient])

  return {
    job: jobQuery.data ?? null,
    isLoading: jobQuery.isLoading,
    isError: jobQuery.isError,
    error: jobQuery.error,
  }
}
