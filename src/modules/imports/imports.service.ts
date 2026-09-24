import fs from 'node:fs';
import path from 'node:path';
import type { ImportStatus, Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { AUDIT, auditar, type RequestMeta } from '../../core/audit/audit';
import { AppError } from '../../core/http/errors';
import { importarTabla, type ErrorFila, type TablaImportable } from '../his/his.import';
import type { ListImportsQuery } from './imports.schemas';

/**
 * Orquesta `POST /imports/:table` (TC1): crea el `ImportJob`, dispara
 * `importarTabla` en segundo plano (la peticion ya respondio 202) y dejalo
 * todo en el propio job cuando termine. `imports.controller.ts` solo hace
 * I/O de la peticion (streaming del cuerpo a un temporal); todo lo demas
 * -Prisma, auditoria, el candado de "un solo trabajo a la vez"- vive aqui,
 * como pide CLAUDE.md §6.
 */

export interface PublicImportJob {
  id: string;
  table: string;
  status: ImportStatus;
  fileName: string | null;
  fileBytes: number;
  delimiter: string | null;
  processed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  invalid: number;
  warnings: number;
  errors: ErrorFila[] | null;
  message: string | null;
  createdBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function aPublico(job: {
  id: string;
  table: string;
  status: ImportStatus;
  fileName: string | null;
  fileBytes: number;
  delimiter: string | null;
  processed: number;
  inserted: number;
  duplicates: number;
  skipped: number;
  invalid: number;
  warnings: number;
  errors: Prisma.JsonValue;
  message: string | null;
  createdBy: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}): PublicImportJob {
  return {
    id: job.id,
    table: job.table,
    status: job.status,
    fileName: job.fileName,
    fileBytes: job.fileBytes,
    delimiter: job.delimiter,
    processed: job.processed,
    inserted: job.inserted,
    duplicates: job.duplicates,
    skipped: job.skipped,
    invalid: job.invalid,
    warnings: job.warnings,
    errors: (job.errors as ErrorFila[] | null) ?? null,
    message: job.message,
    createdBy: job.createdBy,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

/**
 * Candado en memoria de "un solo trabajo a la vez" (spec TC1: "Un solo
 * trabajo RUNNING a la vez: si hay otro -> 409"). Se reserva de forma
 * SINCRONA (sin `await` entre leer `bloqueado` y ponerlo a `true`): dentro de
 * este mismo proceso Node, eso cierra la carrera entre dos peticiones
 * concurrentes sin necesitar una transaccion de BD.
 *
 * ponytail: no cubre varias instancias del proceso (un balanceador con >1
 * replica). La comprobacion contra la BD (mas abajo) SI detecta un job que
 * dejo otra instancia en PENDING/RUNNING, pero no arbitra entre dos
 * instancias que empiezan a la vez. Con una sola replica (el caso de esta
 * tarea) es exacto. Pasar a un candado real (advisory lock de Postgres)
 * exigiria mantener la MISMA conexion abierta durante todo el import, lo que
 * no encaja bien con el pool de Prisma.
 */
let bloqueado = false;

/** Solo para tests: fuerza el candado a su estado inicial entre archivos de test. */
export function _reiniciarCandadoParaTests(): void {
  bloqueado = false;
}

async function verificarYReservar(): Promise<void> {
  if (bloqueado) {
    throw AppError.conflict('Ya hay una importacion en curso. Espera a que termine antes de subir otro archivo.');
  }
  bloqueado = true;
  try {
    const enCurso = await prisma.importJob.findFirst({
      where: { status: { in: ['PENDING', 'RUNNING'] } },
      select: { id: true, table: true },
    });
    if (enCurso) {
      throw AppError.conflict(
        `Ya hay una importacion en curso (job ${enCurso.id}, tabla ${enCurso.table}). Espera a que termine.`,
      );
    }
  } catch (error) {
    bloqueado = false;
    throw error;
  }
}

function liberar(): void {
  bloqueado = false;
}

/** Borra el directorio temporal completo (el archivo subido vive solo). Nunca lanza. */
async function borrarTemporal(rutaArchivo: string): Promise<void> {
  try {
    await fs.promises.rm(path.dirname(rutaArchivo), { recursive: true, force: true });
  } catch (error) {
    // El SO limpia /tmp igualmente y el resultado del job ya quedo guardado
    // en la BD: un fallo al borrar el temporal no debe tumbar nada.
    logger.warn({ err: error, rutaArchivo }, 'No se pudo borrar el temporal de un import');
  }
}

async function procesarEnSegundoPlano(
  jobId: string,
  tabla: TablaImportable,
  rutaArchivo: string,
  actorId: string,
  meta: RequestMeta,
): Promise<void> {
  try {
    const resumen = await importarTabla(tabla, rutaArchivo);
    await prisma.importJob.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        delimiter: resumen.delimiter,
        processed: resumen.procesadas,
        inserted: resumen.insertadas,
        duplicates: resumen.duplicadas,
        skipped: resumen.vacias,
        invalid: resumen.invalidas,
        warnings: resumen.avisos.length,
        errors: resumen.errores as unknown as Prisma.InputJsonValue,
        message: resumen.avisos.length > 0 ? resumen.avisos.join(' | ') : null,
        finishedAt: new Date(),
      },
    });
    await auditar({
      action: AUDIT.importacionTerminada,
      actorId,
      targetType: 'import_job',
      targetId: jobId,
      metadata: {
        table: tabla,
        status: 'COMPLETED',
        procesadas: resumen.procesadas,
        insertadas: resumen.insertadas,
        invalidas: resumen.invalidas,
      },
      ...meta,
    });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', message: mensaje, finishedAt: new Date() },
    });
    await auditar({
      action: AUDIT.importacionTerminada,
      actorId,
      targetType: 'import_job',
      targetId: jobId,
      metadata: { table: tabla, status: 'FAILED', error: mensaje },
      ...meta,
    });
    logger.error({ err: error, jobId, tabla }, 'Fallo la importacion CSV');
  } finally {
    liberar();
    await borrarTemporal(rutaArchivo);
  }
}

