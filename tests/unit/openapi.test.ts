import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aJsonSchema } from '../../src/core/openapi/openapi';
import { rutasSinResponseDocumentado } from '../../src/core/openapi/registry';

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
});
