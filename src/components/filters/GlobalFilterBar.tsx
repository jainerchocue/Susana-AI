import { Button, Input } from '@/components/ui'
import { useGlobalFilters } from '@/hooks/useGlobalFilters'
import { DATE_PRESETS } from '@/utils/date'
import { cn } from '@/utils/cn'

function isPresetActive(
  preset: { range: () => { from: string; to: string } },
  from: string | null,
  to: string | null,
): boolean {
  if (from === null || to === null) return false
  const range = preset.range()
  return range.from === from && range.to === to
}

/**
 * Rango de fechas global (desde/hasta) con accesos rápidos, sincronizado con la
 * URL. Es el único filtro que dashboard/*, analytics/* y medications aceptan de
 * forma transversal — filtros de dominio (severidad, kind, etc.) viven en cada página.
 */
export function GlobalFilterBar() {
  const { filters, setFilter, resetFilters } = useGlobalFilters()
  const hasActiveFilters = filters.from !== null || filters.to !== null
  const activePreset = DATE_PRESETS.find((preset) => isPresetActive(preset, filters.from, filters.to))?.key

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-ink-700">Período</span>
        <div role="group" aria-label="Período" className="flex flex-wrap items-center gap-1.5">
          {DATE_PRESETS.map((preset) => {
            const isActive = activePreset === preset.key
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  const range = preset.range()
                  setFilter('from', range.from)
                  setFilter('to', range.to)
                }}
                className={cn(
                  'h-7 rounded-full border px-2.5 text-xs font-medium transition-colors duration-(--duration-fast) ease-snappy',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                  isActive
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-surface-100 bg-white text-ink-700 hover:border-brand-200 hover:text-ink-950',
                )}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </div>

      <Input
        type="date"
        label="Desde"
        value={filters.from ?? ''}
        onChange={(event) => setFilter('from', event.target.value || null)}
        className="w-auto"
      />
      <Input
        type="date"
        label="Hasta"
        value={filters.to ?? ''}
        onChange={(event) => setFilter('to', event.target.value || null)}
        className="w-auto"
      />

      {hasActiveFilters && (
        <Button type="button" variant="ghost" size="sm" onClick={resetFilters}>
          Limpiar
        </Button>
      )}
    </div>
  )
}