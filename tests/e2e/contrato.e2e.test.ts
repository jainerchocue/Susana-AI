import { beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';
import { env } from '../../src/config/env';
import { registroOpenApi, type RutaDocumentada } from '../../src/core/openapi/registry';
import { comoRol, type Sesion } from './cliente';

/**
 * Test de contrato E2E (TC6): por cada GET de `registry.ts` (salvo el tag
 * `assistant` y `GET /imports/{id}`, que depende del estado de un job en
 * curso) se hace una peticion HTTP real, con un usuario autorizado
 * (SUPER_ADMIN: su comodin cubre el permiso de cualquier tag, asi que un solo
 * usuario basta para las ~45 rutas), contra los datos REALES de
 * `hospital_e2e` (importados por el global-setup), y se valida que `data`
 * case exactamente con el esquema Zod de respuesta declarado en
 * `registry.ts`. Si alguna no valida, es un bug de esquema o de codigo: este
 * test esta para encontrarlo, no para tolerarlo (CLAUDE.md: "nunca debilites
 * una aserción existente para que un test pase").
 *
 * `text/csv` (exports y plantillas) no tiene sobre JSON que validar: se
 * excluye igual que hace `rutasSinResponseDocumentado` (openapi.ts/registry.ts).
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;

function esCandidata(ruta: RutaDocumentada): boolean {
  if (ruta.method !== 'get') return false;
  if (ruta.tag === 'assistant') return false;
  if (ruta.path === '/imports/{id}') return false;
  if (ruta.produces === 'text/csv') return false;
  return Boolean(ruta.response);
}

/** `{id}`/`{code}`/`{type}` al final de la ruta -> el nombre del parametro. */
function nombreParametro(ruta: string): string | null {
  const m = /\{(\w+)\}$/.exec(ruta);
  return m ? m[1]! : null;
}

/** Quita el ultimo segmento `{param}`: la ruta de LISTADO de la que sacar un id/code/type real. */
function rutaDeListado(ruta: string): string {
  return ruta.replace(/\/\{\w+\}$/, '');
}

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

const CANDIDATAS = registroOpenApi.filter(esCandidata);

describe('Contrato E2E: cada GET de registry.ts valida contra su esquema Zod de respuesta (TC6)', () => {
  let sesion: Sesion;

  beforeAll(async () => {
    // Un unico usuario SUPER_ADMIN (comodin) para las ~45 rutas: cualquier
    // tag que exija cualquier permiso lo tiene, asi que "autorizado" no
    // depende del tag de cada ruta.
    sesion = await comoRol(BASE, 'SUPER_ADMIN');
  }, 30_000);

  it(`hay al menos una ruta GET candidata (de ${registroOpenApi.filter((r) => r.method === 'get').length} GET totales en registry.ts)`, () => {
    expect(CANDIDATAS.length).toBeGreaterThan(0);
  });

  for (const ruta of CANDIDATAS) {
    it(`GET ${ruta.path || '/'} -> 200 y data valida contra su esquema`, async () => {
      const parametro = nombreParametro(ruta.path);
      let rutaFinal = ruta.path;

      if (parametro) {
        // Los 5 tipos de regla son fijos (ALERT_TYPES, sembrados siempre por
        // TC0): no hace falta listar antes para saber uno valido.
        if (ruta.path === '/alerts/rules/{type}') {
          rutaFinal = '/alerts/rules/LOW_STOCK';
        } else {
          const listado = await sesion.get(`${PREFIJO}${rutaDeListado(ruta.path)}`);
          expect(listado.status, `listado previo a ${ruta.path}`).toBe(200);
          const datos = comoRegistro(listado.body).data;
          const items = Array.isArray(datos) ? datos : [];
          if (items.length === 0) {
            // Sin filas reales para probar el detalle ahora mismo (p.ej. cero
            // alertas abiertas): no hay id/code que pedir. El listado en si
            // ya se valido en su propia iteracion de este mismo bucle.
            return;
          }
          const primero = comoRegistro(items[0]);
          rutaFinal = ruta.path.replace(`{${parametro}}`, String(primero[parametro]));
        }
      }

      const res = await sesion.get(`${PREFIJO}${rutaFinal}`);
      expect(res.status, `GET ${rutaFinal} -> ${res.status}: ${JSON.stringify(res.body)}`).toBe(200);

      const cuerpo = comoRegistro(res.body);
      expect(cuerpo.success).toBe(true);

      const esquema = ruta.paginated ? z.array(ruta.response!) : ruta.response!;
      const analisis = esquema.safeParse(cuerpo.data);
      if (!analisis.success) {
        throw new Error(
          `La respuesta de GET ${rutaFinal} no valida contra su esquema declarado en registry.ts:\n` +
            `${JSON.stringify(analisis.error.format(), null, 2)}\ndata recibida: ${JSON.stringify(cuerpo.data)}`,
        );
      }
    });
  }
});
