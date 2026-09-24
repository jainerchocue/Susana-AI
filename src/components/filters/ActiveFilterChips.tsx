import { cn } from '@/utils/cn'
import { IconX } from '@/components/ui/icons'

export interface ActiveFilterChip {
  key: string
  label: string
  onClear: () => void
}

export interface ActiveFilterChipsProps {
  filters: ActiveFilterChip[]
  /** Punto pulsante que se enciende mientras la lista se refetchea, para que el
   *  cambio de filtro siempre se vea aunque `keepPreviousData` evite el parpadeo. */
  isFetching?: boolean
  onClearAll?: () => void
}

export function ActiveFilterChips({ filters, isFetching, onClearAll }: ActiveFilterChipsProps) {
  if (filters.length === 0 && !isFetching) return null

  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      {isFetching && (
        <span className="relative flex h-2 w-2 shrink-0" aria-label="Actualizando resultados" role="status">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-500" />
        </span>
      )}

      {filters.map((filter) => (
        <span
          key={filter.key}
          className={cn(
            'inline-flex items-center gap-1 rounded-full border border-brand-200 bg-brand-50 py-0.5 pl-2.5 pr-1 text-xs font-medium text-brand-700',
            'animate-fade-in',
          )}
        >
          {filter.label}
          <button
            type="button"
            onClick={filter.onClear}
            className="flex h-4 w-4 items-center justify-center rounded-full text-brand-500 hover:bg-brand-100 hover:text-brand-700"
            aria-label={`Quitar filtro ${filter.label}`}
          >
            <IconX className="h-2.5 w-2.5" />
          </button>
        </span>
      ))}

      {filters.length > 1 && onClearAll && (
        <button type="button" onClick={onClearAll} className="text-xs font-medium text-ink-500 hover:text-ink-950">
          Limpiar todo
        </button>
      )}
    </div>
  )
}
