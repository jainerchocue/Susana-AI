import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '@/constants'
import { importsApi } from '@/services/api'
import type { ImportStatus, ImportTable } from '@/types'

const PAGE_SIZE = 10

/** Historial de trabajos de importación: pagina por cursor, filtra por estado/tabla de forma independiente. */
export function useImportJobs() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const [status, setStatusState] = useState<ImportStatus | null>(null)
  const [table, setTableState] = useState<ImportTable | null>(null)

  const cursor = cursorStack[cursorStack.length - 1]
  const queryParams = {
    cursor,
    limit: PAGE_SIZE,
    status: status ?? undefined,
    table: table ?? undefined,
  }

  const jobsQuery = useQuery({
    queryKey: queryKeys.imports.list(queryParams),
    queryFn: () => importsApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  function resetPagination() {
    setCursorStack([undefined])
  }

  function goNext() {
    const nextCursor = jobsQuery.data?.pagination.nextCursor
    if (jobsQuery.data?.pagination.hasNext && nextCursor) {
      setCursorStack((stack) => [...stack, nextCursor])
    }
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))
  }

  return {
    jobs: jobsQuery.data?.data ?? [],
    pagination: jobsQuery.data?.pagination ?? null,
    isLoading: jobsQuery.isLoading,
    isFetching: jobsQuery.isFetching,
    isError: jobsQuery.isError,
    error: jobsQuery.error,
    refetch: jobsQuery.refetch,
    hasPrev: cursorStack.length > 1,
    goNext,
    goPrev,
    status,
    setStatus: (value: ImportStatus | null) => {
      setStatusState(value)
      resetPagination()
    },
    table,
    setTable: (value: ImportTable | null) => {
      setTableState(value)
      resetPagination()
    },
  }
}
