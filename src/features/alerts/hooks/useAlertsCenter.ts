import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { toast } from '@/app/store/toastStore'
import { PERMISSIONS, queryKeys } from '@/constants'
import { alertsApi } from '@/services/api'
import type { AlertSeverity, AlertStatus } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 10

/**
 * Orquesta el Centro de Alertas: pagina por cursor, filtra por estado/severidad
 * y expone la transición de estado (PATCH /alerts/{id}), respetando el permiso
 * alerts:manage del usuario autenticado.
 */
export function useAlertsCenter() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const [status, setStatus] = useState<AlertStatus | null>(null)
  const [severity, setSeverity] = useState<AlertSeverity | null>(null)

  const queryClient = useQueryClient()
  const hasPermission = useAuthStore((state) => state.hasPermission)

  const cursor = cursorStack[cursorStack.length - 1]
  const queryParams = {
    cursor,
    limit: PAGE_SIZE,
    status: status ?? undefined,
    severity: severity ?? undefined,
  }

  const alertsQuery = useQuery({
    queryKey: queryKeys.alerts.list(queryParams),
    queryFn: () => alertsApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  function resetPagination() {
    setCursorStack([undefined])
  }

  function goNext() {
    const nextCursor = alertsQuery.data?.pagination.nextCursor
    if (alertsQuery.data?.pagination.hasNext && nextCursor) {
      setCursorStack((stack) => [...stack, nextCursor])
    }
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))
  }

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status: next }: { id: string; status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'> }) =>
      alertsApi.updateStatus(id, next),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.alerts.all })
      toast.success(variables.status === 'RESOLVED' ? 'Alerta resuelta' : 'Alerta reconocida')
    },
    onError: (error) => {
      toast.error('No se pudo actualizar la alerta', getDisplayErrorMessage(error))
    },
  })

  return {
    alerts: alertsQuery.data?.data ?? [],
    pagination: alertsQuery.data?.pagination ?? null,
    isLoading: alertsQuery.isLoading,
    isFetching: alertsQuery.isFetching,
    isError: alertsQuery.isError,
    error: alertsQuery.error,
    refetch: alertsQuery.refetch,
    hasPrev: cursorStack.length > 1,
    hasNext: alertsQuery.data?.pagination.hasNext ?? false,
    currentPage: cursorStack.length,
    goNext,
    goPrev,
    status,
    setStatus: (value: AlertStatus | null) => {
      setStatus(value)
      resetPagination()
    },
    severity,
    setSeverity: (value: AlertSeverity | null) => {
      setSeverity(value)
      resetPagination()
    },
    updateStatus: (id: string, status: Extract<AlertStatus, 'ACKNOWLEDGED' | 'RESOLVED'>) =>
      updateStatusMutation.mutate({ id, status }),
    updatingId: updateStatusMutation.isPending ? (updateStatusMutation.variables?.id ?? null) : null,
    canManage: hasPermission(PERMISSIONS.ALERTS_MANAGE),
  }
}
