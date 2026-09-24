import { EmptyState } from './EmptyState'

export function ForbiddenNotice() {
  return (
    <EmptyState
      title="No tiene permisos para ver esta sección"
      description="Si considera que esto es un error, contacte al administrador del sistema."
    />
  )
}
