import { format, formatDistanceToNow, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits }).format(value)
}

export function formatPercent(value: number, maximumFractionDigits = 1): string {
  return `${formatNumber(value, maximumFractionDigits)}%`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${formatNumber(value, 1)} ${units[unitIndex]}`
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
