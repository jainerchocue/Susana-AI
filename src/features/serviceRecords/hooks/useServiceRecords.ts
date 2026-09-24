import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { serviceRecordsApi } from '@/services/api'
import type { ServiceRecordCreateInput, ServiceRecordUpdateInput } from '@/types'
import { getDisplayErrorMessage } from '@/utils/errors'

const PAGE_SIZE = 15

export function useServiceRecords() {
  const [cursorStack, setCursorStack] = useState<Array<string | undefined>>([undefined])
  const [admissionId, setAdmissionIdState] = useState<number | null>(null)
  const [area, setAreaState] = useState<string | null>(null)
  const [specialty, setSpecialtyState] = useState<string | null>(null)
  const cursor = cursorStack[cursorStack.length - 1]
  const queryClient = useQueryClient()

  const queryParams = {
    cursor,
    limit: PAGE_SIZE,
    admissionId: admissionId ?? undefined,
    area: area ?? undefined,
    specialty: specialty ?? undefined,
  }
  const listQuery = useQuery({
    queryKey: queryKeys.serviceRecords.list(queryParams),
    queryFn: () => serviceRecordsApi.list(queryParams),
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
    mutationFn: (input: ServiceRecordCreateInput) => serviceRecordsApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.serviceRecords.all })
      toast.success('Servicio registrado')
    },
    onError: (error) => toast.error('No se pudo registrar el servicio', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: number; input: ServiceRecordUpdateInput }) =>
      serviceRecordsApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.serviceRecords.all })
      toast.success('Servicio actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el servicio', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => serviceRecordsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.serviceRecords.all })
      toast.success('Registro de servicio eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el registro', getDisplayErrorMessage(error)),
  })

  return {
    records: listQuery.data?.data ?? [],
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
    admissionId,
    setAdmissionId: (value: number | null) => {
      setAdmissionIdState(value)
      resetPagination()
    },
    area,
    setArea: (value: string | null) => {
      setAreaState(value)
      resetPagination()
    },
    specialty,
    setSpecialty: (value: string | null) => {
      setSpecialtyState(value)
      resetPagination()
    },
    create: (input: ServiceRecordCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: number, input: ServiceRecordUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    remove: (id: number) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
