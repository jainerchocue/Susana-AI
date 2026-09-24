import { useState } from 'react'
import { Button, Modal, Spinner } from '@/components/ui'
import { usePermissionsCatalog } from '@/features/roles/hooks/useRoles'
import type { Role } from '@/types'
import { cn } from '@/utils/cn'

interface RolePermissionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  role: Role | null
  onSave: (id: string, permissions: string[]) => Promise<unknown>
  isSaving: boolean
}

/** El padre debe pasar `key={role?.id}` para reiniciar la selección al cambiar de rol. */
export function RolePermissionsModal({ open, onOpenChange, role, onSave, isSaving }: RolePermissionsModalProps) {
  const { groups, isLoading } = usePermissionsCatalog()
  const [selected, setSelected] = useState<string[]>(role?.permissions.filter((permission) => permission !== '*') ?? [])

  function toggle(permission: string) {
    setSelected((current) =>
      current.includes(permission) ? current.filter((p) => p !== permission) : [...current, permission],
    )
  }

  async function handleSave() {
    if (!role) return
    await onSave(role.id, selected)
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Permisos del rol" description={role?.name} size="lg">
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner label="Cargando catálogo de permisos" />
        </div>
      ) : (
        <div className="flex max-h-96 flex-col gap-4 overflow-y-auto">
          {groups.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">{group.group}</p>
              <div className="flex flex-wrap gap-2">
                {group.permissions.map((permission) => {
                  const key = `${permission.group}:${permission.action}`
                  const checked = selected.includes(key)
                  return (
                    <button
                      key={permission.id}
                      type="button"
                      title={permission.description ?? undefined}
                      onClick={() => toggle(key)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        checked
                          ? 'border-brand-600 bg-brand-50 text-brand-700'
                          : 'border-surface-100 text-ink-700 hover:border-brand-200',
                      )}
                    >
                      {permission.action}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button type="button" isLoading={isSaving} onClick={handleSave}>
          Guardar permisos
        </Button>
      </div>
    </Modal>
  )
}
