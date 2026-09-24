import type { ChatMessage } from '@/types'
import { Card, CardBody, ErrorState, Spinner } from '@/components/ui'
import { IconSparkles } from '@/components/ui/icons'
import { AssistantVisual } from './AssistantVisual'

function AssistantMessageContent({ message }: { message: ChatMessage }) {
  if (message.status === 'pending') {
    return (
      <div className="flex items-center gap-2 text-ink-500">
        <Spinner label="Analizando la consulta" />
        <span className="text-sm">Analizando...</span>
      </div>
    )
  }

  if (message.status === 'error') {
    return (
      <ErrorState
        title="No se pudo procesar la consulta"
        description={message.errorMessage ?? 'Ocurrió un problema al generar la respuesta. Intente nuevamente.'}
      />
    )
  }

  if (message.status === 'cancelled') {
    return <p className="text-sm italic text-ink-500">Consulta cancelada</p>
  }

  const text = message.answer ? message.answer.answer : message.text

  return (
    <>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{text}</p>
      {message.answer && <AssistantVisual answer={message.answer} />}
    </>
  )
}

export function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="animate-fade-up flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-soft sm:max-w-[75%]">
          <p className="whitespace-pre-wrap">{message.text}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up flex items-start gap-2.5">
      <span
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 shadow-soft"
        aria-hidden="true"
      >
        <IconSparkles className="h-3.5 w-3.5 text-white" />
      </span>
      <div className="max-w-[90%] sm:max-w-[80%]">
        <Card className="rounded-2xl rounded-tl-sm">
          <CardBody className="flex flex-col gap-3 p-4">
            <AssistantMessageContent message={message} />
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
