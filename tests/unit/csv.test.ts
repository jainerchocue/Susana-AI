import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { enviarCsv } from '../../src/core/http/csv';
import { noStore } from '../../src/core/middleware/security';

/**
 * `enviarCsv` es la unica excepcion al contrato JSON: se prueba con una app
 * Express minima (sin BD, sin auth) montando `noStore` en la ruta, tal como
 * lo hara una ruta real de exportacion (T8/T9).
 */
function appDePrueba(columnas: string[], filas: Record<string, unknown>[], nombre = 'reporte'): express.Express {
  const app = express();
  app.get('/export', noStore, (_req, res) => {
    enviarCsv(res, nombre, columnas, filas);
  });
  return app;
}

describe('enviarCsv', () => {
  it('responde con las cabeceras del contrato: text/csv, adjunto y no-store', async () => {
    const app = appDePrueba(['nombre', 'valor'], [{ nombre: 'a', valor: 1 }]);

    const res = await request(app).get('/export');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="reporte.csv"');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('escribe encabezado y filas en el orden de `columnas`, terminadas en CRLF', async () => {
    const app = appDePrueba(
      ['unidad', 'censo'],
      [
        { unidad: 'URGENCIAS', censo: 12 },
        { unidad: 'PEDIATRIA', censo: 3 },
      ],
    );

    const res = await request(app).get('/export');

    expect(res.text).toBe('"unidad","censo"\r\n"URGENCIAS","12"\r\n"PEDIATRIA","3"\r\n');
  });

  it('trata null/undefined como celda vacia', async () => {
    const app = appDePrueba(['a', 'b'], [{ a: null, b: undefined }]);

    const res = await request(app).get('/export');

    expect(res.text).toBe('"a","b"\r\n"",""\r\n');
  });

  it('neutraliza la inyeccion de formulas (=, +, -, @, tab, CR)', async () => {
    const app = appDePrueba(
      ['valor'],
      [
        { valor: '=cmd|"/c calc"!A1' },
        { valor: '+SUM(A1:A2)' },
        { valor: '-1+1' },
        { valor: '@SUM(1)' },
        { valor: '\tformula' },
        { valor: '\rformula' },
      ],
    );

    const res = await request(app).get('/export');
    const filas = res.text.trim().split('\r\n').slice(1);

    expect(filas[0]).toBe('"\'=cmd|""/c calc""!A1"');
    expect(filas[1]).toBe('"\'+SUM(A1:A2)"');
    expect(filas[2]).toBe('"\'-1+1"');
    expect(filas[3]).toBe('"\'@SUM(1)"');
    expect(filas[4]).toBe('"\'\tformula"');
    expect(filas[5]).toBe('"\'\rformula"');
  });

  it('no toca un valor que no empieza por un caracter peligroso, aunque lo contenga en medio', async () => {
    const app = appDePrueba(['valor'], [{ valor: 'total = 5' }]);

    const res = await request(app).get('/export');

    expect(res.text).toBe('"valor"\r\n"total = 5"\r\n');
  });

  it('escapa comillas dobles duplicandolas', async () => {
    const app = appDePrueba(['nombre'], [{ nombre: 'Hospital "Central"' }]);

    const res = await request(app).get('/export');

    expect(res.text).toBe('"nombre"\r\n"Hospital ""Central"""\r\n');
  });

  it('conserva saltos de linea dentro de una celda citada', async () => {
    const app = appDePrueba(['nota'], [{ nota: 'linea 1\nlinea 2' }]);

    const res = await request(app).get('/export');

    expect(res.text).toBe('"nota"\r\n"linea 1\nlinea 2"\r\n');
  });

  it('sanea el nombre de archivo a [a-z0-9-] (evita inyeccion de cabecera y path traversal)', async () => {
    const app = appDePrueba(['a'], [{ a: 1 }], '../etc/passwd; evil"\r\nX-Injected: 1');

    const res = await request(app).get('/export');

    expect(res.headers['content-disposition']).toBe('attachment; filename="etcpasswdevilx-injected1.csv"');
  });

  it('usa "export" si el nombre saneado queda vacio', async () => {
    const app = appDePrueba(['a'], [{ a: 1 }], '@#$%^&*()');

    const res = await request(app).get('/export');

    expect(res.headers['content-disposition']).toBe('attachment; filename="export.csv"');
  });
});
