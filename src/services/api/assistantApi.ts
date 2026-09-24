import { requestData } from './apiClient'
import type { AssistantAnswer, AssistantQueryRequest } from '@/types'

/**
 * Único endpoint real del asistente: no existen /assistant/suggestions ni
 * /assistant/history en el backend (ver api.md) — las preguntas sugeridas y
 * el historial de conversación son responsabilidad exclusiva del frontend.
 */
export const assistantApi = {
  ask: (payload: AssistantQueryRequest, signal?: AbortSignal) =>
    requestData<AssistantAnswer>({ method: 'POST', url: '/assistant/query', data: payload, signal }),
}
