import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { surgerySchedulesApi } from '@/services/api'
import type { SurgeryExecuted, SurgeryScheduleCreateInput, SurgeryScheduleUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 15

export function useSurgerySchedules() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const [procedureCode, setProcedureCodeState] = useState<string | null>(null)
  const [executed, setExecutedState] = useState<SurgeryExecuted | null>(null)
  const cursor = cursorStack[cursorStack.length - 1]
  const queryClient = useQueryClient()

  const queryParams = {
    cursor,
    limit: PAGE_SIZE,
    procedureCode: procedureCode ?? undefined,
    executed: executed ?? undefined,
  }
  const listQuery = useQuery({
    queryKey: queryKeys.surgerySchedules.list(queryParams),
    queryFn: () => surgerySchedulesApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  function resetPagination() {
    setCursorStack([undefined])
  }

  function goNext() {
    const nextCursor = listQuery.data?.pagination.nextCursor
    if (listQuery.data?.pagination.hasNext && nextCursor) {
      setCursorStack((stack) => [...stack, nextCursor])
    }
  }

  function goPrev() {
    setCursorStack((stack) => (stack.length > 1 ? stack.slice(0, -1) : stack))
  }

  const createMutation = useMutation({
    mutationFn: (input: SurgeryScheduleCreateInput) => surgerySchedulesApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.surgerySchedules.all })
      toast.success('Cirugía programada')
    },
    onError: (error) => toast.error('No se pudo programar la cirugía', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: SurgeryScheduleUpdateInput }) =>
      surgerySchedulesApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.surgerySchedules.all })
      toast.success('Cirugía actualizada')
    },
    onError: (error) => toast.error('No se pudo actualizar la cirugía', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => surgerySchedulesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.surgerySchedules.all })
      toast.success('Cirugía eliminada')
    },
    onError: (error) => toast.error('No se pudo eliminar la cirugía', getDisplayErrorMessage(error)),
  })

  return {
    schedules: listQuery.data?.data ?? [],
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    hasPrev: cursorStack.length > 1,
    hasNext: listQuery.data?.pagination.hasNext ?? false,
    currentPage: cursorStack.length,
    goNext,
    goPrev,
    procedureCode,
    setProcedureCode: (value: string | null) => {
      setProcedureCodeState(value)
      resetPagination()
    },
    executed,
    setExecuted: (value: SurgeryExecuted | null) => {
      setExecutedState(value)
      resetPagination()
    },
    create: (input: SurgeryScheduleCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: number, input: SurgeryScheduleUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    remove: (id: number) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
