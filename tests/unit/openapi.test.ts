import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Router } from 'express';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aJsonSchema } from '../../src/core/openapi/openapi';
import { registroOpenApi, rutasSinResponseDocumentado } from '../../src/core/openapi/registry';

/**
 * Unitarios del conversor Zod -> JSON Schema (TC0): los constructores que de
 * verdad usa el proyecto en sus schemas de respuesta (uniones de tipos
 * mixtos, nullable, records, fechas, literales, enteros y objetos `.strict()`).
 * Sin BD: si algo aqui falla, `openapi.json` se generaria roto antes de que
 * nadie lo notara en un test de integracion.
 */
describe('aJsonSchema: conversion Zod -> JSON Schema', () => {
  it('union de tipos mixtos (number | "insufficient_data") -> anyOf', () => {
    const esquema = z.union([z.number(), z.literal('insufficient_data')]);
    const salida = aJsonSchema(esquema) as { anyOf: Array<Record<string, unknown>> };
    expect(salida.anyOf).toHaveLength(2);
    expect(salida.anyOf[0]).toEqual({ type: 'number' });
    expect(salida.anyOf[1]).toEqual({ const: 'insufficient_data' });
  });

  it('nullable sobre un tipo simple: `null` se añade al `type`', () => {
    const salida = aJsonSchema(z.string().nullable()) as { type: string[] };
    expect(salida.type).toEqual(['string', 'null']);
  });

  it('nullable sobre un tipo SIN `type` simple (literal): envuelve con anyOf', () => {
    const salida = aJsonSchema(z.literal('x').nullable()) as { anyOf: Array<Record<string, unknown>> };
    expect(salida.anyOf).toEqual([{ const: 'x' }, { type: 'null' }]);
  });

  it('records: additionalProperties refleja el tipo del VALOR, no un booleano ciego', () => {
    const salida = aJsonSchema(z.record(z.number())) as {
      type: string;
      additionalProperties: Record<string, unknown>;
    };
    expect(salida.type).toBe('object');
    expect(salida.additionalProperties).toEqual({ type: 'number' });
  });

  it('z.string().datetime({offset:true}) -> string con format date-time', () => {
    const salida = aJsonSchema(z.string().datetime({ offset: true })) as { type: string; format: string };
    expect(salida).toEqual({ type: 'string', format: 'date-time' });
  });

  it('z.date() -> string con format date-time', () => {
    expect(aJsonSchema(z.date())).toEqual({ type: 'string', format: 'date-time' });
  });

  it('literales -> const', () => {
    expect(aJsonSchema(z.literal('ok'))).toEqual({ const: 'ok' });
  });

  it('z.number().int() con limites -> type integer + minimum/maximum', () => {
    const salida = aJsonSchema(z.number().int().min(1).max(5));
    expect(salida).toEqual({ type: 'integer', minimum: 1, maximum: 5 });
  });

  it('z.number() sin .int() -> type number', () => {
    expect(aJsonSchema(z.number())).toEqual({ type: 'number' });
  });

  it('objeto .strict(): additionalProperties false; sin .strict(): undefined', () => {
    const estricto = aJsonSchema(z.object({ a: z.string() }).strict()) as Record<string, unknown>;
    const laxo = aJsonSchema(z.object({ a: z.string() })) as Record<string, unknown>;
    expect(estricto.additionalProperties).toBe(false);
    expect(laxo.additionalProperties).toBeUndefined();
  });

  it('campos opcionales no entran en `required`', () => {
    const salida = aJsonSchema(z.object({ a: z.string(), b: z.string().optional() })) as { required: string[] };
    expect(salida.required).toEqual(['a']);
  });
});

