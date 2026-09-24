import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/app/store/authStore'
import { NAV_ITEMS, type NavGroup, type NavItem } from '@/app/router/navConfig'
import { cn } from '@/utils/cn'
import { hasPermission } from '@/utils/permissions'
import { IconChevronDown, IconSparkles } from '@/components/ui/icons'

const GROUP_ORDER: NavGroup[] = ['General', 'Clínico', 'Datos', 'Administración']

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  return (
    <li>
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
  )
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const permissions = useAuthStore((state) => state.permissions)
  const location = useLocation()
  const visibleItems = NAV_ITEMS.filter((item) => !item.permission || hasPermission(permissions, item.permission))
  const ungroupedItems = visibleItems.filter((item) => !item.group)

  const activeGroup = visibleItems.find(
    (item) => item.group && (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)),
  )?.group

  const [expanded, setExpanded] = useState<Set<NavGroup>>(() => new Set(activeGroup ? [activeGroup] : ['General']))

  function toggleGroup(group: NavGroup) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  return (
    <nav aria-label="Navegación principal" className="flex h-full w-64 flex-col bg-brand-950 text-white">
      <div className="flex items-center gap-2 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 shadow-glow-brand">
          <IconSparkles className="h-4 w-4 text-white" />
        </span>
        <div>
          <p className="text-sm font-semibold leading-tight">Hospital Intelligence</p>
          <p className="text-[11px] text-ink-300">Centro de Inteligencia Operativa</p>
        </div>
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
        {GROUP_ORDER.map((group) => {
          const items = visibleItems.filter((item) => item.group === group)
          if (items.length === 0) return null
          const isExpanded = expanded.has(group)
          const isActiveGroup = activeGroup === group
          const panelId = `nav-group-${group}`

          return (
            <div key={group} className="mb-1">
              <button
                type="button"
                onClick={() => toggleGroup(group)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-[11px] font-semibold uppercase tracking-wider',
                  'transition-colors duration-(--duration-fast) hover:text-white',
                  isActiveGroup ? 'text-accent-400' : 'text-ink-300/80',
                )}
              >
                <span className="flex items-center gap-1.5">
                  {group}
                  {!isExpanded && items.length > 0 && (
                    <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium normal-case text-ink-300">
                      {items.length}
                    </span>
                  )}
                </span>
                <IconChevronDown
                  className={cn('h-3.5 w-3.5 shrink-0 transition-transform duration-(--duration-base) ease-snappy', isExpanded && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>
              <div
                id={panelId}
                className="grid transition-[grid-template-rows] duration-(--duration-base) ease-snappy"
                style={{ gridTemplateRows: isExpanded ? '1fr' : '0fr' }}
              >
                <ul className="flex flex-col gap-1 overflow-hidden">
                  {items.map((item) => (
                    <NavItemLink key={item.path} item={item} onNavigate={onNavigate} />
                  ))}
                </ul>
              </div>
              <div className="mt-2 border-b border-white/5" />
            </div>
          )
        })}

        {ungroupedItems.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1">
            {ungroupedItems.map((item) => (
              <NavItemLink key={item.path} item={item} onNavigate={onNavigate} />
            ))}
          </ul>
        )}
      </div>

      <div className="border-t border-white/10 px-5 py-4 text-[11px] text-ink-300">
        Hospital Susana López de Valencia
      </div>
    </nav>
  )
}
