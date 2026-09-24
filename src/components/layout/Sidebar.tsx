import { NavLink } from 'react-router-dom'
import { useAuthStore } from '@/app/store/authStore'
import { NAV_ITEMS } from '@/app/router/navConfig'
import { cn } from '@/utils/cn'
import { hasPermission } from '@/utils/permissions'
import { IconSparkles } from '@/components/ui/icons'

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const permissions = useAuthStore((state) => state.permissions)
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(permissions, item.permission))

  return (
    <nav aria-label="Navegación principal" className="flex h-full w-64 flex-col bg-brand-950 text-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-brand-500 to-accent-500 shadow-glow-brand">
          <IconSparkles className="h-4 w-4 text-white" />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight">Hospital Intelligence</p>
          <p className="text-[11px] text-ink-300">Centro de Inteligencia Operativa</p>
        </div>
      </div>

      <ul className="flex flex-1 flex-col gap-1 px-3 py-2">
        {visibleItems.map((item) => (
          <li key={item.path}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'group relative flex items-center gap-3 overflow-hidden rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300',
                  'transition-colors duration-(--duration-fast) ease-snappy',
                  'hover:bg-white/5 hover:text-white',
                  isActive && 'bg-accent-400/10 text-white',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'absolute left-0 top-1/2 h-5 w-0.75 -translate-y-1/2 rounded-full bg-accent-400',
                      'origin-center transition-transform duration-(--duration-base) ease-snappy',
                      isActive ? 'scale-y-100' : 'scale-y-0',
                    )}
                    aria-hidden="true"
                  />
                  <item.icon
                    className={cn(
                      'h-4.5 w-4.5 shrink-0 transition-colors duration-(--duration-fast)',
                      isActive ? 'text-accent-400' : 'text-ink-300 group-hover:text-white',
                    )}
                    aria-hidden="true"
                  />
                  {item.label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="border-t border-white/10 px-5 py-4 text-[11px] text-ink-300">
        Hospital Susana López de Valencia
      </div>
    </nav>
  )
}