describe('rutasSinResponseDocumentado (helper de completitud, TC0)', () => {
  it('los modulos que toca TC0 documentan `response` en toda ruta que lo necesita', () => {
    const faltantes = rutasSinResponseDocumentado(['users', 'roles', 'permissions', 'health', 'assistant', 'index']);
    expect(faltantes).toEqual([]);
  });

  it('TC6: TODOS los modulos (todos los tags de registry.ts) documentan `response`', () => {
    const todosLosTags = [...new Set(registroOpenApi.map((r) => r.tag))];
    const faltantes = rutasSinResponseDocumentado(todosLosTags);
    expect(faltantes.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TC6: toda ruta REALMENTE montada esta en registry.ts, y viceversa. Se
// recorren los `*.routes.ts` directamente (no el `app` ya arrancado): mismo
// criterio de descubrimiento que `core/router/autoload.ts` (autoload por
// carpeta), sin depender de la estructura interna del router de Express 5
// (que en la app ya montada no expone el prefijo de un sub-router de forma
// estatica). `/internal` no vive bajo `src/modules` (es una app aparte,
// `src/internal-app.ts`) y `/auth` lo sirve Better Auth (fusionado aparte en
// `openapi.ts`): ninguno de los dos pasa por aqui, asi que no hace falta
// excluirlos a mano.
// ─────────────────────────────────────────────────────────────────────────────

const DIR_MODULOS = path.join(__dirname, '../../src/modules');
const RE_ARCHIVO_RUTAS = /\.routes\.(ts|js)$/;

interface RutaMontada {
  method: string;
  path: string;
}

/** Prefijo por defecto de un archivo de rutas: el nombre de su carpeta (igual que `toBasePath`, autoload.ts). */
function prefijoPorDefecto(archivoRelativo: string): string {
  const dir = path.dirname(archivoRelativo);
  if (dir === '.') return `/${path.basename(archivoRelativo).replace(RE_ARCHIVO_RUTAS, '')}`;
  return `/${dir.split(path.sep).join('/')}`;
}

async function descubrirRutasMontadas(): Promise<RutaMontada[]> {
  const archivos = fs
    .readdirSync(DIR_MODULOS, { recursive: true, encoding: 'utf8' })
    .filter((f) => RE_ARCHIVO_RUTAS.test(f) && !f.endsWith('.d.ts'))
    .sort();

  // El indice (`GET {API_PREFIX}`) es la UNICA ruta que no sale de un
  // `*.routes.ts`: se monta a mano en `app.ts` (autoload.ts, comentario del
  // propio archivo). Se añade aqui para que la comparacion sea completa.
  const rutas: RutaMontada[] = [{ method: 'get', path: '' }];

  for (const archivo of archivos) {
    const absoluto = path.join(DIR_MODULOS, archivo);
    const mod = (await import(pathToFileURL(absoluto).href)) as { default?: Router; basePath?: string };
    const router = mod.default;
    if (!router) continue;
    const basePath = mod.basePath ?? prefijoPorDefecto(archivo);

    type LayerConRuta = { route?: { path: string; methods: Record<string, boolean> } };
    for (const layer of router.stack as unknown as LayerConRuta[]) {
      if (!layer.route) continue;
      const metodos = Object.keys(layer.route.methods).filter((m) => layer.route?.methods[m]);
      const sufijo = layer.route.path === '/' ? '' : layer.route.path;
      const rutaOpenApi = `${basePath}${sufijo}`.replace(/:(\w+)/g, '{$1}');
      for (const metodo of metodos) rutas.push({ method: metodo, path: rutaOpenApi });
    }
  }
  return rutas;
}

describe('Rutas montadas <-> registry.ts (TC6)', () => {
  it('toda ruta montada esta documentada en registry.ts, y viceversa', async () => {
    const montadas = await descubrirRutasMontadas();
    const montadasSet = new Set(montadas.map((r) => `${r.method} ${r.path}`));
    const registroSet = new Set(registroOpenApi.map((r) => `${r.method} ${r.path}`));

    const montadasSinDocumentar = [...montadasSet].filter((r) => !registroSet.has(r)).sort();
    const documentadasSinMontar = [...registroSet].filter((r) => !montadasSet.has(r)).sort();

    expect(montadasSinDocumentar).toEqual([]);
    expect(documentadasSinMontar).toEqual([]);
  });
});
