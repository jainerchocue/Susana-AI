import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={100}>
      {children}
    </TooltipPrimitive.Provider>
  )
}

export interface TooltipProps {
  label: string
  children: ReactNode
}

/** Nombre flotante accesible para botones de acción — icono ambiguo por sí solo, claro al pasar el cursor/foco. */
export function Tooltip({ label, children }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="top"
          sideOffset={6}
          className="animate-fade-in z-50 rounded-md bg-ink-950 px-2.5 py-1.5 text-xs font-medium text-white shadow-raised"
        >
          {label}
          <TooltipPrimitive.Arrow className="fill-ink-950" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
