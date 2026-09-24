import { useAssistant } from '@/features/assistant/hooks/useAssistant'
import { ChatInput, ChatWindow, SuggestedQuestions } from '@/components/chat'
import { Button } from '@/components/ui'
import { IconChat } from '@/components/ui/icons'

export default function AssistantPage() {
  const { messages, suggestions, ask, cancel, retryLast, isSending } = useAssistant()

  const lastMessage = messages[messages.length - 1]
  const showRetry = lastMessage?.role === 'assistant' && lastMessage.status === 'error'
  const showSuggestions = messages.length === 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex items-center gap-2">
        <IconChat className="h-5 w-5 text-brand-600" aria-hidden="true" />
        <h1 className="text-lg font-semibold text-ink-950">Hospital Intelligence AI</h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-surface-100 bg-white">
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

        <ChatInput onSubmit={ask} isSending={isSending} onCancel={cancel} />
      </div>
    </div>
  )
}
