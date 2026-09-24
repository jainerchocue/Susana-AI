import { describe, expect, it } from 'vitest'
import { buildAssistantInsight, extractPrediction } from './insights'
import type { AssistantQueryResult } from '@/types'

// Cadenas reales capturadas del backend (susana-back.qaessential.dev), no inventadas.
const ANSWER_WITH_PREDICTION =
  'Según los datos de «admissions» (9 fila(s)): unit=GINECO OBSTRETICIA, count_all=1320 | unit=HOSPITALIZACION, count_all=3321. ' +
  'Predicción ML (ingresos / ocupación) con Random Forest (entrenado en 60 periodos de la serie HIS). ' +
  'Último valor observado: 121. Pronóstico próximos 3 periodos: 130, 129, 144. ' +
  'El modelo anticipa una alza de ~7% respecto al último punto (tendencia de fondo: estable). ' +
  'Error medio en holdout temporal (MAE): ~21.5 ingresos / ocupación — variables que más pesan: lag_7, lag_1, indice_t. ' +
  'Úselo para decidir turnos, camas y abastecimiento antes del pico; no sustituye el criterio clínico ni la validación del equipo. ' +
  'En el histórico, el día con más carga es el martes (promedio ~148).'

const ANSWER_WITHOUT_PREDICTION =
  'Según los datos de «medications» (20 fila(s)): code=NPV03AN0104, sum_quantity=94429 | code=N02BA001400, sum_quantity=64323. ' +
  'Para decidir ahora: Decisión sugerida: revisar abastecimiento de NPV03AN0104 (consumo/cantidad observada 94429).'

describe('extractPrediction', () => {
  it('parses every field from a real prediction block', () => {
    const prediction = extractPrediction(ANSWER_WITH_PREDICTION)
    expect(prediction).not.toBeNull()
    expect(prediction?.label).toBe('ingresos / ocupación')
    expect(prediction?.lastObserved).toBe(121)
    expect(prediction?.forecast).toEqual([130, 129, 144])
    expect(prediction?.trendDirection).toBe('alza')
    expect(prediction?.trendPct).toBe(7)
    expect(prediction?.backgroundTrend).toBe('estable')
    expect(prediction?.mae).toBe(21.5)
    expect(prediction?.topFeatures).toEqual(['lag_7', 'lag_1', 'indice_t'])
  })

  it('returns null when the answer has no prediction section', () => {
    expect(extractPrediction(ANSWER_WITHOUT_PREDICTION)).toBeNull()
  })
})

function makeResult(overrides: Partial<AssistantQueryResult>): AssistantQueryResult {
  return {
    query: { dataset: 'admissions', metrics: [{ agg: 'count' }] },
    columns: ['count_all'],
    rows: [{ count_all: 42 }],
    rowCount: 1,
    truncated: false,
    ...overrides,
  }
}

describe('buildAssistantInsight', () => {
  it('rounds a single-row result to an integer', () => {
    const insight = buildAssistantInsight(makeResult({ rows: [{ count_all: 42.7 }] }))
    expect(insight).toEqual({ label: 'Count all', value: 43, isTopOfMultiple: false })
  })

  it('highlights the top row when grouped by a non-date field', () => {
    const insight = buildAssistantInsight(
      makeResult({
        query: { dataset: 'admissions', metrics: [{ agg: 'count' }], groupBy: [{ field: 'unit' }] },
        columns: ['unit', 'count_all'],
        rows: [
          { unit: 'URGENCIAS', count_all: 7489 },
          { unit: 'PEDIATRIA', count_all: 2816 },
        ],
        rowCount: 2,
      }),
    )
    expect(insight?.value).toBe(7489)
    expect(insight?.isTopOfMultiple).toBe(true)
    expect(insight?.groupLabel).toBe('URGENCIAS')
  })

  it('computes a trend from the last two points of a date-grouped series', () => {
    const insight = buildAssistantInsight(
      makeResult({
        query: {
          dataset: 'admissions',
          metrics: [{ agg: 'count' }],
          groupBy: [{ field: 'admitted_at', grain: 'day' }],
        },
        columns: ['admitted_at', 'count_all'],
        rows: [
          { admitted_at: '2026-06-27', count_all: 100 },
          { admitted_at: '2026-06-28', count_all: 120 },
        ],
        rowCount: 2,
      }),
    )
    expect(insight?.value).toBe(120)
    expect(insight?.trend?.direction).toBe('up')
    expect(insight?.trend?.changePct).toBe(20)
  })

  it('returns null when there is no numeric column at all', () => {
    const insight = buildAssistantInsight(
      makeResult({ columns: ['unit'], rows: [{ unit: 'URGENCIAS' }], rowCount: 1 }),
    )
    expect(insight).toBeNull()
  })
})