/**
 * Crea el `ImportJob` (ya en RUNNING: la comprobacion de concurrencia y el
 * candado ya se resolvieron antes, en `verificarYReservar`) y dispara el
 * procesamiento en segundo plano sin esperarlo: la peticion HTTP responde
 * 202 con el job recien creado, el resto ocurre despues.
 */
export async function crearTrabajo(
  tabla: TablaImportable,
  rutaArchivo: string,
  fileName: string | null,
  fileBytes: number,
  actorId: string,
  meta: RequestMeta,
): Promise<PublicImportJob> {
  await verificarYReservar();

  let job;
  try {
    job = await prisma.importJob.create({
      data: { table: tabla, status: 'RUNNING', fileName, fileBytes, createdBy: actorId, startedAt: new Date() },
    });
  } catch (error) {
    liberar();
    throw error;
  }

  await auditar({
    action: AUDIT.importacionIniciada,
    actorId,
    targetType: 'import_job',
    targetId: job.id,
    metadata: { table: tabla, fileName, fileBytes },
    ...meta,
  });

  // Fire-and-forget: el resultado se consulta con GET /imports/:id.
  void procesarEnSegundoPlano(job.id, tabla, rutaArchivo, actorId, meta);

  return aPublico(job);
}

export async function listar(query: ListImportsQuery): Promise<{
  items: PublicImportJob[];
  limit: number;
  hasNext: boolean;
  nextCursor: string | null;
}> {
  const where: Prisma.ImportJobWhereInput = {};
  if (query.status) where.status = query.status;
  if (query.table) where.table = query.table;

  const filas = await prisma.importJob.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
  });

  const hasNext = filas.length > query.limit;
  const pagina = hasNext ? filas.slice(0, query.limit) : filas;

  return {
    items: pagina.map(aPublico),
    limit: query.limit,
    hasNext,
    nextCursor: hasNext ? (pagina[pagina.length - 1]?.id ?? null) : null,
  };
}

export async function obtener(id: string): Promise<PublicImportJob> {
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job) throw AppError.notFound('Trabajo de importacion');
  return aPublico(job);
}

