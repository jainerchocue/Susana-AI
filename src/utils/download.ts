import axios from 'axios'
import { ApiRequestError } from './errors'

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

/**
 * Con `responseType: 'blob'` el interceptor de apiClient no puede deserializar el
 * cuerpo del error (llega como Blob, no como JSON) — se re-lee aquí a mano.
 */
export async function parseBlobError(error: unknown): Promise<unknown> {
  if (!axios.isAxiosError(error)) return error

  const data = error.response?.data
  if (data instanceof Blob && data.type.includes('json')) {
    try {
      const parsed = JSON.parse(await data.text()) as { error?: { code?: string; message?: string } }
      if (parsed.error) {
        return new ApiRequestError(
          {
            code: parsed.error.code ?? 'SERVICE_UNAVAILABLE',
            message: parsed.error.message ?? 'No se pudo completar la operación.',
          },
          error.response?.status ?? 0,
        )
      }
    } catch {
      // cuerpo no JSON — se deja pasar el error original
    }
  }
  return error
}
