import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AssistantAnswer } from '@/types'
import { AssistantVisual } from './AssistantVisual'

beforeAll(() => {
  // jsdom no trae ResizeObserver (lo usa ResponsiveContainer de recharts).
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

const barras: AssistantAnswer = {
  status: 'ok',
  answer: 'Urgencias es la unidad con más ingresos.',
  queries: [
    {
      query: { dataset: 'admissions' },
      columns: ['unit', 'count_all'],
      rows: [
        { unit: 'PEDIATRIA', count_all: 409 },
        { unit: 'URGENCIAS', count_all: 1169 },
      ],
      rowCount: 2,
      truncated: false,
    },
  ],
  visual: {
    type: 'bar',
    title: 'Ingresos hospitalarios por unidad',
    subtitle: 'este mes',
    queryIndex: 0,
    x: 'unit',
    xLabel: 'Unidad',
    columns: [{ key: 'count_all', label: 'Ingresos', decimals: 0 }],
    valueLabels: { URGENCIAS: 'Urgencias', PEDIATRIA: 'Pediatría' },
  },
}

describe('AssistantVisual', () => {
  it('sin especificación visual no pinta nada', () => {
    const { container } = render(<AssistantVisual answer={{ ...barras, visual: null }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('muestra título, subtítulo y permite pasar de gráfica a tabla ordenable', async () => {
    const user = userEvent.setup()
    render(<AssistantVisual answer={barras} />)
    expect(screen.getByRole('region', { name: 'Ingresos hospitalarios por unidad' })).toBeInTheDocument()
    expect(screen.getByText('este mes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Tabla' }))
    const tabla = screen.getByRole('table')
    let filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas.map((f) => f.textContent)).toEqual(['Pediatría409', 'Urgencias1.169'])

    await user.click(screen.getByRole('button', { name: 'Ordenar por Ingresos' }))
    filas = within(tabla).getAllByRole('row').slice(1)
    expect(filas.map((f) => f.textContent)).toEqual(['Urgencias1.169', 'Pediatría409'])
  })

  it('kpi: cifras con su etiqueta y unidad', () => {
    render(
      <AssistantVisual
        answer={{
          status: 'ok',
          answer: 'x',
          queries: [{ query: { dataset: 'bed_occupancy' }, columns: ['sum_census', 'avg_occupancy_pct'], rows: [{ sum_census: 29, avg_occupancy_pct: 78.38 }], rowCount: 1, truncated: false }],
          visual: {
            type: 'kpi',
            title: 'Ocupación de camas',
            queryIndex: 0,
            columns: [
              { key: 'sum_census', label: 'Camas ocupadas', decimals: 0 },
              { key: 'avg_occupancy_pct', label: 'Ocupación', unit: '%', decimals: 2 },
            ],
          },
        }}
      />,
    )
    expect(screen.getByText('Camas ocupadas')).toBeInTheDocument()
    expect(screen.getByText('Ocupación')).toBeInTheDocument()
    expect(screen.getByText('%')).toBeInTheDocument()
  })
})
