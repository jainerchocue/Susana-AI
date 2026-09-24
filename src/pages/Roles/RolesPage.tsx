import { useState } from 'react'
import { useAuthStore } from '@/app/store/authStore'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, PageHeader, Tooltip } from '@/components/ui'
import { IconEdit, IconKey, IconTrash } from '@/components/ui/icons'
import { PERMISSIONS } from '@/constants'
import { useRoles } from '@/features/roles/hooks/useRoles'
import { RoleFormModal } from '@/features/roles/components/RoleFormModal'
import { RolePermissionsModal } from '@/features/roles/components/RolePermissionsModal'
import type { Role } from '@/types'

export default function RolesPage() {
  const canCreate = useAuthStore((state) => state.hasPermission(PERMISSIONS.ROLES_CREATE))
  const canAssignPermissions = useAuthStore((state) => state.hasPermission(PERMISSIONS.ROLES_ASSIGN_PERMISSIONS))

  const {
    roles,
    pagination,
    isLoading,
    isError,
    error,
    refetch,
    page,
    limit,
    search,
    setSearch,
    setPage,
    create,
    isCreating,
    update,
    isUpdating,
    updatePermissions,
    isUpdatingPermissions,
    remove,
    deletingId,
  } = useRoles()

  const [editing, setEditing] = useState<Role | null>(null)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [permissionsEditing, setPermissionsEditing] = useState<Role | null>(null)
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false)

  const columns: DataTableColumn<Role>[] = [
    {
      id: 'name',
      header: 'Rol',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink-950">{row.name}</span>
          {row.isSystem && <Badge tone="neutral">Sistema</Badge>}
        </div>
      ),
    },
    { id: 'description', header: 'Descripción', cell: (row) => row.description ?? '—' },
    {
      id: 'permissions',
      header: 'Permisos',
      cell: (row) => (row.permissions.includes('*') ? <Badge tone="info">Todos</Badge> : String(row.permissions.length)),
    },
    { id: 'usersCount', header: 'Usuarios', cell: (row) => row.usersCount },
    {
      id: 'actions',
      header: 'Acciones',
      cell: (row: Role) => (
        <div className="flex items-center gap-1">
          {canAssignPermissions && !row.isSystem && (
            <Tooltip label="Editar permisos">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Editar permisos de ${row.name}`}
                onClick={() => {
                  setPermissionsEditing(row)
                  setIsPermissionsModalOpen(true)
                }}
              >
                <IconKey className="h-4 w-4" />
              </Button>
            </Tooltip>
          )}
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
          {!row.isSystem && (
            <Tooltip label={row.usersCount > 0 ? 'No se puede eliminar: tiene usuarios asignados' : 'Eliminar'}>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={`Eliminar ${row.name}`}
                disabled={row.usersCount > 0}
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
        title="Roles"
        description="Roles del sistema y sus permisos asociados."
        actions={
          canCreate ? (
            <Button
              type="button"
              onClick={() => {
                setEditing(null)
                setIsModalOpen(true)
              }}
            >
              Nuevo rol
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={roles}
        getRowId={(row) => row.id}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay roles que coincidan con la búsqueda."
        page={page}
        pageSize={limit}
        total={pagination?.total ?? 0}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar rol..."
      />

      <RoleFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        role={editing}
        onCreate={create}
        onUpdate={update}
        isSaving={isCreating || isUpdating}
      />
      <RolePermissionsModal
        key={permissionsEditing?.id ?? 'none'}
        open={isPermissionsModalOpen}
        onOpenChange={setIsPermissionsModalOpen}
        role={permissionsEditing}
        onSave={updatePermissions}
        isSaving={isUpdatingPermissions}
      />
    </div>
  )
}
