import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '@/app/store/authStore'
import { useAssistant } from '@/features/assistant/hooks/useAssistant'
import { PERMISSIONS, ROUTES } from '@/constants'
import { ChatInput, ChatWindow, SuggestedQuestions } from '@/components/chat'
import { Button } from '@/components/ui'
import { IconSparkles } from '@/components/ui/icons'

/**
 * Acceso rápido al asistente desde cualquier página: botón flotante + panel
 * de chat (mismo hook/componentes que la página /assistant) sin cubrir la
 * pantalla. Se oculta en la propia página del asistente para no duplicar UI.
 */
export function FloatingAssistant() {
  const canUseAssistant = useAuthStore((state) => state.hasPermission(PERMISSIONS.ASSISTANT_USE))
  const location = useLocation()
  const [isOpen, setIsOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)
  const { messages, suggestions, ask, cancel, retryLast, isSending } = useAssistant()

  // Cerrar el panel al navegar (el chat persiste en memoria del hook).
  if (prevPath !== location.pathname) {
    setPrevPath(location.pathname)
    setIsOpen(false)
  }

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen])

  if (!canUseAssistant || location.pathname === ROUTES.ASSISTANT) return null

  const lastMessage = messages[messages.length - 1]
  const showRetry = lastMessage?.role === 'assistant' && lastMessage.status === 'error'
  const showSuggestions = messages.length === 0

  return (
    <div className="fixed inset-y-0 right-4 z-40 flex flex-col justify-end sm:right-6">
      {isOpen ? (
        <div
          role="dialog"
          aria-label="Asistente de IA"
          aria-modal="true"
          className="animate-fade-in flex h-full w-[calc(100vw-2rem)] max-w-[26rem] flex-col self-end overflow-hidden rounded-2xl border border-surface-100 bg-white shadow-floating"
        >
          <header className="flex items-center justify-between border-b border-surface-100 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-brand-500 to-accent-500">
                <IconSparkles className="h-3.5 w-3.5 text-white" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-950">Hospital Intelligence AI</p>
                <p className="text-[11px] text-ink-500">Pregunte sobre la operación del hospital</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="shrink-0 rounded-md p-1.5 text-ink-300 hover:bg-surface-50 hover:text-ink-700"
              aria-label="Cerrar asistente"
            >
              ✕
            </button>
          </header>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 px-4 py-4">
              <ChatWindow messages={messages} isResponding={isSending} />
            </div>

            {showRetry && (
              <div className="flex justify-start border-t border-surface-100 px-4 py-2">
                <Button type="button" size="sm" variant="secondary" onClick={retryLast}>
                  Reintentar
                </Button>
              </div>
            )}

            {showSuggestions && (
              <div className="border-t border-surface-100 px-4 py-3">
                <SuggestedQuestions questions={suggestions} onSelect={ask} disabled={isSending} />
              </div>
            )}

            <ChatInput onSubmit={ask} isSending={isSending} onCancel={cancel} placeholder="Escriba su pregunta…" />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Abrir asistente"
          aria-haspopup="dialog"
          className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-glow-brand transition-[background-color,transform] duration-(--duration-fast) ease-snappy hover:-translate-y-0.5 hover:bg-brand-700"
        >
          <IconSparkles className="h-6 w-6" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}