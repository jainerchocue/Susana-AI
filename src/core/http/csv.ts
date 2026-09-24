import type { Response } from 'express';

/**
 * Exportacion CSV: la UNICA excepcion documentada al contrato JSON de
 * `api-response.ts` (CLAUDE.md §3). Es un adjunto para descargar, no una
 * respuesta `{ success, data, meta }`.
 *
 * `noStore` (core/middleware/security.ts) NO se llama desde aqui: esta
 * funcion solo recibe `res`, no `req`, y ese middleware es un `RequestHandler`
 * que los necesita los dos. La cabecera de cache la pone la RUTA que exporta,
 * poniendo `noStore` en su cadena de middlewares (igual que `authenticate` o
 * `validate`), no esta funcion.
 */

/**
 * Inyeccion de formulas en CSV (CWE-1236): Excel/Sheets evaluan como formula
 * una celda que empieza por = + - @, tabulador o retorno de carro. Un dato de
 * usuario con ese prefijo, abierto por alguien de confianza, ejecuta lo que
 * el atacante quiso escribir. Prefijar con un apostrofe la deja como texto.
 */
const PRIMER_CARACTER_PELIGROSO = /^[=+\-@\t\r]/;

/**
 * `String(valor)` sobre un `unknown` puede caer en el `[object Object]` por
 * defecto si a un servicio se le escapa un objeto sin `toString` propio: se
 * distingue tipo a tipo en vez de confiar en la coercion generica.
 */
function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
  if (valor instanceof Date) return valor.toISOString();
  return JSON.stringify(valor);
}

function aCelda(valor: unknown): string {
  const texto = aTexto(valor);
  const segura = PRIMER_CARACTER_PELIGROSO.test(texto) ? `'${texto}` : texto;
  // RFC 4180: comillas dobles escapadas duplicandolas. Se cita SIEMPRE la
  // celda (no solo las que llevan coma o salto de linea): mas simple y sin
  // casos especiales que se puedan olvidar.
  return `"${segura.replace(/"/g, '""')}"`;
}

function aFilaCsv(valores: string[]): string {
  return valores.join(',');
}

/**
 * Dificil confundirlo con un valor legitimo: solo minusculas, digitos y
 * guion. Evita que un nombre con `"`, `;` o CRLF manipule la cabecera
 * `Content-Disposition` (inyeccion de cabecera / path traversal en la
 * descarga).
 */
function sanearNombreArchivo(nombre: string): string {
  const limpio = nombre.toLowerCase().replace(/[^a-z0-9-]/g, '');
  return limpio.length > 0 ? limpio : 'export';
}

/** Envia `filas` como CSV adjunto, en el orden de `columnas`. */
export function enviarCsv(
  res: Response,
  nombreArchivo: string,
  columnas: string[],
  filas: Record<string, unknown>[],
): Response {
  const encabezado = aFilaCsv(columnas.map((columna) => aCelda(columna)));
  const cuerpo = filas.map((fila) => aFilaCsv(columnas.map((columna) => aCelda(fila[columna]))));
  const csv = [encabezado, ...cuerpo].join('\r\n') + '\r\n';

  const archivo = sanearNombreArchivo(nombreArchivo);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${archivo}.csv"`);
  return res.status(200).send(csv);
}
