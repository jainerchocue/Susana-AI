import { useState } from 'react'
import { Button, Modal } from '@/components/ui'
import { useAllRoles } from '@/features/roles/hooks/useRoles'
import type { AdminUser } from '@/types'
import { cn } from '@/utils/cn'

interface UserRolesModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: AdminUser | null
  onSave: (id: string, roles: string[]) => Promise<unknown>
  isSaving: boolean
}

/** El padre debe pasar `key={user?.id}` para reiniciar la selección al cambiar de usuario. */
export function UserRolesModal({ open, onOpenChange, user, onSave, isSaving }: UserRolesModalProps) {
  const { roles: availableRoles } = useAllRoles()
  const [selected, setSelected] = useState<string[]>(user?.roles ?? [])

  function toggle(name: string) {
    setSelected((current) => (current.includes(name) ? current.filter((r) => r !== name) : [...current, name]))
  }

  async function handleSave() {
    if (!user) return
    await onSave(user.id, selected)
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Roles del usuario" description={user?.email}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {availableRoles.map((role) => {
            const checked = selected.includes(role.name)
            return (
              <button
                key={role.id}
                type="button"
                onClick={() => toggle(role.name)}
                className={cn(
                  'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  checked ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-surface-100 text-ink-700 hover:border-brand-200',
                )}
              >
                {role.name}
              </button>
            )
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" isLoading={isSaving} onClick={handleSave}>
            Guardar roles
          </Button>
        </div>
      </div>
    </Modal>
  )
}
