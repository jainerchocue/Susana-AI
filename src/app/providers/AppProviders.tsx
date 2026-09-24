import type { ReactNode } from 'react'
import { QueryProvider } from './QueryProvider'
import { ToastViewport } from '@/components/ui/ToastViewport'

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      {children}
      <ToastViewport />
    </QueryProvider>
  )
}
