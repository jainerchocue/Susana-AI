import type { ReactNode } from 'react'
import { Button, EmptyState, ErrorState, Input, Skeleton } from '@/components/ui'
import { IconSearch } from '@/components/ui/icons'
import { cn } from '@/utils/cn'
import { getDisplayErrorMessage } from '@/utils/errors'

export type SortDirection = 'asc' | 'desc'

export interface DataTableColumn<T> {
  id: string
  header: string
  cell: (row: T) => ReactNode
  sortable?: boolean
  /** Alineación/número de columna: usa `col-span` para anchos, `text-right` para números. */
  className?: string
}

interface DataTableBaseProps<T> {
  columns: DataTableColumn<T>[]
  data: T[]
  getRowId: (row: T) => string
  isLoading?: boolean
  /** Refetch en segundo plano (p. ej. al cambiar un filtro) — distinto de `isLoading`, que es solo la carga inicial. */
  isFetching?: boolean
  isError?: boolean
  error?: unknown
  onRetry?: () => void
  emptyMessage?: string
  emptyDescription?: string
  sortBy?: string
  sortDirection?: SortDirection
  onSortChange?: (columnId: string) => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
}

interface OffsetPaginationProps {
  paginationMode?: 'offset'
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
}

interface CursorPaginationProps {
  paginationMode: 'cursor'
  hasNext: boolean
  hasPrev: boolean
  onNext: () => void
  onPrev: () => void
  /** Página actual (1-indexada) — la paginación por cursor no conoce el total, pero sí en qué página va. */
  currentPage?: number
}

export type DataTableProps<T> = DataTableBaseProps<T> & (OffsetPaginationProps | CursorPaginationProps)

const SKELETON_ROWS = 5

function getAriaSort<T>(
  column: DataTableColumn<T>,
  sortBy?: string,
  sortDirection?: SortDirection,
): 'ascending' | 'descending' | 'none' {
  if (!column.sortable || sortBy !== column.id) return 'none'
  return sortDirection === 'desc' ? 'descending' : 'ascending'
}

function SortIndicator({ direction }: { direction: 'ascending' | 'descending' | 'none' }) {
  if (direction === 'none') return null
  return (
    <span aria-hidden="true" className="text-[10px] leading-none text-brand-600">
      {direction === 'ascending' ? '▲' : '▼'}
    </span>
  )
}

export function DataTable<T>(props: DataTableProps<T>) {
  const {
    columns,
    data,
    getRowId,
    isLoading = false,
    isFetching = false,
    isError = false,
    error,
    onRetry,
    emptyMessage,
    emptyDescription,
    sortBy,
    sortDirection,
    onSortChange,
    searchValue,
    onSearchChange,
    searchPlaceholder,
  } = props

  const isRefetching = isFetching && !isLoading

  const isCursor = props.paginationMode === 'cursor'
  const totalPages = !isCursor ? Math.max(1, Math.ceil(props.total / props.pageSize)) : 0
  const isFirstPage = isCursor ? !props.hasPrev : props.page <= 1
  const isLastPage = isCursor ? !props.hasNext : props.page >= totalPages
  const rangeStart = !isCursor && props.total > 0 ? (props.page - 1) * props.pageSize + 1 : 0
  const rangeEnd = !isCursor && props.total > 0 ? Math.min(props.page * props.pageSize, props.total) : 0
  const isEmpty = data.length === 0

  const showSearch = onSearchChange !== undefined

  function goPrev() {
    if (isCursor) props.onPrev()
    else props.onPageChange(props.page - 1)
  }

  function goNext() {
    if (isCursor) props.onNext()
    else props.onPageChange(props.page + 1)
  }

  return (
    <div className="flex flex-col gap-3">
      {showSearch && (
        <Input
          type="search"
          value={searchValue ?? ''}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder={searchPlaceholder ?? 'Buscar...'}
          aria-label={searchPlaceholder ?? 'Buscar'}
          startAdornment={<IconSearch className="h-4 w-4" />}
          className="w-full sm:max-w-sm"
        />
      )}

      <div className="relative overflow-x-auto rounded-xl border border-surface-100 shadow-soft">
        {isRefetching && (
          <div className="absolute inset-x-0 top-0 z-10 h-0.5 overflow-hidden bg-surface-100" role="status" aria-label="Actualizando resultados">
            <div className="h-full w-1/3 animate-loading-bar rounded-full bg-brand-500" />
          </div>
        )}
        <table role="table" className={cn('w-full min-w-120 border-collapse text-left text-sm', isRefetching && 'opacity-60 transition-opacity duration-(--duration-base)')}>
          <thead>
            <tr className="border-b border-surface-100 bg-surface-100/50">
              {columns.map((column) => {
                const isSortable = Boolean(column.sortable && onSortChange)
                const ariaSort = getAriaSort(column, sortBy, sortDirection)

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={column.sortable ? ariaSort : undefined}
                    className={cn(
                      'whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-ink-500',
                      column.className,
                    )}
                  >
                    {isSortable ? (
                      <button
                        type="button"
                        onClick={() => onSortChange?.(column.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded text-xs font-semibold uppercase tracking-wide transition-colors duration-(--duration-fast)',
                          'hover:text-ink-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                          sortBy === column.id ? 'text-brand-600' : 'text-ink-500',
                        )}
                      >
                        {column.header}
                        <SortIndicator direction={ariaSort} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                <tr key={`skeleton-${rowIndex}`} className="border-b border-surface-100 last:border-b-0">
                  {columns.map((column) => (
                    <td key={column.id} className={cn('px-4 py-3', column.className)}>
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))}

            {!isLoading && isError && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-2">
                  <ErrorState description={getDisplayErrorMessage(error)} onRetry={onRetry} />
                </td>
              </tr>
            )}

            {!isLoading && !isError && isEmpty && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-2">
                  <EmptyState
                    title={emptyMessage ?? 'No hay registros para mostrar'}
                    description={
                      emptyDescription ?? (searchValue ? 'Prueba con otro término de búsqueda.' : undefined)
                    }
                  />
                </td>
              </tr>
            )}

            {!isLoading &&
              !isError &&
              data.map((row, rowIndex) => (
                <tr
                  key={getRowId(row)}
                  className={cn(
                    'border-b border-surface-100 transition-colors duration-(--duration-fast) last:border-b-0',
                    'hover:bg-surface-50',
                    rowIndex % 2 === 1 && 'bg-surface-0/60',
                  )}
                >
                  {columns.map((column) => (
                    <td key={column.id} className={cn('px-4 py-3 align-middle text-ink-900 tabular-nums', column.className)}>
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {!isLoading && !isError && !isEmpty && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-ink-500">
            {isCursor ? ' ' : `Mostrando ${rangeStart}-${rangeEnd} de ${props.total} registros`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={goPrev} disabled={isFirstPage}>
              Anterior
            </Button>
            {!isCursor && (
              <span className="px-1 text-xs tabular-nums text-ink-500">
                Página {props.page} de {totalPages}
              </span>
            )}
            {isCursor && props.currentPage && (
              <span className="px-1 text-xs tabular-nums text-ink-500">Página {props.currentPage}</span>
            )}
            <Button type="button" size="sm" variant="secondary" onClick={goNext} disabled={isLastPage}>
              Siguiente
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
