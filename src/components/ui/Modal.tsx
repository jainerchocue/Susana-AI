import * as Dialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'
import { cn } from '@/utils/cn'
import { IconX } from './icons'

export interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  /** Ancho máximo del panel — 'lg' para asistentes con varios pasos. */
  size?: 'md' | 'lg'
}

/**
 * Sobre Radix Dialog: trampa de foco, cierre con Escape, aria-modal y bloqueo de
 * scroll correctos "gratis" — solo se estiliza el overlay/panel con la marca.
 */
export function Modal({ open, onOpenChange, title, description, children, size = 'md' }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 animate-fade-in bg-ink-950/40 backdrop-blur-sm" />
        <Dialog.Content
          className={cn(
            'fixed inset-x-4 top-1/2 z-50 max-h-[90vh] -translate-y-1/2 animate-scale-in overflow-y-auto',
            'rounded-2xl border border-surface-100 bg-white shadow-floating',
            'sm:inset-x-auto sm:left-1/2 sm:w-full sm:-translate-x-1/2',
            size === 'lg' ? 'sm:max-w-2xl' : 'sm:max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-3 border-b border-surface-100 px-6 py-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink-950">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-xs text-ink-500">{description}</Dialog.Description>}
            </div>
            <Dialog.Close
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-500',
                'hover:bg-surface-50 hover:text-ink-950',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
              )}
              aria-label="Cerrar"
            >
              <IconX className="h-4 w-4" />
            </Dialog.Close>
          </div>
          <div className="px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
