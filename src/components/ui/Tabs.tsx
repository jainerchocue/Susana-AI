import * as TabsPrimitive from '@radix-ui/react-tabs'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/utils/cn'

export const Tabs = TabsPrimitive.Root

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn('flex flex-wrap gap-1 border-b border-surface-100', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  icon,
  children,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger> & { icon?: ReactNode }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium text-ink-500',
        'transition-colors duration-(--duration-fast) ease-snappy',
        'hover:text-ink-950',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 rounded-t-md',
        'data-[state=active]:text-brand-600',
        "after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600 after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100",
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('animate-fade-in flex flex-col gap-6 pt-6', className)} {...props} />
}
