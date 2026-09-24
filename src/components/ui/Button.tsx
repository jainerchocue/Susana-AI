import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { cn } from '@/utils/cn'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary:
    'bg-brand-600 text-white shadow-soft hover:bg-brand-700 hover:shadow-glow-brand hover:-translate-y-px active:translate-y-0 active:shadow-soft disabled:bg-brand-300 disabled:shadow-none disabled:translate-y-0',
  secondary:
    'bg-surface-100 text-ink-900 hover:bg-surface-100/80 hover:-translate-y-px active:translate-y-0 disabled:text-ink-300 disabled:translate-y-0',
  ghost: 'bg-transparent text-ink-700 hover:bg-surface-50 disabled:text-ink-300',
  danger:
    'bg-status-critical text-white shadow-soft hover:opacity-90 hover:-translate-y-px active:translate-y-0 disabled:opacity-50 disabled:translate-y-0',
  success:
    'bg-status-good text-white shadow-soft hover:bg-status-good/90 hover:-translate-y-px active:translate-y-0 active:shadow-soft disabled:bg-status-good/40 disabled:shadow-none disabled:translate-y-0',
}

const sizeClasses: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-12 px-6 text-base gap-2',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', isLoading, disabled, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded-lg font-medium',
        'transition-[background-color,box-shadow,transform,opacity] duration-(--duration-fast) ease-snappy',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {isLoading && (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  )
})
