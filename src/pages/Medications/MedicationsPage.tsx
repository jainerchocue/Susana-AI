import { useState } from 'react'
import { DataTable, type DataTableColumn } from '@/components/tables'
import { Badge, Button, Input, PageHeader, type BadgeTone } from '@/components/ui'
import { useAuthStore } from '@/app/store/authStore'
import { useCriticalMedications, useMedications } from '@/features/medications/hooks/useMedications'
import { PERMISSIONS } from '@/constants'
import type { Medication, MedicationRisk } from '@/types'
import { formatDate, formatNumber } from '@/utils/format'

const RISK_META: Record<string, { tone: BadgeTone; label: string }> = {
  CRITICAL: { tone: 'critical', label: 'Crítico' },
  HIGH: { tone: 'critical', label: 'Alto' },
  MEDIUM: { tone: 'high', label: 'Medio' },
  LOW: { tone: 'good', label: 'Bajo' },
  insufficient_data: { tone: 'neutral', label: 'Sin datos' },
}

/** Nunca dejes un valor de enum inesperado del backend romper la fila — si no lo reconocemos, lo mostramos tal cual. */
function riskMeta(risk: MedicationRisk): { tone: BadgeTone; label: string } {
  return RISK_META[risk] ?? { tone: 'neutral', label: risk }
}

function StockEditor({
  medication,
  onSave,
  isSaving,
}: {
  medication: Medication
  onSave: (quantity: number) => void
  isSaving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(String(medication.stock ?? 0))

  if (!editing) {
    return (
      <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
        Editar stock
      </Button>
    )
  }

  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        const quantity = Number(value)
        if (Number.isFinite(quantity) && quantity >= 0) {
          onSave(quantity)
          setEditing(false)
        }
      }}
    >
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="h-8 w-24"
        aria-label={`Nuevo stock para ${medication.name}`}
      />
      <Button type="submit" size="sm" isLoading={isSaving}>
        Guardar
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancelar
      </Button>
    </form>
  )
}

export default function MedicationsPage() {
  const { medications, pagination, isLoading, isError, error, refetch, page, limit, search, setSearch, setPage, updateStock, updatingCode } =
    useMedications()
  const { count: criticalCount, hasInsufficientData, isLoading: isCriticalLoading } = useCriticalMedications()
  const canManageStock = useAuthStore((state) => state.hasPermission(PERMISSIONS.MEDICATIONS_MANAGE))

  const showCriticalBadge = !isCriticalLoading && !hasInsufficientData && criticalCount > 0

  const columns: DataTableColumn<Medication>[] = [
    {
      id: 'name',
      header: 'Medicamento',
      cell: (row) => (
        <div>
          <p className="font-medium text-ink-950">{row.name}</p>
          <p className="text-xs text-ink-500">{row.code}</p>
        </div>
      ),
    },
    {
      id: 'stock',
      header: 'Stock',
      cell: (row) => (row.stock === null ? 'Sin registro' : formatNumber(row.stock)),
    },
    {
      id: 'daysOfInventory',
      header: 'Días de inventario',
      cell: (row) =>
        row.daysOfInventory === 'insufficient_data' ? (
          <span className="text-ink-300">Sin datos</span>
        ) : (
          <span>{formatNumber(row.daysOfInventory, 1)} días</span>
        ),
    },
    {
      id: 'risk',
      header: 'Riesgo',
      cell: (row) => {
        const meta = riskMeta(row.risk)
        return <Badge tone={meta.tone}>{meta.label}</Badge>
      },
    },
    {
      id: 'lastDispensedAt',
      header: 'Último despacho',
      cell: (row) => (row.lastDispensedAt ? formatDate(row.lastDispensedAt) : 'Sin registro'),
    },
    ...(canManageStock
      ? [
          {
            id: 'actions',
            header: 'Acciones',
            cell: (row: Medication) => (
              <StockEditor
                medication={row}
                onSave={(quantity) => updateStock(row.code, quantity)}
                isSaving={updatingCode === row.code}
              />
            ),
          } satisfies DataTableColumn<Medication>,
        ]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Medicamentos"
        description="Hospital Susana López de Valencia — control de farmacia e inventario crítico."
        actions={showCriticalBadge ? <Badge tone="critical">{criticalCount} en nivel crítico</Badge> : undefined}
      />

      {hasInsufficientData && !isCriticalLoading && (
        <p className="text-xs text-ink-500">
          Aún no hay stock registrado para ningún medicamento — el riesgo y los días de inventario se calculan en
          cuanto se registre el primer stock.
        </p>
      )}

      <DataTable
        columns={columns}
        data={medications}
        getRowId={(row) => row.code}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={refetch}
        emptyMessage="No hay medicamentos que coincidan con la búsqueda actual."
        page={page}
        pageSize={limit}
        total={pagination?.total ?? 0}
        onPageChange={setPage}
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Buscar medicamento..."
      />
    </div>
  )
}
