import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/types'
import { EmptyState } from '@/components/ui'
import { IconChat } from '@/components/ui/icons'
import { MessageBubble } from './MessageBubble'

export function ChatWindow({
  messages,
  isResponding = false,
}: {
  messages: ChatMessage[]
  isResponding?: boolean
}) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages.length])

  if (messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState
          icon={<IconChat className="h-8 w-8" />}
          title="Inicie una conversación"
          description="Escriba una pregunta sobre la operación del hospital o elija una de las sugerencias para comenzar."
        />
      </div>
    )
  }

  return (
    <div
      role="log"
      aria-live="polite"
      aria-busy={isResponding || undefined}
      className="scrollbar-thin flex h-full flex-col gap-4 overflow-y-auto px-1 py-2"
    >
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {isResponding && (
        <div className="flex justify-start px-1">
          <span className="text-xs text-ink-500">El asistente está respondiendo...</span>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
