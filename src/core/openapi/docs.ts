import { env } from '../../config/env';
import { BRAND } from '../../config/constants';

/**
 * Pagina `GET {API_PREFIX}/docs`: Scalar (HTML) sobre `openapi.json`.
 *
 * Version FIJADA de la libreria (cargada desde jsDelivr, en el navegador: no
 * es una dependencia npm). Un `@latest` cambiaria de contenido sin aviso, el
 * mismo riesgo que CLAUDE.md señala para cualquier script de terceros.
 * Comprobado que existe en jsDelivr antes de fijarla.
 */
const SCALAR_VERSION = '1.72.0';

/**
 * SRI (Subresource Integrity) del archivo exacto de `SCALAR_VERSION`:
 * `openssl dgst -sha384 -binary standalone.js | openssl base64 -A` sobre el
 * archivo descargado de jsDelivr. Sin esto, un CDN comprometido podria servir
 * JS distinto bajo la misma URL y el navegador lo ejecutaria igual; con
 * `integrity`, lo rechaza si el hash no coincide. Cambia SOLO si se sube
 * `SCALAR_VERSION` (recalcular con el comando de arriba contra el archivo nuevo).
 */
const SCALAR_INTEGRITY = 'sha384-OPr81V05YKGVtMFR7bgn6teWINJ+Qb5LIgvuAi2xv2C/5Y1/PcjZ0DrvpMdP39ix';

/**
 * CSP propia de esta UNICA ruta: el resto de la API mantiene la politica mas
 * restrictiva de `app.ts` (`default-src 'none'`), pensada para una API JSON
 * que nunca ejecuta scripts. Esta pagina si lo hace (el bundle de Scalar), asi
 * que necesita su propio permiso, acotado a `cdn.jsdelivr.net`.
 *
 * `connect-src 'self'` es lo que permite que Scalar cargue `openapi.json` con
 * `fetch` desde el propio origen (el atributo `data-url` del script, ver
 * `paginaDocs`). `style-src` lleva `'unsafe-inline'` porque Scalar inyecta
 * estilos en tiempo de ejecucion; no hay script inline (ver `paginaDocs`), asi
 * que `script-src` NO lo necesita.
 */
export const CSP_DOCS =
  "default-src 'none'; " +
  "script-src 'self' https://cdn.jsdelivr.net; " +
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; " +
  "img-src 'self' data: https://cdn.jsdelivr.net; " +
  "font-src https://cdn.jsdelivr.net; " +
  "connect-src 'self'";

/**
 * `data-url` relativo (no absoluto con `API_URL`): la pagina funciona detras
 * de cualquier host/puerto (incluido el servidor de pruebas E2E en un puerto
 * libre cualquiera) sin codificar la URL publica en el HTML.
 */
export function paginaDocs(): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>${BRAND.name} · API</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body>
    <script id="api-reference" data-url="${env.API_PREFIX}/openapi.json"></script>
    <script
      src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_VERSION}/dist/browser/standalone.js"
      integrity="${SCALAR_INTEGRITY}"
      crossorigin="anonymous"
    ></script>
  </body>
</html>`;
}
