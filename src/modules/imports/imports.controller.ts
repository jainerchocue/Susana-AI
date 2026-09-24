import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, RequestHandler } from 'express';
import { env } from '../../config/env';
import { noContent, ok, paginated } from '../../core/http/api-response';
import { HttpStatus } from '../../core/http/http-status';
import { AppError } from '../../core/http/errors';
import { enviarCsv } from '../../core/http/csv';
import { param, requestMeta } from '../../core/http/request';
import * as service from './imports.service';
import type { FileNameQuery, ListImportsQuery, TablaParam } from './imports.schemas';
import type { TablaImportable } from '../his/his.import';

/**
 * `POST /imports/:table` es la unica ruta de la API cuyo controlador lee el
 * cuerpo crudo de la peticion: `requireJson` (core/middleware/security.ts)
 * deja pasar `text/csv` sin tocarlo y `express.json()` solo parsea
 * `application/json`, asi que `req` sigue siendo un stream legible aqui.
 */

function query(req: Request): FileNameQuery {
  return req.query;
}

function tablaParam(req: Request): TablaImportable {
  return (req.params as unknown as TablaParam).table;
}

function listQuery(req: Request): ListImportsQuery {
  return req.query as unknown as ListImportsQuery;
}

/**
 * Escribe el cuerpo de la peticion en un archivo temporal (`fs.mkdtemp` en
 * `os.tmpdir()`), contando bytes segun llegan: corta con 413 en cuanto se
 * supera `IMPORT_MAX_MB`, sin esperar a que termine de subir un archivo que
 * ya sabemos que va a sobrar. El directorio temporal se borra siempre en el
 * propio catch (aqui) o, si todo fue bien, cuando termine el procesamiento
 * en segundo plano (`imports.service.ts`).
 */
async function escribirCuerpoATemporal(req: Request): Promise<{ rutaArchivo: string; bytes: number }> {
  const limiteBytes = env.IMPORT_MAX_MB * 1024 * 1024;

  const contentLength = Number(req.headers['content-length'] ?? 0);
  if (contentLength > limiteBytes) {
    // OJO: NO se llama a `req.destroy()` aqui. Cortar el socket antes de que
    // Express pueda escribir la respuesta 413 hace que el cliente reciba un
    // "socket hang up" (ECONNRESET) en vez del 413: el error se pierde por el
    // camino. Basta con no seguir leyendo el cuerpo y dejar que el error
    // handler responda con normalidad; Node drena o descarta el resto del
    // cuerpo al cerrar la conexion tras la respuesta.
    throw AppError.payloadTooLarge();
  }

  const dirTemporal = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'his-import-'));
  const rutaArchivo = path.join(dirTemporal, 'archivo.csv');
  const destino = fs.createWriteStream(rutaArchivo);

  let bytes = 0;
  try {
    for await (const trozo of req) {
      const buffer = trozo as Buffer;
      bytes += buffer.length;
      if (bytes > limiteBytes) {
        throw AppError.payloadTooLarge();
      }
      if (!destino.write(buffer)) {
        await new Promise<void>((resolve) => destino.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      destino.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    destino.destroy();
    await fs.promises.rm(dirTemporal, { recursive: true, force: true });
    throw error;
  }

  return { rutaArchivo, bytes };
}

export const subir: RequestHandler = async (req, res) => {
  const tabla = tablaParam(req);
  const fileName = query(req).fileName ?? null;

  // Antes de leer un solo byte del cuerpo: si ya hay un trabajo en curso, no
  // tiene sentido aceptar la subida (spec TC1: "un solo trabajo RUNNING a la
  // vez"). `crearTrabajo` vuelve a comprobarlo (y reserva el candado) por si
  // esta peticion tarda en subir el archivo y otra se cuela mientras tanto.
  const { rutaArchivo, bytes } = await escribirCuerpoATemporal(req);
  const job = await service.crearTrabajo(tabla, rutaArchivo, fileName, bytes, req.auth!.id, requestMeta(req));
  ok(res, job, HttpStatus.ACCEPTED);
};

export const listar: RequestHandler = async (req, res) => {
  const resultado = await service.listar(listQuery(req));
  paginated(res, { items: resultado.items, limit: resultado.limit, hasNext: resultado.hasNext, nextCursor: resultado.nextCursor });
};

export const obtener: RequestHandler = async (req, res) => ok(res, await service.obtener(param(req, 'id')));

export const borrar: RequestHandler = async (req, res) => {
  await service.borrar(param(req, 'id'), req.auth!.id, requestMeta(req));
  noContent(res);
};

export const plantilla: RequestHandler = (req, res) => {
  const tabla = tablaParam(req);
  const { columnas, filaEjemplo } = service.plantilla(tabla);
  const fila: Record<string, string> = {};
  columnas.forEach((columna, indice) => {
    fila[columna] = filaEjemplo[indice] ?? '';
  });
  enviarCsv(res, `plantilla-${tabla}`, columnas, [fila]);
};
