import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { ActiveFilterChips } from '@/components/filters/ActiveFilterChips'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, PageHeader, Select, Tooltip, type SelectOption } from '@/components/ui'
import { IconEdit, IconTrash, IconUsers } from '@/components/ui/icons'
import { PERMISSIONS, roleLabel } from '@/constants'
import { useUsers } from '@/features/users/hooks/useUsers'
import { UserFormModal } from '@/features/users/components/UserFormModal'
import { UserRolesModal } from '@/features/users/components/UserRolesModal'
import type { AdminUser, UserStatus } from '@/types'
import { formatDate } from '@/utils/format'

const STATUS_LABELS: Record<UserStatus, string> = { ACTIVE: 'Activo', SUSPENDED: 'Suspendido', DELETED: 'Eliminado' }
const STATUS_TONE: Record<UserStatus, 'good' | 'medium' | 'critical'> = { ACTIVE: 'good', SUSPENDED: 'medium', DELETED: 'critical' }
const STATUS_OPTIONS: SelectOption[] = (Object.keys(STATUS_LABELS) as UserStatus[]).map((key) => ({
  label: STATUS_LABELS[key],
  value: key,
}))

export default function UsersPage() {
  const canCreate = useAuthStore((state) => state.hasPermission(PERMISSIONS.USERS_CREATE))
  const canUpdate = useAuthStore((state) => state.hasPermission(PERMISSIONS.USERS_UPDATE))
  const canDelete = useAuthStore((state) => state.hasPermission(PERMISSIONS.USERS_DELETE))
  const canAssignRoles = useAuthStore((state) => state.hasPermission(PERMISSIONS.USERS_ASSIGN_ROLES))

  const {
    users,
    pagination,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
    page,
    limit,
    search,
    setSearch,
    status,
    setStatus,
    setPage,
    create,
    isCreating,
    update,
    isUpdating,
    updateRoles,
    isUpdatingRoles,
    remove,
    deletingId,
  } = useUsers()

  const [editing, setEditing] = useState<AdminUser | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [rolesEditing, setRolesEditing] = useState<AdminUser | null>(null)
  const [isRolesModalOpen, setIsRolesModalOpen] = useState(false)

  const activeFilters = [
    status && { key: 'status', label: `Estado: ${STATUS_LABELS[status]}`, onClear: () => setStatus(null) },
  ].filter((chip): chip is { key: string; label: string; onClear: () => void } => Boolean(chip))

  const columns: DataTableColumn<AdminUser>[] = [
    {
      id: 'name',
      header: 'Usuario',
      cell: (row) => (
        <div>
          <p className="font-medium text-ink-950">{row.name}</p>
          <p className="text-xs text-ink-500">{row.email}</p>
        </div>
      ),
    },
    { id: 'status', header: 'Estado', cell: (row) => <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</Badge> },
    {
      id: 'roles',
      header: 'Roles',
      cell: (row) => (row.roles.length > 0 ? row.roles.map(roleLabel).join(', ') : 'Sin rol'),
    },
    { id: 'createdAt', header: 'Creado', cell: (row) => formatDate(row.createdAt) },
    {
      id: 'actions',
      header: 'Acciones',
      cell: (row: AdminUser) => (
        <div className="flex items-center gap-1">
          {canAssignRoles && (
            <Tooltip label="Editar roles">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Editar roles de ${row.name}`}
                onClick={() => {
                  setRolesEditing(row)
                  setIsRolesModalOpen(true)
                }}
              >
                <IconUsers className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
          {canUpdate && (
            <Tooltip label="Editar">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Editar ${row.name}`}
                onClick={() => {
                  setEditing(row)
                  setIsModalOpen(true)
                }}
              >
                <IconEdit className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
          {canDelete && (
            <Tooltip label="Eliminar">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Eliminar ${row.name}`}
                isLoading={deletingId === row.id}
                onClick={() => remove(row.id)}
              >
                <IconTrash className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios"
        description="Cuentas de acceso al sistema."
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo usuario
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3">
        <Select
          label="Estado"
          options={STATUS_OPTIONS}
          placeholder="Todos los estados"
          value={status ?? ''}
          onChange={(event) => setStatus(event.target.value === '' ? null : (event.target.value as UserStatus))}
          className="w-48"
        />
        <ActiveFilterChips filters={activeFilters} isFetching={isFetching && !isLoading} />
      </div>

      <DataTable
        columns={columns}
        data={users}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isFetching={isFetching}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay usuarios que coincidan con la búsqueda."
        page={page}
        pageSize={limit}
        total={pagination?.total ?? 0}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar usuario..."
      />

      <UserFormModal open={isModalOpen} onOpenChange={setIsModalOpen} user={editing} onCreate={create} onUpdate={update} isSaving={isCreating || isUpdating} />
      <UserRolesModal
        key={rolesEditing?.id ?? 'none'}
        open={isRolesModalOpen}
        onOpenChange={setIsRolesModalOpen}
        user={rolesEditing}
        onSave={updateRoles}
        isSaving={isUpdatingRoles}
      />
    </div>
  )
}
