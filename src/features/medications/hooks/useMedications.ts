import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { medicationApi } from '@/services/api'
import { getDisplayErrorMessage } from '@/utils/errors'

/** Orquesta el listado de medicamentos: pagina (page/limit) y busca por nombre/código. */
export function useMedications() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [search, setSearch] = useState('')

  const queryClient = useQueryClient()

  const queryParams = {
    page,
    limit,
    search: search === '' ? undefined : search,
  }

  const medicationsQuery = useQuery({
    queryKey: queryKeys.medications.list(queryParams),
    queryFn: () => medicationApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  const updateStockMutation = useMutation({
    mutationFn: ({ code, quantity }: { code: string; quantity: number }) => medicationApi.updateStock(code, quantity),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.medications.all })
      toast.success('Stock actualizado')
    },
    onError: (error) => {
      toast.error('No se pudo actualizar el stock', getDisplayErrorMessage(error))
    },
  })

  return {
    medications: medicationsQuery.data?.data ?? [],
    pagination: medicationsQuery.data?.pagination ?? null,
    isLoading: medicationsQuery.isLoading,
    isError: medicationsQuery.isError,
    error: medicationsQuery.error,
    refetch: medicationsQuery.refetch,
    page,
    limit,
    search,
    setSearch,
    setPage,
    updateStock: (code: string, quantity: number) => updateStockMutation.mutate({ code, quantity }),
    updatingCode: updateStockMutation.isPending ? (updateStockMutation.variables?.code ?? null) : null,
  }
}

/** GET /medications/critical — puede venir sin datos suficientes si no hay stock registrado para nada. */
export function useCriticalMedications() {
  const criticalQuery = useQuery({
    queryKey: queryKeys.medications.critical(),
    queryFn: medicationApi.critical,
  })

  return {
    count: criticalQuery.data?.items.length ?? 0,
    hasInsufficientData: criticalQuery.data?.status === 'insufficient_data',
    isLoading: criticalQuery.isLoading,
  }
}
