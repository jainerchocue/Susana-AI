import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits }).format(value)
}

export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return `${formatNumber(value, maximumFractionDigits)}%`
}

export function formatDateTime(iso: string): string {
  try {
    return format(parseISO(iso), "d 'de' MMM, HH:mm", { locale: es })
  } catch {
    return iso
  }
}

export function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'd MMM yyyy', { locale: es })
  } catch {
    return iso
  }
}

export function formatRelativeTime(iso: string): string {
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true, locale: es })
  } catch {
    return iso
  }
}
