import type { ReactNode } from 'react'
import { QueryProvider } from './QueryProvider'
import { ToastViewport } from '@/components/ui/ToastViewport'
import { TooltipProvider } from '@/components/ui/Tooltip'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider>
        {children}
        <ToastViewport />
      </TooltipProvider>
    </QueryProvider>
  )
}
