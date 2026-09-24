import { logger } from '../../core/logger';
import type { ResultadoConsulta } from './assistant.query';
import { visualSchema, type QuerySpec, type Visual } from './assistant.schemas';

/**
 * Valida la tabla/grafica que sugiere el agente contra lo que Node EJECUTO de
 * verdad: el indice de consulta debe existir y cada columna citada debe estar
 * en ese resultado. Asi la UI nunca dibuja una columna que Node no devolvio.
 *
 * Una especificacion invalida no es motivo para fallar la respuesta: el texto
 * sigue siendo valido. Se descarta (null) y se registra, sin loguear su
 * contenido (es texto de un tercero).
 */
export function validarVisual(
  visual: unknown,
  queries: Array<{ query: QuerySpec } & ResultadoConsulta>,
): Visual | null {
  if (visual === undefined || visual === null) return null;

  const parseado = visualSchema.safeParse(visual);
  if (!parseado.success) {
    logger.warn({ issues: parseado.error.issues.length }, 'Visual del asistente descartado: forma invalida');
    return null;
  }
  const v = parseado.data;
  const motivo = motivoRechazo(v, queries[v.queryIndex]);
  if (motivo) {
    logger.warn({ motivo }, 'Visual del asistente descartado');
    return null;
  }
  return v;
}

/** Por que una especificacion bien formada no casa con lo ejecutado, o null si casa. */
function motivoRechazo(v: Visual, resultado: ResultadoConsulta | undefined): string | null {
  if (!resultado) return 'queryIndex sin consulta ejecutada';
  const columnas = new Set(resultado.columns);
  if ((v.type === 'bar' || v.type === 'line') && !v.x) return 'bar/line sin eje x';
  if (v.x !== undefined && !columnas.has(v.x)) return 'eje x fuera del resultado';
  if (v.columns.some((c) => !columnas.has(c.key))) return 'columna fuera del resultado';
  if (v.projection && v.type !== 'line') return 'proyeccion fuera de una linea';
  return null;
}
