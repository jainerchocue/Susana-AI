import { type InputHTMLAttributes, type ReactNode, forwardRef, useId } from 'react'
import { cn } from '@/utils/cn'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  /** Icon rendered at the start of the field, e.g. a search magnifier. */
  startAdornment?: ReactNode
  /** Icon/button rendered inside the field, e.g. a password visibility toggle. */
  endAdornment?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, label, error, hint, id, startAdornment, endAdornment, ...props },
  ref,
) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = error ? `${inputId}-error` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-ink-700">
          {label}
        </label>
      )}
      <div className="relative">
        {startAdornment && (
          <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-300">
            {startAdornment}
          </div>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={cn(errorId, hintId) || undefined}
          className={cn(
            'h-10 w-full rounded-lg border border-surface-100 bg-white px-3 text-sm text-ink-950 placeholder:text-ink-300',
            'transition-shadow duration-(--duration-fast) ease-snappy',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            error && 'border-status-critical focus-visible:ring-status-critical',
            startAdornment && 'pl-9',
            endAdornment && 'pr-10',
            className,
          )}
          {...props}
        />
        {endAdornment && (
          <div className="absolute inset-y-0 right-1 flex items-center">{endAdornment}</div>
        )}
      </div>
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-status-critical">
          {error}
        </p>
      )}
    </div>
  )
})
