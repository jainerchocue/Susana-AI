import type { AssistantQueryResult, ChatMessage } from '@/types'
import { Card, CardBody, ErrorState, Spinner } from '@/components/ui'
import { IconSparkles } from '@/components/ui/icons'
import { AssistantInsightCard } from './AssistantInsightCard'
import { AssistantPredictionCard } from './AssistantPredictionCard'
import { buildAssistantInsight, extractPrediction } from '@/features/assistant/insights'
import { formatNumber } from '@/utils/format'

function isNumericCell(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function QueryResultView({ result, index }: { result: AssistantQueryResult; index: number }) {
  return (
    <details className="group rounded-lg border border-surface-100 bg-white p-3">
      <summary className="cursor-pointer list-none text-sm font-medium text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
        <span className="group-open:hidden">
          Ver datos · {result.query.dataset} ({formatNumber(result.rowCount)} fila{result.rowCount === 1 ? '' : 's'})
        </span>
        <span className="hidden group-open:inline">Ocultar datos · {result.query.dataset}</span>
      </summary>
      <div className="scrollbar-thin mt-3 max-h-56 overflow-auto rounded-md border border-surface-100">
        <table className="w-full min-w-max text-left text-xs">
          <thead className="sticky top-0 bg-surface-50 text-ink-700">
            <tr>
              {result.columns.map((column) => (
                <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 font-semibold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row, rowIndex) => (
              <tr key={`${index}-${rowIndex}`} className="border-t border-surface-100">
                {result.columns.map((column) => (
                  <td key={column} className="whitespace-nowrap px-3 py-2 text-ink-900 tabular-nums">
                    {isNumericCell(row[column]) ? formatNumber(row[column], 0) : (row[column] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {result.truncated && (
        <p className="mt-2 text-[11px] text-ink-500">Resultado truncado — hay más filas que las mostradas.</p>
      )}
    </details>
  )
}

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

  if (!message.answer) {
    return <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{message.text}</p>
  }

  const { answer } = message
  // Solo la primera consulta define la cifra destacada — si el asistente ejecutó varias,
  // las demás igual quedan disponibles abajo en sus propias tablas.
  const insight = answer.status === 'ok' && answer.queries[0] ? buildAssistantInsight(answer.queries[0]) : null
  const prediction = answer.status === 'ok' ? extractPrediction(answer.answer) : null
  const hasInterpretation = Boolean(insight || prediction)

  return (
    <div className="flex flex-col gap-3">
      {insight && <AssistantInsightCard insight={insight} />}
      {prediction && <AssistantPredictionCard prediction={prediction} />}

      {hasInterpretation ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-500 hover:text-ink-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
            <span className="group-open:hidden">Ver respuesta completa</span>
            <span className="hidden group-open:inline">Ocultar respuesta completa</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-ink-500">{answer.answer}</p>
        </details>
      ) : (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-900">{answer.answer}</p>
      )}

      {answer.queries.map((result, index) => (
        <QueryResultView key={index} result={result} index={index} />
      ))}
    </div>
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
