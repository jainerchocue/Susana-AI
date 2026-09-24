import { z } from 'zod'

export const assistantQuestionSchema = z.object({
  question: z
    .string()
    .min(1, 'Escriba una pregunta')
    .max(500, 'La pregunta es demasiado larga'),
})

export type AssistantQuestionFormValues = z.infer<typeof assistantQuestionSchema>
