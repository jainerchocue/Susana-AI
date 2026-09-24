import type { SuggestedQuestion } from '@/features/assistant/hooks/useAssistant'
import { Button } from '@/components/ui'
import { IconChartLine } from '@/components/ui/icons'
import { cn } from '@/utils/cn'

export function SuggestedQuestions({
  questions,
  onSelect,
  disabled = false,
}: {
  questions: SuggestedQuestion[]
  onSelect: (question: string) => void
  disabled?: boolean
}) {
  if (questions.length === 0) {
    return null
  }

  return (
    <div role="group" aria-label="Preguntas sugeridas" className="flex flex-wrap gap-2">
      {questions.map(({ question, isPrediction }) => (
        <Button
          key={question}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(question)}
          className={cn(
            'whitespace-normal text-left',
            isPrediction &&
              'border border-accent-200 bg-accent-50 text-accent-700 shadow-glow-accent hover:bg-accent-100',
          )}
        >
          {isPrediction && <IconChartLine className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          {question}
        </Button>
      ))}
    </div>
  )
}
