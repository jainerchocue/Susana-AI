import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { admissionsApi } from '@/services/api'
import type { AdmissionCreateInput, AdmissionUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 15

export function useAdmissions() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const cursor = cursorStack[cursorStack.length - 1]
  const queryClient = useQueryClient()

  const queryParams = { cursor, limit: PAGE_SIZE }
  const listQuery = useQuery({
    queryKey: queryKeys.admissions.list(queryParams),
    queryFn: () => admissionsApi.list(queryParams),
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
    mutationFn: (input: AdmissionCreateInput) => admissionsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all })
      toast.success('Ingreso registrado')
    },
    onError: (error) => toast.error('No se pudo registrar el ingreso', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: AdmissionUpdateInput }) => admissionsApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all })
      toast.success('Ingreso actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el ingreso', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => admissionsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.admissions.all })
      toast.success('Ingreso eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el ingreso', getDisplayErrorMessage(error)),
  })

  return {
    admissions: listQuery.data?.data ?? [],
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
    create: (input: AdmissionCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: number, input: AdmissionUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    remove: (id: number) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
