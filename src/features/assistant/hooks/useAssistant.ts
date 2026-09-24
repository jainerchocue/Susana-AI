import { useRef, useState } from 'react'
import type { ChatMessage } from '@/types'
import { assistantApi } from '@/services/api'
import { getDisplayErrorMessage } from '@/utils/errors'

/**
 * No existe /assistant/suggestions en el backend (ver api.md): estas son
 * sugerencias fijas del frontend, no datos que vengan del servidor.
 */
export const SUGGESTED_QUESTIONS = [
  '¿Cuál es la ocupación general del hospital?',
  '¿Qué medicamentos tienen menos días de inventario?',
  '¿Cuál es la espera por nivel de triage?',
  '¿Qué unidad tiene mayor cambio de demanda esta semana?',
]

export function useAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const idCounterRef = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  function nextId(): string {
    const id = `msg-${idCounterRef.current}`
    idCounterRef.current += 1
    return id
  }

  async function ask(question: string): Promise<void> {
    const trimmed = question.trim()
    if (!trimmed) return

    const userMessage: ChatMessage = {
      id: nextId(),
      role: 'user',
      text: trimmed,
      createdAt: new Date().toISOString(),
      status: 'complete',
    }

    const assistantMessageId = nextId()
    const pendingMessage: ChatMessage = {
      id: assistantMessageId,
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'pending',
    }

    setMessages((prev) => [...prev, userMessage, pendingMessage])

    const controller = new AbortController()
    controllerRef.current = controller

    try {
      const answer = await assistantApi.ask({ question: trimmed }, controller.signal)

      setMessages((prev) =>
        prev.map((message) =>
          message.id === assistantMessageId ? { ...message, status: 'complete', answer, text: answer.answer } : message,
        ),
      )
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId ? { ...message, status: 'cancelled' } : message,
          ),
        )
      } else {
        setMessages((prev) =>
          prev.map((message) =>
            message.id === assistantMessageId
              ? { ...message, status: 'error', errorMessage: getDisplayErrorMessage(error) }
              : message,
          ),
        )
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
      }
    }
  }

  function cancel(): void {
    controllerRef.current?.abort()
  }

  function retryLast(): void {
    const lastMessage = messages[messages.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.status !== 'error') {
      return
    }

    const previousMessage = messages[messages.length - 2]
    if (!previousMessage || previousMessage.role !== 'user') {
      return
    }

    setMessages((prev) => prev.slice(0, -1))
    void ask(previousMessage.text)
  }

  const isSending = messages.some((message) => message.status === 'pending')

  return {
    messages,
    suggestions: SUGGESTED_QUESTIONS,
    ask,
    cancel,
    retryLast,
    isSending,
  }
}
