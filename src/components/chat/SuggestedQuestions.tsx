import { Button } from '@/components/ui'

export function SuggestedQuestions({
  questions,
  onSelect,
  disabled = false,
}: {
  questions: string[]
  onSelect: (question: string) => void
  disabled?: boolean
}) {
  if (questions.length === 0) {
    return null
  }

  return (
    <div role="group" aria-label="Preguntas sugeridas" className="flex flex-wrap gap-2">
      {questions.map((question) => (
        <Button
          key={question}
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => onSelect(question)}
          className="whitespace-normal text-left"
        >
          {question}
        </Button>
      ))}
    </div>
  )
}
