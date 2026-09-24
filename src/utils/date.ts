import { format, parseISO, startOfDay, startOfMonth, subMonths, subWeeks } from 'date-fns'
import { es } from 'date-fns/locale'

/** ISO local (yyyy-MM-dd) sin desfase de zona horaria, para los filtros desde/hasta. */
export function toISODate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function today(): Date {
  return startOfDay(new Date())
}

export type DatePresetKey = 'today' | '7d' | '30d' | 'month'

export interface DatePreset {
  key: DatePresetKey
  label: string
  range: () => { from: string; to: string }
}

/** Rangos rápidos para el filtro de fecha global (hoy, 7 días, 30 días, mes en curso). */
export const DATE_PRESETS: DatePreset[] = [
  {
    key: 'today',
    label: 'Hoy',
    range: () => {
      const to = today()
      return { from: toISODate(to), to: toISODate(to) }
    },
  },
  {
    key: '7d',
    label: '7 días',
    range: () => {
      const to = today()
      return { from: toISODate(subWeeks(to, 1)), to: toISODate(to) }
    },
  },
  {
    key: '30d',
    label: '30 días',
    range: () => {
      const to = today()
      return { from: toISODate(subMonths(to, 1)), to: toISODate(to) }
    },
  },
  {
    key: 'month',
    label: 'Mes actual',
    range: () => {
      const from = startOfMonth(new Date())
      return { from: toISODate(from), to: toISODate(today()) }
    },
  },
]

/** Fecha corta legible, p. ej. "23 sep 2026". */
export function formatDateLabel(date: Date): string {
  return format(date, 'd MMM yyyy', { locale: es })
}

/** Fecha larga con día de la semana, p. ej. "miércoles, 23 de septiembre de 2026". */
export function formatLongDate(date: Date): string {
  return format(date, "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })
}

/**
 * Rótulo legible del período activo, p. ej. "23 sep 2026 — 24 sep 2026". Acepta
 * tanto el filtro elegido por el usuario como (preferible) el `periodo` que el
 * propio backend devuelve en la respuesta, para que el texto refleje exactamente
 * el rango que se usó al calcular los datos, no lo que el filtro *pedía*.
 */
export function buildPeriodLabel(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to) return `${formatDateLabel(parseISO(from))} — ${formatDateLabel(parseISO(to))}`
  if (from) return `Desde ${formatDateLabel(parseISO(from))}`
  if (to) return `Hasta ${formatDateLabel(parseISO(to))}`
  return 'Todo el período disponible'
}