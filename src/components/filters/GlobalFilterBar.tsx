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

const chipBase =
  'h-8 rounded-full px-3.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#76B82A] focus-visible:ring-offset-1'
const chipOn = 'bg-[#29235C] text-white shadow-sm'
const chipOff = 'text-[#29235C]/70 hover:bg-[#29235C]/[0.07] hover:text-[#29235C]'

const dateInputBase =
  'h-9 rounded-lg border bg-white px-2.5 text-sm text-[#29235C] outline-none transition focus:border-[#327531] focus:ring-4 focus:ring-[#76B82A]/25'

/**
 * Rango de fechas global (desde/hasta) sincronizado con la URL. Es el único filtro
 * que dashboard/*, analytics/* y medications aceptan de forma transversal — los
 * filtros de dominio (severidad, kind, etc.) viven en cada página.
 *
 * No hay botón "Limpiar": cada opción aplica el filtro al instante, "Todo el período"
 * quita el rango, y volver a pulsar un acceso rápido activo también lo quita.
 */
export function GlobalFilterBar() {
  const { filters, setFilter, setFilters } = useGlobalFilters()

  const isAllPeriod = filters.from === null && filters.to === null
  const activePreset = DATE_PRESETS.find((preset) => isPresetActive(preset, filters.from, filters.to))?.key

  const clearRange = () => {
    setFilters({ from: null, to: null })
  }

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-4 rounded-2xl border border-[#29235C]/10 bg-white p-3 sm:p-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-[#29235C]/70">Período</span>
        <div
          role="group"
          aria-label="Período"
          className="flex flex-wrap items-center gap-1 rounded-full bg-[#29235C]/[0.04] p-1"
        >
          <button
            type="button"
            aria-pressed={isAllPeriod}
            onClick={() => {
              if (!isAllPeriod) clearRange()
            }}
            className={cn(chipBase, isAllPeriod ? chipOn : chipOff)}
          >
            Todo el período
          </button>

          {DATE_PRESETS.map((preset) => {
            const isActive = activePreset === preset.key
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  // Pulsar el acceso activo lo desmarca y vuelve a "Todo el período"
                  if (isActive) {
                    clearRange()
                    return
                  }
                  const range = preset.range()
                  setFilters({ from: range.from, to: range.to })
                }}
                className={cn(chipBase, isActive ? chipOn : chipOff)}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[#29235C]/70">Desde</span>
          <input
            type="date"
            value={filters.from ?? ''}
            max={filters.to ?? undefined}
            onChange={(event) => setFilter('from', event.target.value || null)}
            className={cn(dateInputBase, filters.from ? 'border-[#327531]/50' : 'border-[#29235C]/15')}
          />
        </label>
        <span aria-hidden="true" className="pb-2 text-[#29235C]/30">
          —
        </span>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[#29235C]/70">Hasta</span>
          <input
            type="date"
            value={filters.to ?? ''}
            min={filters.from ?? undefined}
            onChange={(event) => setFilter('to', event.target.value || null)}
            className={cn(dateInputBase, filters.to ? 'border-[#327531]/50' : 'border-[#29235C]/15')}
          />
        </label>
      </div>
    </div>
  )
}