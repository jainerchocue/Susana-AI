import type { HTMLAttributes } from 'react'
import { cn } from '@/utils/cn'

export type BadgeTone = 'critical' | 'high' | 'medium' | 'info' | 'good' | 'neutral'

const toneClasses: Record<BadgeTone, string> = {
  critical: 'bg-status-critical-bg text-status-critical',
  high: 'bg-status-high-bg text-status-high',
  medium: 'bg-status-medium-bg text-status-medium',
  info: 'bg-status-info-bg text-status-info',
  good: 'bg-status-good-bg text-status-good',
  neutral: 'bg-surface-100 text-ink-700',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  /** Adds a small pulsing dot — reserve for a single "live/unacknowledged" indicator, not decoration. */
  pulse?: boolean
}

export function Badge({ tone = 'neutral', pulse, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
        toneClasses[tone],
        className,
      )}
      {...props}
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {children}
    </span>
  )
}
