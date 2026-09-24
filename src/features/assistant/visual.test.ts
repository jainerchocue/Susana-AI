import { describe, expect, it } from 'vitest'
import type { AssistantAnswer, AssistantQueryResult, AssistantVisual } from '@/types'
import { formatVisualValue, prepareVisual } from './visual'

function answer(visual: AssistantVisual | null, result: Partial<AssistantQueryResult>): AssistantAnswer {
  const rows = result.rows ?? []
  return {
    status: 'ok',
    answer: 'texto',
    queries: [{ query: { dataset: 'admissions' }, columns: result.columns ?? Object.keys(rows[0] ?? {}), rows, rowCount: rows.length, truncated: false }],
    visual,
  }
}

describe('prepareVisual', () => {
  it('sin visual o sin filas no dibuja nada', () => {
    expect(prepareVisual(answer(null, { rows: [{ count_all: 1 }] }))).toBeNull()
    expect(
      prepareVisual(answer({ type: 'kpi', title: 'X', queryIndex: 0, columns: [{ key: 'count_all', label: 'Ingresos' }] }, { rows: [], columns: ['count_all'] })),
    ).toBeNull()
  })

  it('kpi: toma el valor de las filas ejecutadas', () => {
    const p = prepareVisual(
      answer(
        { type: 'kpi', title: 'Espera', queryIndex: 0, columns: [{ key: 'avg_wait_minutes', label: 'Espera promedio', unit: 'min', decimals: 1 }] },
        { rows: [{ avg_wait_minutes: 57.3392 }] },
      ),
    )
    expect(p?.points[0].values).toEqual({ avg_wait_minutes: 57.3392 })
    expect(p?.table.rows[0][0].text).toBe('57,3 min')
  })

  it('bar: etiquetas legibles y orden del backend', () => {
    const p = prepareVisual(
      answer(
        {
          type: 'bar',
          title: 'Ingresos por unidad',
          queryIndex: 0,
          x: 'unit',
          xLabel: 'Unidad',
          columns: [{ key: 'count_all', label: 'Ingresos', decimals: 0 }],
          valueLabels: { URGENCIAS: 'Urgencias' },
        },
        { rows: [{ unit: 'URGENCIAS', count_all: 1169 }, { unit: 'PEDIATRIA', count_all: 409 }, { unit: null, count_all: 3 }] },
      ),
    )
    expect(p?.points.map((pt) => pt.label)).toEqual(['Urgencias', 'PEDIATRIA', 'Sin dato'])
    expect(p?.table.headers).toEqual(['Unidad', 'Ingresos'])
    expect(p?.table.rows[0].map((c) => c.text)).toEqual(['Urgencias', '1.169'])
  })

  it('una columna que no está en el resultado se ignora; si no queda ninguna, no se dibuja', () => {
    const spec: AssistantVisual = {
      type: 'bar',
      title: 'T',
      queryIndex: 0,
      x: 'unit',
      columns: [{ key: 'inventada', label: 'X' }, { key: 'count_all', label: 'Ingresos' }],
    }
    expect(prepareVisual(answer(spec, { rows: [{ unit: 'A', count_all: 1 }] }))?.columns.map((c) => c.key)).toEqual(['count_all'])
    expect(prepareVisual(answer({ ...spec, columns: [{ key: 'inventada', label: 'X' }] }, { rows: [{ unit: 'A', count_all: 1 }] }))).toBeNull()
    expect(prepareVisual(answer({ ...spec, x: 'otra' }, { rows: [{ unit: 'A', count_all: 1 }] }))).toBeNull()
  })

  it('line: ordena por fecha, rellena días sin filas con 0 y omite el día de corte', () => {
    const p = prepareVisual(
      answer(
        {
          type: 'line',
          title: 'Ingresos',
          queryIndex: 0,
          x: 'admitted_at',
          grain: 'day',
          fillMissing: true,
          omit: ['2026-09-21T00:00:00.000Z'],
          columns: [{ key: 'count_all', label: 'Ingresos', decimals: 0 }],
        },
        {
          rows: [
            { admitted_at: '2026-09-21T00:00:00.000Z', count_all: 75 },
            { admitted_at: '2026-09-20T00:00:00.000Z', count_all: 92 },
            { admitted_at: '2026-09-18T00:00:00.000Z', count_all: 150 },
          ],
        },
      ),
    )
    expect(p?.points.map((pt) => [pt.id, pt.values.count_all])).toEqual([
      ['2026-09-18', 150],
      ['2026-09-19', 0],
      ['2026-09-20', 92],
    ])
  })

  it('line con proyección: la línea proyectada arranca en el último dato real y va rotulada aparte', () => {
    const p = prepareVisual(
      answer(
        {
          type: 'line',
          title: 'Proyección',
          queryIndex: 0,
          x: 'admitted_at',
          grain: 'day',
          columns: [{ key: 'count_all', label: 'Ingresos', decimals: 0 }],
          projection: { label: 'Proyección', points: [{ x: '2026-09-22', y: 132.4 }, { x: '2026-09-23', y: 137 }] },
        },
        { rows: [{ admitted_at: '2026-09-19T00:00:00.000Z', count_all: 108 }, { admitted_at: '2026-09-20T00:00:00.000Z', count_all: 92 }] },
      ),
    )
    const pts = p!.points
    expect(pts.map((pt) => pt.id)).toEqual(['2026-09-19', '2026-09-20', '2026-09-22', '2026-09-23'])
    expect(pts[1].projection).toBe(92) // une ambas líneas
    expect(pts[2].values.count_all).toBeNull() // la proyección nunca se pinta como dato real
    expect(pts[2].projection).toBe(132.4)
    expect(p!.table.headers).toEqual(['', 'Ingresos', 'Proyección'])
    expect(p!.table.rows[2].map((c) => c.text)).toEqual(['22 sep', '—', '132'])
  })

  it('table: dimensiones traducidas, números con su unidad', () => {
    const p = prepareVisual(
      answer(
        {
          type: 'table',
          title: 'Inventario',
          queryIndex: 0,
          columns: [
            { key: 'name', label: 'Nombre' },
            { key: 'risk', label: 'Riesgo' },
            { key: 'min_days_of_inventory', label: 'Días de inventario', unit: 'días', decimals: 2 },
          ],
          valueLabels: { CRITICAL: 'crítico' },
        },
        { rows: [{ name: 'ACETAMINOFEN 500 mg TABLETA', risk: 'CRITICAL', min_days_of_inventory: 0.02 }] },
      ),
    )
    expect(p?.table.headers).toEqual(['Nombre', 'Riesgo', 'Días de inventario (días)'])
    expect(p?.table.rows[0].map((c) => c.text)).toEqual(['ACETAMINOFEN 500 mg TABLETA', 'crítico', '0,02 días'])
  })
})

describe('formatVisualValue', () => {
  it('formatea con decimales y unidad', () => {
    expect(formatVisualValue(78.38, { key: 'x', label: 'x', unit: '%', decimals: 2 })).toBe('78,38 %')
    expect(formatVisualValue(null)).toBe('—')
  })
})
