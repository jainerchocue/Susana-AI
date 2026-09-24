import { format, parseISO } from 'date-fns'

/** ISO 8601 -> valor de un <input type="datetime-local"> ("yyyy-MM-dd'T'HH:mm"), en hora local. */
export function toDatetimeLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm")
  } catch {
    return ''
  }
}

/** Valor de un <input type="datetime-local"> -> ISO 8601, como lo espera el backend. */
export function fromDatetimeLocalInput(value: string): string {
  return new Date(value).toISOString()
}
