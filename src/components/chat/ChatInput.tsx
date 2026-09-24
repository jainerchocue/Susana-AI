import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { assistantQuestionSchema, type AssistantQuestionFormValues } from '@/schemas/assistant.schema'
import { Button } from '@/components/ui'
import { IconSend } from '@/components/ui/icons'
import { cn } from '@/utils/cn'

export function ChatInput({
  onSubmit,
  isSending,
  onCancel,
  placeholder = 'Escriba su pregunta (p. ej., ¿cuál es la ocupación del hospital?)',
}: {
  onSubmit: (question: string) => void
  isSending: boolean
  onCancel?: () => void
  placeholder?: string
}) {
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm<AssistantQuestionFormValues>({
    resolver: zodResolver(assistantQuestionSchema),
    mode: 'onChange',
    defaultValues: { question: '' },
  })

  const questionValue = watch('question')
  const isEmpty = !questionValue || questionValue.trim().length === 0

  const submit = handleSubmit((values) => {
    onSubmit(values.question.trim())
    reset({ question: '' })
  })

  return (
    <form onSubmit={submit} className="flex items-end gap-2 border-t border-surface-100 bg-white p-3">
      <div className="flex flex-1 flex-col gap-1">
        <label htmlFor="assistant-question" className="sr-only">
          Escriba su pregunta
        </label>
        <textarea
          id="assistant-question"
          rows={1}
          placeholder={placeholder}
          disabled={isSending}
          aria-invalid={Boolean(errors.question) || undefined}
          aria-describedby={errors.question ? 'assistant-question-error' : undefined}
          className={cn(
            'min-h-10 max-h-32 resize-none rounded-lg border border-surface-100 bg-white px-3 py-2 text-sm text-ink-950 placeholder:text-ink-300',
            'transition-shadow duration-(--duration-fast) ease-snappy',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
            'disabled:cursor-not-allowed disabled:bg-surface-0 disabled:text-ink-300',
            errors.question && 'border-status-critical focus-visible:ring-status-critical',
          )}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit()
            }
          }}
          {...register('question')}
        />
        {errors.question && (
          <p id="assistant-question-error" role="alert" className="text-xs text-status-critical">
            {errors.question.message}
          </p>
        )}
      </div>

      {isSending && (
        <Button type="button" variant="ghost" size="md" onClick={() => onCancel?.()}>
          Cancelar
        </Button>
      )}

      <Button
        type="submit"
        size="md"
        variant="success"
        isLoading={isSending}
        disabled={isSending || isEmpty}
        aria-label="Enviar pregunta"
        className="aspect-square rounded-full px-0"
      >
        <IconSend className="h-4 w-4" aria-hidden="true" />
      </Button>
    </form>
  )
}
