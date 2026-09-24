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

/** Traducción de los grupos del catálogo (llaves crudas del backend, ej. "alerts"). */
const GROUP_LABELS: Record<string, string> = {
  alerts: 'Alertas',
  analytics: 'Analítica',
  assistant: 'Asistente IA',
  audit: 'Auditoría',
  dashboard: 'Panel general',
  data: 'Datos clínicos (HIS)',
  medications: 'Medicamentos',
  patients: 'Pacientes',
  permissions: 'Permisos',
  roles: 'Roles',
  services: 'Servicios',
  surgeries: 'Cirugías',
  system: 'Sistema',
  users: 'Usuarios',
}

/** Traducción de la acción (parte tras los ":" de ej. "alerts:manage") a una etiqueta corta. */
const ACTION_LABELS: Record<string, string> = {
  read: 'Ver',
  manage: 'Gestionar',
  create: 'Crear',
  update: 'Editar',
  delete: 'Eliminar',
  export: 'Exportar',
  import: 'Importar',
  use: 'Usar',
  advanced: 'Uso avanzado',
  'assign-roles': 'Asignar roles',
  'assign-permissions': 'Asignar permisos',
}

function actionLabel(action: string): string {
  const suffix = action.split(':')[1] ?? action
  return ACTION_LABELS[suffix] ?? suffix.replace(/-/g, ' ')
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
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-500">
                {GROUP_LABELS[group.group] ?? group.group}
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.permissions.map((permission) => {
                  const checked = selected.includes(permission.action)
                  return (
                    <label
                      key={permission.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                        checked ? 'border-brand-600 bg-brand-50' : 'border-surface-100 hover:border-brand-200',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                        checked={checked}
                        onChange={() => toggle(permission.action)}
                      />
                      <span className="flex flex-col">
                        <span className={cn('text-sm font-medium', checked ? 'text-brand-700' : 'text-ink-900')}>
                          {actionLabel(permission.action)}
                        </span>
                        <span className="text-xs text-ink-500">{permission.description ?? permission.action}</span>
                      </span>
                    </label>
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
