import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { usersApi } from '@/services/api'
import type { UserCreateInput, UserStatus, UserUpdateInput } from '@/types'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getDisplayErrorMessage } from '@/utils/errors'

export function useUsers() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [search, setSearchState] = useState('')
  const [status, setStatusState] = useState<UserStatus | null>(null)
  const debouncedSearch = useDebouncedValue(search)
  const queryClient = useQueryClient()

  const queryParams = {
    page,
    limit,
    search: debouncedSearch === '' ? undefined : debouncedSearch,
    status: status ?? undefined,
  }

  const listQuery = useQuery({
    queryKey: queryKeys.users.list(queryParams),
    queryFn: () => usersApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  const createMutation = useMutation({
    mutationFn: (input: UserCreateInput) => usersApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('Usuario creado')
    },
    onError: (error) => toast.error('No se pudo crear el usuario', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UserUpdateInput }) => usersApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('Usuario actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el usuario', getDisplayErrorMessage(error)),
  })

  const updateRolesMutation = useMutation({
    mutationFn: ({ id, roles }: { id: string; roles: string[] }) => usersApi.updateRoles(id, roles),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('Roles actualizados')
    },
    onError: (error) => toast.error('No se pudieron actualizar los roles', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.users.all })
      toast.success('Usuario eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el usuario', getDisplayErrorMessage(error)),
  })

  return {
    users: listQuery.data?.data ?? [],
    pagination: listQuery.data?.pagination ?? null,
    isLoading: listQuery.isLoading,
    isFetching: listQuery.isFetching,
    isError: listQuery.isError,
    error: listQuery.error,
    refetch: listQuery.refetch,
    page,
    limit,
    setPage,
    search,
    setSearch: (value: string) => {
      setSearchState(value)
      setPage(1)
    },
    status,
    setStatus: (value: UserStatus | null) => {
      setStatusState(value)
      setPage(1)
    },
    create: (input: UserCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: string, input: UserUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    updateRoles: (id: string, roles: string[]) => updateRolesMutation.mutateAsync({ id, roles }),
    isUpdatingRoles: updateRolesMutation.isPending,
    remove: (id: string) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}
