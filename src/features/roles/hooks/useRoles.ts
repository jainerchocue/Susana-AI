import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from '@/app/store/toastStore'
import { queryKeys } from '@/constants'
import { rolesApi } from '@/services/api'
import type { RoleCreateInput, RoleUpdateInput } from '@/types'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { getDisplayErrorMessage } from '@/utils/errors'

export function useRoles() {
  const [page, setPage] = useState(1)
  const [limit] = useState(10)
  const [search, setSearchState] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const queryClient = useQueryClient()

  const queryParams = { page, limit, search: debouncedSearch === '' ? undefined : debouncedSearch }

  const listQuery = useQuery({
    queryKey: queryKeys.roles.list(queryParams),
    queryFn: () => rolesApi.list(queryParams),
    placeholderData: keepPreviousData,
  })

  const createMutation = useMutation({
    mutationFn: (input: RoleCreateInput) => rolesApi.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
      toast.success('Rol creado')
    },
    onError: (error) => toast.error('No se pudo crear el rol', getDisplayErrorMessage(error)),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: RoleUpdateInput }) => rolesApi.update(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
      toast.success('Rol actualizado')
    },
    onError: (error) => toast.error('No se pudo actualizar el rol', getDisplayErrorMessage(error)),
  })

  const updatePermissionsMutation = useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: string[] }) =>
      rolesApi.updatePermissions(id, permissions),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
      toast.success('Permisos actualizados')
    },
    onError: (error) => toast.error('No se pudieron actualizar los permisos', getDisplayErrorMessage(error)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.roles.all })
      toast.success('Rol eliminado')
    },
    onError: (error) => toast.error('No se pudo eliminar el rol', getDisplayErrorMessage(error)),
  })

  return {
    roles: listQuery.data?.data ?? [],
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
    create: (input: RoleCreateInput) => createMutation.mutateAsync(input),
    isCreating: createMutation.isPending,
    update: (id: string, input: RoleUpdateInput) => updateMutation.mutateAsync({ id, input }),
    isUpdating: updateMutation.isPending,
    updatePermissions: (id: string, permissions: string[]) =>
      updatePermissionsMutation.mutateAsync({ id, permissions }),
    isUpdatingPermissions: updatePermissionsMutation.isPending,
    remove: (id: string) => deleteMutation.mutate(id),
    deletingId: deleteMutation.isPending ? (deleteMutation.variables ?? null) : null,
  }
}

/** Lista compacta de todos los roles, para selectores (p. ej. asignar roles a un usuario). */
export function useAllRoles() {
  const query = useQuery({
    queryKey: queryKeys.roles.list({ limit: 100 }),
    queryFn: () => rolesApi.list({ limit: 100 }),
    staleTime: 60_000,
  })

  return { roles: query.data?.data ?? [], isLoading: query.isLoading }
}

export function usePermissionsCatalog() {
  const query = useQuery({
    queryKey: queryKeys.permissionsCatalog.all,
    queryFn: () => rolesApi.permissionsCatalog(),
    staleTime: Infinity,
  })

  return {
    groups: query.data?.groups ?? [],
    isLoading: query.isLoading,
  }
}