/** Borra el REGISTRO del job (metadatos de la subida), nunca los datos ya importados. */
export async function borrar(id: string, actorId: string, meta: RequestMeta): Promise<void> {
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job) throw AppError.notFound('Trabajo de importacion');
  if (job.status === 'RUNNING' || job.status === 'PENDING') {
    throw AppError.conflict('No se puede borrar un trabajo en curso. Espera a que termine.');
  }

  await prisma.importJob.delete({ where: { id } });
  await auditar({
    action: AUDIT.importacionBorrada,
    actorId,
    targetType: 'import_job',
    targetId: id,
    metadata: { table: job.table, status: job.status },
    ...meta,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /imports/templates/:table
// ─────────────────────────────────────────────────────────────────────────────

export interface PlantillaCsv {
  columnas: string[];
  filaEjemplo: string[];
}

/**
 * Una fila de ejemplo por tabla, con la cabecera EXACTA que exige
 * `importarTabla` (mismo orden y nombres que los archivos nativos del HIS:
 * la plantilla, subida tal cual, debe importar sin errores). ids/codigos
 * sinteticos (>= 9.000.000 / prefijo `ZE2E`, convencion de C0) para que, si
 * alguien la sube de verdad, caiga en el rango que el resto de la suite ya
 * reconoce y limpia.
 */
const PLANTILLAS: Record<TablaImportable, PlantillaCsv> = {
  patients: {
    columnas: ['TipoDocumento', 'IdPaciente', 'NombrePaciente', 'FechaNacimiento', 'Sexo', 'Asegurador', 'Regimen', 'Departamento', 'Municipio', 'Zona'],
    filaEjemplo: ['CC', '9000001', 'ZE', '1990-01-01', 'Femenino', 'EPS EJEMPLO', 'Contributivo', 'CAUCA', 'POPAYAN', 'Urbana'],
  },
  admissions: {
    columnas: ['OidIngreso', 'ConsecutivoIngreso', 'IdPaciente', 'ClaseIngreso', 'ViaIngreso', 'TipoRiesgo', 'FechaIngreso', 'FechaHospitalizacion', 'OidTriageA', 'CodigoCama', 'NombreCama', 'NombreGrupoCama', 'NombreSubgrupoCama', 'CodigoDiagnostico', 'NombreDiagnostico'],
    filaEjemplo: ['9000001', '1', '9000001', 'Urgencias', 'Particular', 'Ninguno', '2026-05-01 08:00:00', '', '', 'CAMA01', 'CAMA 01', 'URGENCIAS', 'GENERAL', '', ''],
  },
  triages: {
    columnas: ['OidTriage', 'FechaTriage', 'MotivoConsulta', 'TensionArterial', 'FrecuenciaCardiaca', 'FrecuenciaRespiratoria', 'Temperatura', 'IdPaciente2', 'CodigoTriage', 'ClasificacionTriage'],
    filaEjemplo: ['9000001', '2026-05-01 07:45:00', 'Dolor abdominal', '120/80', '80', '18', '36.5', '9000001', 'ZE01', 'URGENCIAS TRIAGE 3 (VERDE)'],
  },
  'first-care': {
    columnas: ['OidIngreso', 'FechaAtencion'],
    filaEjemplo: ['9000001', '2026-05-01 08:15:00'],
  },
  'service-records': {
    columnas: ['OidIngreso', 'CodigoServicio', 'NombreServicio', 'Cantidad', 'FechaPrestacion', 'CodigoAreaServicio', 'AreaServicio', 'Especialidad', 'OidS'],
    filaEjemplo: ['9000001', 'ZE2E001', 'SERVICIO DE EJEMPLO', '1', '2026-05-01 09:00:00', 'A01', 'AREA EJEMPLO', 'MEDICINA GENERAL', '9000001'],
  },
  dispenses: {
    columnas: ['OidIngreso', 'CodigoServicio', 'NombreServicio', 'Cantidad', 'FechaPrestacion', 'AreaServicio', 'Especialidad', 'OidMI'],
    filaEjemplo: ['9000001', 'ZE2E002', 'MEDICAMENTO DE EJEMPLO', '2', '2026-05-01 09:30:00', 'AREA EJEMPLO', 'FARMACIA', '9000001'],
  },
  'surgery-schedules': {
    columnas: ['ConsecutivoProgramacion', 'IdPaciente', 'OidIngreso', 'CodigoServicio'],
    filaEjemplo: ['ZE2E-PROG-001', '9000001', '9000001', 'ZE2E001'],
  },
};

export function plantilla(tabla: TablaImportable): PlantillaCsv {
  return PLANTILLAS[tabla];
}
