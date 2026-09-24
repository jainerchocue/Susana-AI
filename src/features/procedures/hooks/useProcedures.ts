import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { proceduresApi } from '@/services/api'
import type { ProcedureCreateInput, ProcedureUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 15

export function useProcedures() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const cursor = cursorStack[cursorStack.length - 1]
  const queryClient = useQueryClient()

  const queryParams = { cursor, limit: PAGE_SIZE }
  const listQuery = useQuery({
    queryKey: queryKeys.procedures.list(queryParams),
    queryFn: () => proceduresApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

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
    mutationFn: (input: ProcedureCreateInput) => proceduresApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      toast.success('Procedimiento creado')
    },
    onError: (error) => toast.error('No se pudo crear el procedimiento', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ code, input }: { code: string; input: ProcedureUpdateInput }) => proceduresApi.update(code, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      toast.success('Procedimiento actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el procedimiento', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (code: string) => proceduresApi.remove(code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.procedures.all })
      toast.success('Procedimiento eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el procedimiento', getDisplayErrorMessage(error)),
  })

  return {
    procedures: listQuery.data?.data ?? [],
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
    create: (input: ProcedureCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (code: string, input: ProcedureUpdateInput) => updateMutation.mutateAsync({ code, input }),
    isUpdating: updateMutation.isPending,
    remove: (code: string) => deleteMutation.mutate(code),
    deletingCode: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
