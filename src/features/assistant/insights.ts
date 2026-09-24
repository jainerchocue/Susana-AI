import type { AssistantQueryResult } from '@/types'

export type PredictionTrend = 'alza' | 'baja'

export interface AssistantPrediction {
  /** Lo que el backend dice estar prediciendo, p. ej. "ingresos / ocupación". */
  label: string
  lastObserved: number | null
  /** Valores enteros de los próximos períodos, en el orden que devolvió el backend. */
  forecast: number[]
  trendDirection: PredictionTrend | null
  trendPct: number | null
  /** "estable", "creciente", etc. — texto libre del backend, se muestra tal cual. */
  backgroundTrend: string | null
  mae: number | null
  topFeatures: string[]
}

/**
 * El backend ya calcula una predicción real (Random Forest) pero la entrega mezclada
 * en un párrafo de texto libre, con un formato consistente ("Predicción ML (...)
 * con Random Forest... Último valor observado: N. Pronóstico próximos 3 periodos:
 * A, B, C..."). Se extrae con regexes independientes por campo — si el backend
 * cambia una frase puntual, los demás campos se siguen leyendo en vez de perder
 * todo el bloque. Devuelve null cuando la respuesta no incluye una predicción.
 */
export function extractPrediction(answer: string): AssistantPrediction | null {
  const labelMatch = answer.match(/Predicción ML\s*\(([^)]+)\)/i)
  if (!labelMatch) return null

  const lastObservedMatch = answer.match(/Último valor observado:\s*~?(-?\d+(?:[.,]\d+)?)/i)
  const forecastMatch = answer.match(/Pronóstico próximos \d+ period[oa]s?:\s*([\d.,\s]+?)\./i)
  const trendMatch = answer.match(/anticipa una (alza|baja)[^~%\d]*~?(-?\d+(?:[.,]\d+)?)\s*%/i)
  const backgroundTrendMatch = answer.match(/tendencia de fondo:\s*([^)]+)\)/i)
  const maeMatch = answer.match(/\(MAE\)[:\s]*~?(-?\d+(?:[.,]\d+)?)/i)
  const featuresMatch = answer.match(/variables que más pesan:\s*([^.]+)\./i)

  const toNumber = (raw: string) => Number(raw.replace(',', '.'))

  return {
    label: labelMatch[1].trim(),
    lastObserved: lastObservedMatch ? Math.round(toNumber(lastObservedMatch[1])) : null,
    forecast: forecastMatch
      ? forecastMatch[1]
          .split(',')
          .map((part) => Math.round(toNumber(part.trim())))
          .filter((value) => Number.isFinite(value))
      : [],
    trendDirection: trendMatch ? (trendMatch[1].toLowerCase() as PredictionTrend) : null,
    trendPct: trendMatch ? toNumber(trendMatch[2]) : null,
    backgroundTrend: backgroundTrendMatch ? backgroundTrendMatch[1].trim() : null,
    mae: maeMatch ? toNumber(maeMatch[1]) : null,
    topFeatures: featuresMatch
      ? featuresMatch[1]
          .split(',')
          .map((feature) => feature.trim())
          .filter(Boolean)
      : [],
  }
}

export type TrendDirection = 'up' | 'down' | 'flat'

export interface AssistantInsight {
  /** Nombre de la columna que aporta el número principal — literalmente el que devolvió el backend. */
  label: string
  /** Valor entero — nunca se muestran decimales en la cifra destacada. */
  value: number
  /** Solo presente cuando los datos están agrupados por fecha (serie temporal). */
  trend?: { direction: TrendDirection; changePct: number | null }
  /** Cuando hay más de una fila sin agrupar por fecha, el valor destacado es el máximo — esto lo aclara. */
  isTopOfMultiple: boolean
  /** Etiqueta del grupo al que pertenece el valor destacado (p. ej. el nombre de la unidad ganadora). */
  groupLabel?: string
}

function isNumericValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/** Primera columna cuyo valor es numérico en al menos una fila — evita confundir una dimensión (texto/fecha) con una métrica. */
function findNumericColumn(result: AssistantQueryResult): string | null {
  for (const column of result.columns) {
    if (result.rows.some((row) => isNumericValue(row[column]))) return column
  }
  return null
}

function humanizeColumn(column: string): string {
  return column
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (char) => char.toUpperCase())
}

/**
 * Interpreta el resultado de una consulta del asistente en un solo número concreto
 * y, cuando los datos lo permiten, una tendencia — sin inventar nada que el backend
 * no haya devuelto. Devuelve null cuando no hay una fila o columna numérica clara
 * (p. ej. resultados puramente de texto), y en ese caso la UI se queda con la
 * respuesta en lenguaje natural tal cual.
 */
export function buildAssistantInsight(result: AssistantQueryResult): AssistantInsight | null {
  if (result.rows.length === 0) return null

  const numericColumn = findNumericColumn(result)
  if (!numericColumn) return null

  const label = humanizeColumn(numericColumn)

  if (result.rows.length === 1) {
    const value = Number(result.rows[0][numericColumn])
    return { label, value: Math.round(value), isTopOfMultiple: false }
  }

  const dateGroup = result.query.groupBy?.find((group) => group.grain)
  if (dateGroup) {
    const rows = [...result.rows].filter((row) => isNumericValue(row[numericColumn]))
    if (rows.length === 0) return null
    // El backend ya ordena por la dimensión de agrupación al generar la serie; se toma tal cual llega.
    const last = Number(rows[rows.length - 1][numericColumn])
    const previous = rows.length > 1 ? Number(rows[rows.length - 2][numericColumn]) : null
    let trend: AssistantInsight['trend']
    if (previous !== null) {
      const changePct = previous !== 0 ? ((last - previous) / Math.abs(previous)) * 100 : null
      const direction: TrendDirection = last === previous ? 'flat' : last > previous ? 'up' : 'down'
      trend = { direction, changePct }
    }
    return { label, value: Math.round(last), trend, isTopOfMultiple: false }
  }

  // Sin agrupación por fecha: se destaca la fila con el valor más alto (p. ej. "la unidad con más ocupación").
  const top = [...result.rows].sort((a, b) => Number(b[numericColumn] ?? 0) - Number(a[numericColumn] ?? 0))[0]
  const groupField = result.query.groupBy?.[0]?.field
  const groupLabel = groupField && top[groupField] !== undefined ? String(top[groupField]) : undefined

  return {
    label,
    value: Math.round(Number(top[numericColumn])),
    isTopOfMultiple: true,
    groupLabel,
  }
}
