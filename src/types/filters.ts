/**
 * Rango de fechas global (único filtro que de verdad aceptan los endpoints:
 * dashboard/*, analytics/* y medications aceptan desde/hasta). Filtros de
 * dominio (severidad de alerta, kind de medicamento, etc.) viven como estado
 * local de cada página, no aquí.
 */
export interface GlobalFilters {
  from: string | null
  to: string | null
}
