import { useEffect } from 'react'
import { useToastStore, type ToastItem, type ToastTone } from '@/app/store/toastStore'
import { cn } from '@/utils/cn'

const TONE_STYLES: Record<ToastTone, string> = {
  success: 'border-status-good/30 bg-white',
  error: 'border-status-critical/30 bg-white',
  info: 'border-brand-500/30 bg-white',
}

const TONE_DOT: Record<ToastTone, string> = {
  success: 'bg-status-good',
  error: 'bg-status-critical',
  info: 'bg-brand-500',
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss)

  useEffect(() => {
    const timer = setTimeout(() => dismiss(toast.id), 4200)
    return () => clearTimeout(timer)
  }, [toast.id, dismiss])

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'animate-fade-up pointer-events-auto flex w-80 items-start gap-3 rounded-xl border px-4 py-3 shadow-floating',
        TONE_STYLES[toast.tone],
      )}
    >
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[toast.tone])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-950">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-ink-500">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        className="shrink-0 rounded-md p-1 text-ink-300 hover:bg-surface-50 hover:text-ink-700"
        aria-label="Cerrar notificación"
      >
        ✕
      </button>
    </div>
  )
}

export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts)

  if (toasts.length === 0) return null

  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  )
}
