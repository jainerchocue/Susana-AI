import { useAuth } from '@/features/auth/hooks/useAuth'
import { roleLabel } from '@/constants'
import { Button, Tooltip } from '@/components/ui'
import { IconCalendar, IconLogout, IconMenu } from '@/components/ui/icons'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

export function Topbar({ title, onMenuClick }: { title: string; onMenuClick?: () => void }) {
  const { user, logout, isLoggingOut } = useAuth()

  return (
    <header className="flex h-16 items-center justify-between border-b border-surface-100 bg-white px-4 sm:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-lg p-2 text-ink-700 hover:bg-surface-50 lg:hidden"
          aria-label="Abrir menú de navegación"
        >
          <IconMenu />
        </button>
        <h1 className="text-base font-semibold text-ink-950 sm:text-lg">{title}</h1>
      </div>

      <div className="flex items-center gap-3">
        <span
          className="hidden items-center gap-1.5 rounded-full border border-surface-100 px-3 py-1 text-xs font-medium capitalize text-ink-500 md:inline-flex"
          aria-hidden="true"
        >
          <IconCalendar className="h-3.5 w-3.5 text-brand-600" />
          {format(new Date(), "EEEE, d 'de' MMM", { locale: es })}
        </span>
        {user && (
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white">
              {initials(user.name)}
            </span>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium text-ink-950">{user.name}</p>
              <p className="text-xs text-ink-500">{user.roles.map(roleLabel).join(', ') || 'Sin rol asignado'}</p>
            </div>
          </div>
        )}
        <Tooltip label="Cerrar sesión">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => logout()}
            isLoading={isLoggingOut}
            aria-label="Cerrar sesión"
          >
            <IconLogout />
            <span className="hidden sm:inline">Salir</span>
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
