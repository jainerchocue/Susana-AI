import { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Topbar } from './Topbar'
import { FloatingAssistant } from '@/components/assistant/FloatingAssistant'
import { NAV_ITEMS } from '@/app/router/navConfig'
import { cn } from '@/utils/cn'

export function AppShell() {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false)
  const location = useLocation()
  const currentTitle =
    NAV_ITEMS.find((item) => (item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path)))
      ?.label ?? 'Hospital Intelligence'

  return (
    <div className="flex h-screen w-full overflow-hidden bg-surface-0">
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {isMobileNavOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div
            className="fixed inset-0 bg-ink-950/50"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div className={cn('relative z-50')}>
            <Sidebar onNavigate={() => setIsMobileNavOpen(false)} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={currentTitle} onMenuClick={() => setIsMobileNavOpen(true)} />
        <main className="scrollbar-thin flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1480px] p-4 pb-28 sm:p-6 sm:pb-28">
            <Outlet />
          </div>
        </main>
      </div>

      <FloatingAssistant />
    </div>
  )
}
