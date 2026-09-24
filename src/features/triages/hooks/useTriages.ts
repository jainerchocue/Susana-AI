import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { triagesApi } from '@/services/api'
import type { TriageCreateInput, TriageUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 15

export function useTriages() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const cursor = cursorStack[cursorStack.length - 1]
  const queryClient = useQueryClient()

  const queryParams = { cursor, limit: PAGE_SIZE }
  const listQuery = useQuery({
    queryKey: queryKeys.triages.list(queryParams),
    queryFn: () => triagesApi.list(queryParams),
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
    mutationFn: (input: TriageCreateInput) => triagesApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triages.all })
      toast.success('Triage registrado')
    },
    onError: (error) => toast.error('No se pudo registrar el triage', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: TriageUpdateInput }) => triagesApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triages.all })
      toast.success('Triage actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el triage', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => triagesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.triages.all })
      toast.success('Triage eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el triage', getDisplayErrorMessage(error)),
  })

  return {
    triages: listQuery.data?.data ?? [],
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    hasPrev: cursorStack.length > 1,
    hasNext: listQuery.data?.pagination.hasNext ?? false,
    goNext,
    goPrev,
    create: (input: TriageCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: number, input: TriageUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    remove: (id: number) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
