import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { GlobalFilters } from '@/types'

export interface UseGlobalFiltersResult {
  filters: GlobalFilters
  setFilter: (key: keyof GlobalFilters, value: string | null) => void
  /** Aplica varias claves a la vez en una sola actualización de la URL — evita que dos
   *  `setFilter` seguidos (p. ej. from+to de un preset) se pisen entre sí. */
  setFilters: (partial: Partial<GlobalFilters>) => void
  resetFilters: () => void
}

/**
 * Sincroniza el rango de fechas (desde/hasta) con la URL, para que la vista
 * actual sea compartible y las claves de caché de TanStack Query reflejen
 * exactamente lo que el usuario está viendo.
 */
export function useGlobalFilters(): UseGlobalFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams()

  const filters = useMemo<GlobalFilters>(
    () => ({
      from: searchParams.get('from'),
      to: searchParams.get('to'),
    }),
    [searchParams],
  )

  const setFilter = useCallback(
    (key: keyof GlobalFilters, value: string | null) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (value === null || value === '') {
            next.delete(key)
          } else {
            next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const setFilters = useCallback(
    (partial: Partial<GlobalFilters>) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const [key, value] of Object.entries(partial)) {
            if (value === null || value === '') next.delete(key)
            else next.set(key, value)
          }
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const resetFilters = useCallback(() => {
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        next.delete('from')
        next.delete('to')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])

  return { filters, setFilter, setFilters, resetFilters }
}
