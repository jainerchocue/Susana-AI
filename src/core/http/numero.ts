/**
 * Redondeo de estadisticas decimales que salen por la API (medias,
 * percentiles, porcentajes, dias de inventario...). Dos motivos, no solo
 * cosmetica:
 *
 *  1. Postgres puede paralelizar `AVG`/`SUM` sobre `float8`: el orden en que
 *     los workers combinan sumas parciales no esta garantizado, asi que el
 *     mismo `SELECT` puede devolver un digito distinto en la cola del
 *     decimal entre una ejecucion y otra (verificado: JSON y CSV de
 *     `/analytics/triage`, pedidos en la MISMA peticion HTTP, difiriendo en
 *     el decimal 14 de un `avg`). Un cliente no deberia ver ese ruido, y un
 *     test que compara dos llamadas independientes tampoco.
 *  2. Consistencia: toda cifra decimal de la API se redondea IGUAL (2
 *     decimales), en vez de que cada endpoint eligiera su propia precision.
 *
 * Se aplica en la SALIDA de la API unicamente: nunca a lo que se guarda en
 * `his_admissions`/`his_surgery_schedules` (los derivados persistidos), que
 * siguen con la precision completa de la BD.
 */
export function redondearDecimales(valor: number, decimales = 2): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}
