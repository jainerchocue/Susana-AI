import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../core/db/prisma';
import { logger } from '../../core/logger';
import { recalcularDerivados } from './his.derivados';
import { invalidarFechaReferencia } from './his.periodo';

/**
 * Importador de los datos HIS. Vive aqui (no en `src/scripts/`) para que TANTO
 * el script CLI (`npm run data:import`, carga completa de los 7 `.txt` de un
 * directorio) COMO la subida por API (`POST /imports/:table`, TC1, un archivo
 * a la vez) compartan exactamente la misma validacion Zod y las mismas
 * derivaciones de dominio. `src/scripts/import-data.ts` queda como envoltorio
 * fino de la CLI: reexporta `importarDirectorio` y anade el `main()`.
 *
 * Dos rutas de entrada:
 *  - `importarDirectorio(dir)`: los 7 `.txt` nativos (separador `|`, sin
 *    comillas), con los Sets de ids construidos en memoria de un archivo para
 *    validar las FK del siguiente (T6, sin cambios de comportamiento).
 *  - `importarTabla(tabla, ruta, opts)`: UN archivo a la vez, subido por la
 *    API. Detecta el separador (nativo `|` sin comillas, o `,`/`;` con
 *    comillas RFC 4180) y comprueba las FK **por lote** contra la BD, porque
 *    aqui no hay garantia de que el resto de tablas ya esten cargadas en este
 *    mismo proceso.
 */

const LOTE = 5_000;
const LIMITE_ERRORES_POR_ARCHIVO = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del resumen (carga completa, `importarDirectorio`)
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorFila {
  linea: number;
  motivo: string;
}

export interface ResumenArchivo {
  archivo: string;
  procesadas: number;
  insertadas: number;
  duplicadas: number;
  vacias: number;
  invalidas: number;
  avisos: string[];
  /** Primeros 20 errores (numero de linea + motivo). Nunca datos de paciente. */
  errores: ErrorFila[];
}

export interface ResumenImportacion {
  archivos: ResumenArchivo[];
  ms: number;
}

function nuevoResumen(archivo: string): ResumenArchivo {
  return { archivo, procesadas: 0, insertadas: 0, duplicadas: 0, vacias: 0, invalidas: 0, avisos: [], errores: [] };
}

function resumenCatalogo(archivo: string, procesadas: number, insertadas: number): ResumenArchivo {
  return { archivo, procesadas, insertadas, duplicadas: procesadas - insertadas, vacias: 0, invalidas: 0, avisos: [], errores: [] };
}

/** Acumula hasta un limite de errores detallados, sin dejar de contar el total. */
class AcumuladorErrores {
  private items: ErrorFila[] = [];
  private totalInvalidas = 0;

  constructor(private readonly limite: number = LIMITE_ERRORES_POR_ARCHIVO) {}

  agregar(linea: number, motivo: string): void {
    this.totalInvalidas += 1;
    if (this.items.length < this.limite) this.items.push({ linea, motivo });
  }

  get total(): number {
    return this.totalInvalidas;
  }

  get lista(): ErrorFila[] {
    return this.items;
  }
}

function describirError(error: z.ZodError): string {
  return error.issues.map((i) => i.message).join('; ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Lectura en streaming (formato nativo del HIS: `|`, sin comillas)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reparte un array de campos posicional en un objeto plano, usando `claves`
 * como nombres de salida (ya en camelCase del modelo, no la cabecera del
 * HIS). Un `_` como clave descarta esa columna (p.ej. `NombreServicio`, que
 * solo sirve para el catalogo derivado, no para la fila en si).
 */
function zip(claves: readonly string[], campos: readonly string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  claves.forEach((clave, indice) => {
    obj[clave] = campos[indice] ?? '';
  });
  return obj;
}

/**
 * Generador de filas de un `.txt` del HIS. Valida que la cabecera sea
 * EXACTAMENTE la esperada (mismo numero y orden de columnas) antes de emitir
 * ninguna fila: con una cabecera distinta, cualquier importación seria
 * silenciosamente incorrecta.
 */
async function* leerFilas(ruta: string, cabeceraEsperada: string[]): AsyncGenerator<{ numero: number; campos: string[] }> {
  const flujo = readline.createInterface({ input: fs.createReadStream(ruta, { encoding: 'utf-8' }), crlfDelay: Infinity });
  let numero = 0;
  for await (const linea of flujo) {
    numero += 1;
    if (numero === 1) {
      const campos = linea.split('|');
      const igual = campos.length === cabeceraEsperada.length && campos.every((c, i) => c === cabeceraEsperada[i]);
      if (!igual) {
        throw new Error(
          `Cabecera invalida en ${ruta}.\n  esperada: ${cabeceraEsperada.join('|')}\n  recibida: ${linea}`,
        );
      }
      continue;
    }
    yield { numero, campos: linea.split('|') };
  }
}

/** Vacia el lote acumulado con `createMany({ skipDuplicates: true })` y limpia el array in-place. */
async function volcarLote<T>(
  lote: T[],
  insertar: (datos: T[]) => Promise<{ count: number }>,
): Promise<{ insertadas: number; duplicadas: number }> {
  if (lote.length === 0) return { insertadas: 0, duplicadas: 0 };
  const resultado = await insertar(lote);
  const salida = { insertadas: resultado.count, duplicadas: lote.length - resultado.count };
  lote.length = 0;
  return salida;
}

async function insertarEnLotes<T>(datos: T[], insertar: (lote: T[]) => Promise<{ count: number }>): Promise<number> {
  let insertadas = 0;
  for (let i = 0; i < datos.length; i += LOTE) {
    const resultado = await insertar(datos.slice(i, i + LOTE));
    insertadas += resultado.count;
  }
  return insertadas;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructores de campos Zod (normalizan Y validan, como pide CLAUDE.md §4)
// ─────────────────────────────────────────────────────────────────────────────

function textoRequerido(nombreCampo: string) {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (t === '') {
      ctx.addIssue({ code: 'custom', message: `"${nombreCampo}" esta vacio` });
      return z.NEVER;
    }
    return t;
  });
}

function textoOpcional() {
  return z.string().transform((v) => {
    const t = v.trim();
    return t === '' ? null : t;
  });
}

const RE_ENTERO = /^-?\d+$/;

function enteroRequerido(nombreCampo: string) {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (!RE_ENTERO.test(t)) {
      ctx.addIssue({ code: 'custom', message: `"${nombreCampo}" no es un entero: "${v}"` });
      return z.NEVER;
    }
    return Number(t);
  });
}

function enteroOpcional() {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (t === '') return null;
    if (!RE_ENTERO.test(t)) {
      ctx.addIssue({ code: 'custom', message: `entero invalido: "${v}"` });
      return z.NEVER;
    }
    return Number(t);
  });
}

const RE_FECHA_HIS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/** "YYYY-MM-DD HH:MM:SS" en hora local de Colombia -> instante real (UTC-5 fijo, B0). */
function fechaHisRequerida(nombreCampo: string) {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (!RE_FECHA_HIS.test(t)) {
      ctx.addIssue({ code: 'custom', message: `"${nombreCampo}" no es una fecha valida: "${v}"` });
      return z.NEVER;
    }
    return new Date(`${t.slice(0, 10)}T${t.slice(11, 19)}-05:00`);
  });
}

function fechaHisOpcional() {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (t === '') return null;
    if (!RE_FECHA_HIS.test(t)) {
      ctx.addIssue({ code: 'custom', message: `fecha invalida: "${v}"` });
      return z.NEVER;
    }
    return new Date(`${t.slice(0, 10)}T${t.slice(11, 19)}-05:00`);
  });
}

const RE_FECHA_DIA = /^\d{4}-\d{2}-\d{2}$/;

function fechaSoloDiaRequerida(nombreCampo: string) {
  return z.string().transform((v, ctx) => {
    const t = v.trim();
    if (!RE_FECHA_DIA.test(t)) {
      ctx.addIssue({ code: 'custom', message: `"${nombreCampo}" no es una fecha valida: "${v}"` });
      return z.NEVER;
    }
    return new Date(`${t}T00:00:00.000Z`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de dominio (derivaciones puras, sin estado externo)
// ─────────────────────────────────────────────────────────────────────────────

/** Fuera de rango o ilegible -> null (B0): un signo vital basura no invalida la fila entera. */
function parseSignoEnRango(valor: string | null, min: number, max: number): number | null {
  if (valor === null) return null;
  const t = valor.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** "135/84" -> {systolic, diastolic}. Basura tipo "0/0" o "1/1" cae fuera de rango -> null,null. */
function parsePresion(valor: string | null): { systolic: number | null; diastolic: number | null } {
  if (!valor) return { systolic: null, diastolic: null };
  const partes = valor.split('/');
  if (partes.length !== 2) return { systolic: null, diastolic: null };
  return {
    systolic: parseSignoEnRango(partes[0] ?? null, 50, 260),
    diastolic: parseSignoEnRango(partes[1] ?? null, 20, 160),
  };
}

const RE_NIVEL_TRIAGE = /TRIAGE\s*([1-5])/;

/** El nivel 1-5 esta en el texto, no en `CodigoTriage` (B0). Solo aparecen niveles 1-4 en el extracto real. */
function extraerNivelTriage(texto: string): number | null {
  const grupo = RE_NIVEL_TRIAGE.exec(texto)?.[1];
  return grupo ? Number(grupo) : null;
}

/**
 * Dispositivo medico ("insumo") vs medicamento. B0 dice que el prefijo es
 * "DMT", pero verificado contra los datos reales: TODOS los codigos que
 * empiezan por "DM" (DMT, DMC, DMM, DMG, DME...) son dispositivos (tubos,
 * cateteres, mascaras, grapadoras, equipos de infusion); "DMT" es solo uno de
 * esos prefijos, no el unico. Usar solo "DMT" clasificaria ~576 codigos de
 * dispositivo (todo lo DMC/DMM/DMG/DME/...) como medicamento. Se documenta
 * como desviacion de B0 en el reporte de la tarea.
 */
function tipoMedicamento(codigo: string): string {
  return codigo.startsWith('DM') ? 'insumo' : 'medicamento';
}

/** Construye el mapa "clave en minusculas -> forma mas frecuente" para colapsar variantes de mayusculas. */
function elegirMasFrecuente(frecuencias: Map<string, Map<string, number>>): Map<string, string> {
  const ganadores = new Map<string, string>();
  for (const [clave, porForma] of frecuencias) {
    let mejor = '';
    let mejorConteo = -1;
    for (const [forma, conteo] of porForma) {
      if (conteo > mejorConteo) {
        mejor = forma;
        mejorConteo = conteo;
      }
    }
    ganadores.set(clave, mejor);
  }
  return ganadores;
}

// ─────────────────────────────────────────────────────────────────────────────
// Paciente.txt -> Patient
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_PACIENTE = ['TipoDocumento', 'IdPaciente', 'NombrePaciente', 'FechaNacimiento', 'Sexo', 'Asegurador', 'Regimen', 'Departamento', 'Municipio', 'Zona'];
// NombrePaciente son iniciales: no se importa (minimizacion de datos, B0).
const CAMPOS_PACIENTE = ['documentType', 'id', '_nombre', 'birthDate', 'sex', 'insurer', 'regime', 'department', 'municipality', 'zone'];

const pacienteSchema = z.object({
  documentType: textoRequerido('TipoDocumento'),
  id: enteroRequerido('IdPaciente'),
  birthDate: fechaSoloDiaRequerida('FechaNacimiento'),
  sex: textoRequerido('Sexo'),
  insurer: textoRequerido('Asegurador'),
  regime: textoRequerido('Regimen'),
  department: textoRequerido('Departamento'),
  municipality: textoRequerido('Municipio'),
  zone: textoRequerido('Zona'),
});

async function procesarPacientes(rutaArchivo: string): Promise<{ resumen: ResumenArchivo; ids: Set<number> }> {
  const resumen = nuevoResumen('Paciente.txt');
  const errores = new AcumuladorErrores();
  const ids = new Set<number>();
  const lote: Prisma.PatientCreateManyInput[] = [];

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_PACIENTE)) {
    resumen.procesadas += 1;
    const parseo = pacienteSchema.safeParse(zip(CAMPOS_PACIENTE, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }
    ids.add(parseo.data.id);
    lote.push(parseo.data);
    if (lote.length >= LOTE) {
      const r = await volcarLote(lote, (d) => prisma.patient.createMany({ data: d, skipDuplicates: true }));
      resumen.insertadas += r.insertadas;
      resumen.duplicadas += r.duplicadas;
    }
  }
  const resto = await volcarLote(lote, (d) => prisma.patient.createMany({ data: d, skipDuplicates: true }));
  resumen.insertadas += resto.insertadas;
  resumen.duplicadas += resto.duplicadas;
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return { resumen, ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Triage.txt -> Triage
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_TRIAGE = ['OidTriage', 'FechaTriage', 'MotivoConsulta', 'TensionArterial', 'FrecuenciaCardiaca', 'FrecuenciaRespiratoria', 'Temperatura', 'IdPaciente2', 'CodigoTriage', 'ClasificacionTriage'];
// MotivoConsulta es texto libre: no se importa (B0).
const CAMPOS_TRIAGE = ['id', 'triagedAt', '_motivo', 'tensionArterial', 'heartRateRaw', 'respiratoryRateRaw', 'temperatureRaw', 'patientIdRaw', 'code', 'classification'];

const triageBaseSchema = z.object({
  id: enteroRequerido('OidTriage'),
  triagedAt: fechaHisRequerida('FechaTriage'),
  tensionArterial: textoOpcional(),
  heartRateRaw: textoOpcional(),
  respiratoryRateRaw: textoOpcional(),
  temperatureRaw: textoOpcional(),
  patientIdRaw: enteroOpcional(),
  code: textoRequerido('CodigoTriage'),
  classification: textoRequerido('ClasificacionTriage'),
});

const triageSchema = triageBaseSchema.transform((v) => {
  const presion = parsePresion(v.tensionArterial);
  return {
    id: v.id,
    triagedAt: v.triagedAt,
    systolic: presion.systolic,
    diastolic: presion.diastolic,
    heartRate: parseSignoEnRango(v.heartRateRaw, 20, 250),
    respiratoryRate: parseSignoEnRango(v.respiratoryRateRaw, 5, 80),
    temperature: parseSignoEnRango(v.temperatureRaw, 30, 45),
    patientIdRaw: v.patientIdRaw,
    code: v.code,
    classification: v.classification,
    level: extraerNivelTriage(v.classification),
  };
});

async function procesarTriages(rutaArchivo: string, idsPacientes: Set<number>): Promise<{ resumen: ResumenArchivo; ids: Set<number> }> {
  const resumen = nuevoResumen('Triage.txt');
  const errores = new AcumuladorErrores();
  const ids = new Set<number>();
  const lote: Prisma.TriageCreateManyInput[] = [];
  let huerfanos = 0;

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_TRIAGE)) {
    resumen.procesadas += 1;
    if (campos.every((c) => c.trim() === '')) {
      resumen.vacias += 1;
      continue;
    }

    const parseo = triageSchema.safeParse(zip(CAMPOS_TRIAGE, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }

    const d = parseo.data;
    let patientId = d.patientIdRaw;
    if (patientId !== null && !idsPacientes.has(patientId)) {
      patientId = null;
      huerfanos += 1;
    }

    ids.add(d.id);
    lote.push({
      id: d.id,
      triagedAt: d.triagedAt,
      systolic: d.systolic,
      diastolic: d.diastolic,
      heartRate: d.heartRate,
      respiratoryRate: d.respiratoryRate,
      temperature: d.temperature,
      patientId,
      code: d.code,
      classification: d.classification,
      level: d.level,
    });
    if (lote.length >= LOTE) {
      const r = await volcarLote(lote, (datos) => prisma.triage.createMany({ data: datos, skipDuplicates: true }));
      resumen.insertadas += r.insertadas;
      resumen.duplicadas += r.duplicadas;
    }
  }
  const resto = await volcarLote(lote, (datos) => prisma.triage.createMany({ data: datos, skipDuplicates: true }));
  resumen.insertadas += resto.insertadas;
  resumen.duplicadas += resto.duplicadas;

  if (huerfanos > 0) resumen.avisos.push(`${huerfanos} triage(s) con paciente huerfano: patientId puesto a null`);
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return { resumen, ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Ingresos.txt -> Admission
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_INGRESOS = ['OidIngreso', 'ConsecutivoIngreso', 'IdPaciente', 'ClaseIngreso', 'ViaIngreso', 'TipoRiesgo', 'FechaIngreso', 'FechaHospitalizacion', 'OidTriageA', 'CodigoCama', 'NombreCama', 'NombreGrupoCama', 'NombreSubgrupoCama', 'CodigoDiagnostico', 'NombreDiagnostico'];
const CAMPOS_INGRESOS = ['id', 'consecutive', 'patientId', 'admissionClass', 'entryRoute', 'riskTypeRaw', 'admittedAt', 'hospitalizedAt', 'triageIdRaw', 'bedCode', 'bedName', 'unit', 'subunit', 'diagnosisCode', 'diagnosisName'];
const INDICE_TIPO_RIESGO = CAMPOS_INGRESOS.indexOf('riskTypeRaw');

const ingresoBaseSchema = z.object({
  id: enteroRequerido('OidIngreso'),
  consecutive: enteroRequerido('ConsecutivoIngreso'),
  patientId: enteroRequerido('IdPaciente'),
  admissionClass: textoRequerido('ClaseIngreso'),
  entryRoute: textoRequerido('ViaIngreso'),
  riskTypeRaw: textoRequerido('TipoRiesgo'),
  admittedAt: fechaHisRequerida('FechaIngreso'),
  hospitalizedAt: fechaHisOpcional(),
  triageIdRaw: enteroOpcional(),
  bedCode: textoRequerido('CodigoCama'),
  bedName: textoRequerido('NombreCama'),
  unit: textoRequerido('NombreGrupoCama'),
  subunit: textoRequerido('NombreSubgrupoCama'),
  diagnosisCode: textoOpcional(),
  diagnosisName: textoOpcional(),
});

const ingresoSchema = ingresoBaseSchema.transform((v) => ({ ...v, virtualBed: v.bedName.includes('VIRTUAL') }));

/** Primera pasada (streaming, solo la columna TipoRiesgo): forma mas frecuente por variante de mayusculas. */
async function calcularNormalizacionRiesgo(rutaArchivo: string): Promise<Map<string, string>> {
  const frecuencias = new Map<string, Map<string, number>>();
  for await (const { campos } of leerFilas(rutaArchivo, CABECERA_INGRESOS)) {
    const original = (campos[INDICE_TIPO_RIESGO] ?? '').trim();
    if (original === '') continue;
    const clave = original.toLowerCase();
    let porForma = frecuencias.get(clave);
    if (!porForma) {
      porForma = new Map();
      frecuencias.set(clave, porForma);
    }
    porForma.set(original, (porForma.get(original) ?? 0) + 1);
  }
  return elegirMasFrecuente(frecuencias);
}

async function procesarIngresos(
  rutaArchivo: string,
  idsPacientes: Set<number>,
  idsTriages: Set<number>,
  normalizacionRiesgo: Map<string, string>,
): Promise<{ resumen: ResumenArchivo; ids: Set<number> }> {
  const resumen = nuevoResumen('Ingresos.txt');
  const errores = new AcumuladorErrores();
  const ids = new Set<number>();
  const lote: Prisma.AdmissionCreateManyInput[] = [];
  let triagesHuerfanos = 0;

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_INGRESOS)) {
    resumen.procesadas += 1;
    const parseo = ingresoSchema.safeParse(zip(CAMPOS_INGRESOS, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }

    const d = parseo.data;
    if (!idsPacientes.has(d.patientId)) {
      errores.agregar(numero, `paciente ${d.patientId} no encontrado en el extracto`);
      continue;
    }

    let triageId = d.triageIdRaw;
    if (triageId !== null && !idsTriages.has(triageId)) {
      triageId = null;
      triagesHuerfanos += 1;
    }

    const riskType = normalizacionRiesgo.get(d.riskTypeRaw.toLowerCase()) ?? d.riskTypeRaw;

    ids.add(d.id);
    lote.push({
      id: d.id,
      consecutive: d.consecutive,
      patientId: d.patientId,
      admissionClass: d.admissionClass,
      entryRoute: d.entryRoute,
      riskType,
      admittedAt: d.admittedAt,
      hospitalizedAt: d.hospitalizedAt,
      triageId,
      bedCode: d.bedCode,
      bedName: d.bedName,
      unit: d.unit,
      subunit: d.subunit,
      virtualBed: d.virtualBed,
      diagnosisCode: d.diagnosisCode,
      diagnosisName: d.diagnosisName,
    });
    if (lote.length >= LOTE) {
      const r = await volcarLote(lote, (datos) => prisma.admission.createMany({ data: datos, skipDuplicates: true }));
      resumen.insertadas += r.insertadas;
      resumen.duplicadas += r.duplicadas;
    }
  }
  const resto = await volcarLote(lote, (datos) => prisma.admission.createMany({ data: datos, skipDuplicates: true }));
  resumen.insertadas += resto.insertadas;
  resumen.duplicadas += resto.duplicadas;

  if (triagesHuerfanos > 0) resumen.avisos.push(`${triagesHuerfanos} ingreso(s) con OidTriageA sin triage correspondiente: triageId puesto a null`);
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return { resumen, ids };
}

// ─────────────────────────────────────────────────────────────────────────────
// Atencion.txt -> UPDATE Admission.firstCareAt (no crea tabla propia)
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_ATENCION = ['OidIngreso', 'FechaAtencion'];
const CAMPOS_ATENCION = ['admissionId', 'firstCareAt'];

const atencionSchema = z.object({
  admissionId: enteroRequerido('OidIngreso'),
  firstCareAt: fechaHisRequerida('FechaAtencion'),
});

async function procesarAtenciones(rutaArchivo: string, idsIngresos: Set<number>): Promise<ResumenArchivo> {
  const resumen = nuevoResumen('Atencion.txt');
  const errores = new AcumuladorErrores();
  const idsLote: number[] = [];
  const fechasLote: Date[] = [];
  let huerfanas = 0;

  const volcar = async (): Promise<void> => {
    if (idsLote.length === 0) return;
    // La guarda `firstCareAt IS NULL` es lo que hace esta UPDATE idempotente:
    // relanzar el import no vuelve a "insertar" (actualizar) lo ya aplicado.
    const filas = await prisma.$executeRaw`
      UPDATE his_admissions AS a
      SET "firstCareAt" = datos.fecha
      FROM (SELECT unnest(${idsLote}::int[]) AS id, unnest(${fechasLote}::timestamptz[]) AS fecha) AS datos
      WHERE a.id = datos.id AND a."firstCareAt" IS NULL
    `;
    resumen.insertadas += filas;
    resumen.duplicadas += idsLote.length - filas;
    idsLote.length = 0;
    fechasLote.length = 0;
  };

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_ATENCION)) {
    resumen.procesadas += 1;
    const parseo = atencionSchema.safeParse(zip(CAMPOS_ATENCION, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }
    if (!idsIngresos.has(parseo.data.admissionId)) {
      huerfanas += 1;
      errores.agregar(numero, `ingreso ${parseo.data.admissionId} no encontrado en el extracto`);
      continue;
    }
    idsLote.push(parseo.data.admissionId);
    fechasLote.push(parseo.data.firstCareAt);
    if (idsLote.length >= LOTE) await volcar();
  }
  await volcar();

  if (huerfanas > 0) resumen.avisos.push(`${huerfanas} atencion(es) sin ingreso correspondiente en el extracto`);
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return resumen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogos derivados: Procedure (de Servicios.txt) y Medication (de MedicamentoInsumo.txt)
// ─────────────────────────────────────────────────────────────────────────────

/** Primera pasada de un archivo grande: solo cuenta codigo->nombre, no inserta nada. */
async function construirCatalogo(rutaArchivo: string, cabecera: string[], indiceCodigo: number, indiceNombre: number): Promise<Map<string, string>> {
  const frecuencias = new Map<string, Map<string, number>>();
  for await (const { campos } of leerFilas(rutaArchivo, cabecera)) {
    const codigo = (campos[indiceCodigo] ?? '').trim();
    const nombre = (campos[indiceNombre] ?? '').trim();
    if (codigo === '' || nombre === '') continue;
    let porNombre = frecuencias.get(codigo);
    if (!porNombre) {
      porNombre = new Map();
      frecuencias.set(codigo, porNombre);
    }
    porNombre.set(nombre, (porNombre.get(nombre) ?? 0) + 1);
  }
  return elegirMasFrecuente(frecuencias);
}

async function insertarProcedimientos(ganadores: Map<string, string>): Promise<number> {
  const datos: Prisma.ProcedureCreateManyInput[] = [...ganadores].map(([code, name]) => ({ code, name }));
  return insertarEnLotes(datos, (d) => prisma.procedure.createMany({ data: d, skipDuplicates: true }));
}

async function insertarMedicamentos(ganadores: Map<string, string>): Promise<number> {
  const datos: Prisma.MedicationCreateManyInput[] = [...ganadores].map(([code, name]) => ({ code, name, kind: tipoMedicamento(code) }));
  return insertarEnLotes(datos, (d) => prisma.medication.createMany({ data: d, skipDuplicates: true }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Servicios.txt -> ServiceRecord
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_SERVICIOS = ['OidIngreso', 'CodigoServicio', 'NombreServicio', 'Cantidad', 'FechaPrestacion', 'CodigoAreaServicio', 'AreaServicio', 'Especialidad', 'OidS'];
const CAMPOS_SERVICIOS = ['admissionId', 'code', '_nombre', 'quantity', 'providedAt', 'areaCode', 'area', 'specialty', 'id'];
const INDICE_NOMBRE_SERVICIO = CABECERA_SERVICIOS.indexOf('NombreServicio');
const INDICE_CODIGO_SERVICIO = CABECERA_SERVICIOS.indexOf('CodigoServicio');

const servicioSchema = z.object({
  admissionId: enteroRequerido('OidIngreso'),
  code: textoRequerido('CodigoServicio'),
  quantity: enteroRequerido('Cantidad'),
  providedAt: fechaHisRequerida('FechaPrestacion'),
  areaCode: textoRequerido('CodigoAreaServicio'),
  area: textoRequerido('AreaServicio'),
  specialty: textoRequerido('Especialidad'),
  id: enteroRequerido('OidS'),
});

async function procesarServicios(rutaArchivo: string, idsIngresos: Set<number>): Promise<ResumenArchivo> {
  const resumen = nuevoResumen('Servicios.txt');
  const errores = new AcumuladorErrores();
  const lote: Prisma.ServiceRecordCreateManyInput[] = [];
  let huerfanos = 0;

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_SERVICIOS)) {
    resumen.procesadas += 1;
    const parseo = servicioSchema.safeParse(zip(CAMPOS_SERVICIOS, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }
    if (!idsIngresos.has(parseo.data.admissionId)) {
      huerfanos += 1;
      errores.agregar(numero, `ingreso ${parseo.data.admissionId} no encontrado en el extracto`);
      continue;
    }
    lote.push(parseo.data);
    if (lote.length >= LOTE) {
      const r = await volcarLote(lote, (datos) => prisma.serviceRecord.createMany({ data: datos, skipDuplicates: true }));
      resumen.insertadas += r.insertadas;
      resumen.duplicadas += r.duplicadas;
    }
  }
  const resto = await volcarLote(lote, (datos) => prisma.serviceRecord.createMany({ data: datos, skipDuplicates: true }));
  resumen.insertadas += resto.insertadas;
  resumen.duplicadas += resto.duplicadas;

  if (huerfanos > 0) resumen.avisos.push(`${huerfanos} servicio(s) con ingreso huerfano`);
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return resumen;
}

// ─────────────────────────────────────────────────────────────────────────────
// MedicamentoInsumo.txt -> MedicationDispense
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_MEDICAMENTOS = ['OidIngreso', 'CodigoServicio', 'NombreServicio', 'Cantidad', 'FechaPrestacion', 'AreaServicio', 'Especialidad', 'OidMI'];
const CAMPOS_MEDICAMENTOS = ['admissionId', 'code', '_nombre', 'quantity', 'dispensedAt', 'area', 'specialty', 'id'];
const INDICE_NOMBRE_MEDICAMENTO = CABECERA_MEDICAMENTOS.indexOf('NombreServicio');
const INDICE_CODIGO_MEDICAMENTO = CABECERA_MEDICAMENTOS.indexOf('CodigoServicio');

const medicamentoSchema = z.object({
  admissionId: enteroRequerido('OidIngreso'),
  code: textoRequerido('CodigoServicio'),
  quantity: enteroRequerido('Cantidad'),
  dispensedAt: fechaHisRequerida('FechaPrestacion'),
  area: textoRequerido('AreaServicio'),
  specialty: textoRequerido('Especialidad'),
  id: enteroRequerido('OidMI'),
});

async function procesarMedicamentos(rutaArchivo: string, idsIngresos: Set<number>): Promise<ResumenArchivo> {
  const resumen = nuevoResumen('MedicamentoInsumo.txt');
  const errores = new AcumuladorErrores();
  const lote: Prisma.MedicationDispenseCreateManyInput[] = [];
  let huerfanos = 0;

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_MEDICAMENTOS)) {
    resumen.procesadas += 1;
    const parseo = medicamentoSchema.safeParse(zip(CAMPOS_MEDICAMENTOS, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }
    if (!idsIngresos.has(parseo.data.admissionId)) {
      huerfanos += 1;
      errores.agregar(numero, `ingreso ${parseo.data.admissionId} no encontrado en el extracto`);
      continue;
    }
    lote.push(parseo.data);
    if (lote.length >= LOTE) {
      const r = await volcarLote(lote, (datos) => prisma.medicationDispense.createMany({ data: datos, skipDuplicates: true }));
      resumen.insertadas += r.insertadas;
      resumen.duplicadas += r.duplicadas;
    }
  }
  const resto = await volcarLote(lote, (datos) => prisma.medicationDispense.createMany({ data: datos, skipDuplicates: true }));
  resumen.insertadas += resto.insertadas;
  resumen.duplicadas += resto.duplicadas;

  if (huerfanos > 0) resumen.avisos.push(`${huerfanos} dispensacion(es) con ingreso huerfano`);
  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return resumen;
}

// ─────────────────────────────────────────────────────────────────────────────
// ProgramacionCirugia.txt -> SurgerySchedule
// ─────────────────────────────────────────────────────────────────────────────

const CABECERA_CIRUGIA = ['ConsecutivoProgramacion', 'IdPaciente', 'OidIngreso', 'CodigoServicio'];
const CAMPOS_CIRUGIA = ['scheduleNumber', 'patientId', 'admissionId', 'procedureCode'];

// Sin FK a proposito (ver comentario en schema.prisma): patientId y
// admissionId se guardan tal cual vienen, sin comprobar que existan en el
// extracto de Paciente/Ingresos.
const cirugiaSchema = z.object({
  scheduleNumber: textoRequerido('ConsecutivoProgramacion'),
  patientId: enteroRequerido('IdPaciente'),
  admissionId: enteroOpcional(),
  procedureCode: textoRequerido('CodigoServicio'),
});

/** Timeout generoso para la transaccion de recarga: ~13.000 filas reales en unos pocos lotes. */
const TIMEOUT_TRANSACCION_CIRUGIAS_MS = 60_000;

async function procesarCirugias(rutaArchivo: string): Promise<ResumenArchivo> {
  const resumen = nuevoResumen('ProgramacionCirugia.txt');
  const errores = new AcumuladorErrores();
  const lote: Prisma.SurgeryScheduleCreateManyInput[] = [];
  // Deduplicacion en memoria por contenido exacto de la fila: no hay PK
  // natural (el id es autoincrement) y ~2.400 filas tienen OidIngreso vacio.
  const vistos = new Set<string>();

  for await (const { numero, campos } of leerFilas(rutaArchivo, CABECERA_CIRUGIA)) {
    resumen.procesadas += 1;
    const clave = campos.join('|');
    if (vistos.has(clave)) {
      resumen.duplicadas += 1;
      continue;
    }
    vistos.add(clave);

    const parseo = cirugiaSchema.safeParse(zip(CAMPOS_CIRUGIA, campos));
    if (!parseo.success) {
      errores.agregar(numero, describirError(parseo.error));
      continue;
    }
    // executed se recalcula al final con SQL estatico, tras cargar ServiceRecord.
    lote.push({ ...parseo.data, executed: 'desconocido' });
  }

  /**
   * his_surgery_schedules no tiene PK natural (el id es autoincrement) y el
   * @@unique compuesto no basta para idempotencia: Postgres no trata dos NULL
   * de "admissionId" como iguales, asi que un `skipDuplicates` reinsertaria
   * las ~2.400 filas con OidIngreso vacio en cada relanzamiento. La tabla no
   * tiene dependientes (nada le apunta por FK) y se deriva integramente de
   * este archivo, asi que en vez de "mezclar" con lo que ya hubiera, se
   * recarga entera dentro de una transaccion: borra todo e inserta el lote ya
   * deduplicado. Un rerun deja siempre el mismo contenido exacto, nunca duplica.
   *
   * (Esto SOLO vale para `importarDirectorio`, que carga el archivo COMPLETO.
   * `importarTabla` -TC1, un archivo parcial subido por API- NO puede borrar
   * la tabla entera: vease su propia seccion mas abajo.)
   */
  await prisma.$transaction(
    async (tx) => {
      await tx.surgerySchedule.deleteMany();
      for (let i = 0; i < lote.length; i += LOTE) {
        await tx.surgerySchedule.createMany({ data: lote.slice(i, i + LOTE) });
      }
    },
    { timeout: TIMEOUT_TRANSACCION_CIRUGIAS_MS },
  );
  resumen.insertadas = lote.length;

  resumen.errores = errores.lista;
  resumen.invalidas = errores.total;
  return resumen;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador: carga completa de un directorio (T6, CLI)
// ─────────────────────────────────────────────────────────────────────────────

export async function importarDirectorio(dir: string): Promise<ResumenImportacion> {
  const inicio = Date.now();
  const ruta = (archivo: string): string => path.join(dir, archivo);

  const pacientes = await procesarPacientes(ruta('Paciente.txt'));
  const triages = await procesarTriages(ruta('Triage.txt'), pacientes.ids);
  const normalizacionRiesgo = await calcularNormalizacionRiesgo(ruta('Ingresos.txt'));
  const ingresos = await procesarIngresos(ruta('Ingresos.txt'), pacientes.ids, triages.ids, normalizacionRiesgo);
  const atenciones = await procesarAtenciones(ruta('Atencion.txt'), ingresos.ids);

  const ganadoresProcedimientos = await construirCatalogo(ruta('Servicios.txt'), CABECERA_SERVICIOS, INDICE_CODIGO_SERVICIO, INDICE_NOMBRE_SERVICIO);
  const procedimientosInsertadas = await insertarProcedimientos(ganadoresProcedimientos);
  const servicios = await procesarServicios(ruta('Servicios.txt'), ingresos.ids);

  const ganadoresMedicamentos = await construirCatalogo(ruta('MedicamentoInsumo.txt'), CABECERA_MEDICAMENTOS, INDICE_CODIGO_MEDICAMENTO, INDICE_NOMBRE_MEDICAMENTO);
  const medicamentosCatalogoInsertadas = await insertarMedicamentos(ganadoresMedicamentos);
  const medicamentos = await procesarMedicamentos(ruta('MedicamentoInsumo.txt'), ingresos.ids);

  const cirugias = await procesarCirugias(ruta('ProgramacionCirugia.txt'));

  // Sin filtro: recalcula TODOS los ingresos, igual que siempre (los CRUD de
  // TC2-TC4 y `importarTabla` (TC1) sí pasan `admissionIds` para acotar el
  // recalculo a lo que tocaron).
  await recalcularDerivados(prisma);
  // Un import puede mover el max(admittedAt): sin esto, la fecha de
  // referencia del dashboard/analitica quedaria obsoleta hasta 5 min despues.
  invalidarFechaReferencia();

  const archivos: ResumenArchivo[] = [
    pacientes.resumen,
    triages.resumen,
    ingresos.resumen,
    atenciones,
    resumenCatalogo('his_procedures (catalogo, de Servicios.txt)', ganadoresProcedimientos.size, procedimientosInsertadas),
    servicios,
    resumenCatalogo('his_medications (catalogo, de MedicamentoInsumo.txt)', ganadoresMedicamentos.size, medicamentosCatalogoInsertadas),
    medicamentos,
    cirugias,
  ];

  return { archivos, ms: Date.now() - inicio };
}

// ═════════════════════════════════════════════════════════════════════════════
// TC1 — Imports por API: `importarTabla`, un archivo/tabla a la vez
// ═════════════════════════════════════════════════════════════════════════════

/** Nombres de tabla de la API (`POST /imports/:table`). Cada uno casa con un archivo HIS. */
export const TABLAS_IMPORTABLES = [
  'patients',
  'admissions',
  'triages',
  'first-care',
  'service-records',
  'dispenses',
  'surgery-schedules',
] as const;

export type TablaImportable = (typeof TABLAS_IMPORTABLES)[number];

export interface ResumenTabla {
  table: TablaImportable;
  /** Separador detectado: '|' (nativo) o ',' / ';' (RFC 4180 con comillas). */
  delimiter: string;
  procesadas: number;
  insertadas: number;
  duplicadas: number;
  vacias: number;
  invalidas: number;
  avisos: string[];
  /** Primeros 50 errores (linea + motivo), nunca datos de paciente. */
  errores: ErrorFila[];
}

export interface OpcionesImportarTabla {
  /** Tamaño de lote para insertar/comprobar FK. Por defecto 5000; los tests lo bajan para ejercitar el borde del lote con fixtures pequeños. */
  tamanoLote?: number;
}

/** Limite de errores detallados que se guardan en el ImportJob (spec TC1: "primeros 50"). */
const LIMITE_ERRORES_API = 50;

// ─── Parser RFC 4180 escrito a mano (streaming, sin dependencias) ──────────

export interface FilaCsv {
  numero: number;
  campos: string[];
}

/**
 * Maquina de estados de un parser CSV por caracter. Separado de la lectura de
 * disco para poder probarlo con `parsearCsvTexto` (tests unitarios) sin tocar
 * el filesystem, y reutilizado por `leerFilasCsv` (streaming real).
 *
 * Reglas RFC 4180 que cubre: campo entre comillas puede contener el propio
 * delimitador, saltos de linea (CRLF o LF) y comillas escapadas duplicandolas
 * (`""`). Una comilla dentro de un campo SIN comillas se trata como comienzo
 * de campo citado (los archivos nativos del HIS, sin comillas, nunca traen
 * este caracter, asi que el mismo parser sirve para los dos formatos).
 *
 * El estado `comillaPendiente` (en vez de mirar el caracter siguiente con un
 * indice `chunk[i+1]`) es lo que hace el parser correcto tambien cuando una
 * comilla escapada cae justo en el borde de dos trozos (`chunk`) del stream:
 * todo el estado vive en variables, nunca en una mirada hacia adelante dentro
 * del mismo array.
 */
function crearParserCsv(delimitador: string) {
  let campo = '';
  let fila: string[] = [];
  let dentro = false;
  let comillaPendiente = false;
  let numero = 0;
  let filaConContenido = false;

  function finDeFila(): FilaCsv {
    fila.push(campo);
    campo = '';
    numero += 1;
    filaConContenido = false;
    const actual = fila;
    fila = [];
    return { numero, campos: actual };
  }

  function procesarCaracter(c: string): FilaCsv | null {
    if (comillaPendiente) {
      comillaPendiente = false;
      if (c === '"') {
        campo += '"';
        filaConContenido = true;
        return null;
      }
      dentro = false;
      // La comilla anterior cerraba el campo: este caracter se procesa ya
      // fuera de comillas (no se descarta).
      return procesarCaracter(c);
    }
    if (dentro) {
      if (c === '"') {
        comillaPendiente = true;
        return null;
      }
      campo += c;
      filaConContenido = true;
      return null;
    }
    if (c === '"') {
      dentro = true;
      filaConContenido = true;
      return null;
    }
    if (c === delimitador) {
      fila.push(campo);
      campo = '';
      filaConContenido = true;
      return null;
    }
    if (c === '\r') return null;
    if (c === '\n') return finDeFila();
    campo += c;
    filaConContenido = true;
    return null;
  }

  function finalizar(): FilaCsv | null {
    if (!filaConContenido && campo === '' && fila.length === 0) return null;
    return finDeFila();
  }

  return { procesarCaracter, finalizar };
}

/** Solo para tests unitarios del parser: parsea una cadena completa en memoria, sin tocar disco. */
export function parsearCsvTexto(texto: string, delimitador: string): string[][] {
  const parser = crearParserCsv(delimitador);
  const filas: string[][] = [];
  for (const c of texto) {
    const fila = parser.procesarCaracter(c);
    if (fila) filas.push(fila.campos);
  }
  const ultima = parser.finalizar();
  if (ultima) filas.push(ultima.campos);
  return filas;
}

function cabeceraCoincide(recibida: readonly string[], esperada: readonly string[]): boolean {
  return recibida.length === esperada.length && recibida.every((v, i) => v === esperada[i]);
}

function mensajeCabeceraInvalida(ruta: string, delimitador: string, esperada: readonly string[], recibida: readonly string[]): string {
  return `Cabecera invalida en ${ruta}.\n  esperada: ${esperada.join(delimitador)}\n  recibida: ${recibida.join(delimitador)}`;
}

/** Lee solo la primera linea fisica del archivo (para detectar el delimitador sin leerlo entero). */
async function leerPrimeraLinea(ruta: string): Promise<string> {
  const stream = fs.createReadStream(ruta, { encoding: 'utf-8' });
  const flujo = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const linea of flujo) return linea;
    return '';
  } finally {
    flujo.close();
    stream.destroy();
  }
}

const DELIMITADORES_CANDIDATOS = ['|', ',', ';'] as const;

/**
 * Detecta el separador probando la cabecera contra cada candidato, en orden:
 * `|` (formato nativo del HIS, sin comillas) primero, luego `,` y `;` (RFC
 * 4180 con comillas). El mismo parser sirve para los tres: un archivo nativo
 * nunca trae comillas, asi que aplicarle el parser "con comillas" no cambia nada.
 */
async function detectarDelimitador(ruta: string, cabeceraEsperada: readonly string[]): Promise<string> {
  const primeraLinea = await leerPrimeraLinea(ruta);
  let candidatoConMismoNumeroDeColumnas: { delimitador: string; campos: string[] } | null = null;

  for (const delimitador of DELIMITADORES_CANDIDATOS) {
    const [campos] = parsearCsvTexto(primeraLinea, delimitador);
    if (!campos) continue;
    if (cabeceraCoincide(campos, cabeceraEsperada)) return delimitador;
    // El separador correcto suele ser el UNICO que produce el numero exacto de
    // columnas esperado (los otros dos, sobre la misma linea, casi siempre
    // producen una sola columna gigante o un numero muy distinto). Guardarlo
    // permite dar un error de "cabecera invalida" (que columna difiere) en vez
    // de un generico "separador no reconocido" cuando el separador SI era el
    // correcto y lo que falla es el nombre/orden de alguna columna.
    if (!candidatoConMismoNumeroDeColumnas && campos.length === cabeceraEsperada.length) {
      candidatoConMismoNumeroDeColumnas = { delimitador, campos };
    }
  }

  if (candidatoConMismoNumeroDeColumnas) {
    throw new Error(
      mensajeCabeceraInvalida(ruta, candidatoConMismoNumeroDeColumnas.delimitador, cabeceraEsperada, candidatoConMismoNumeroDeColumnas.campos),
    );
  }
  throw new Error(
    `No se reconoce el separador de la cabecera (se probaron "|", "," y ";").\n` +
      `  esperada: ${cabeceraEsperada.join('|')}\n  recibida: ${primeraLinea}`,
  );
}

/** Generador streaming de filas ya separadas por `delimitador`, saltando y validando la cabecera. */
async function* leerFilasCsv(
  ruta: string,
  delimitador: string,
  cabeceraEsperada: readonly string[],
): AsyncGenerator<FilaCsv> {
  const parser = crearParserCsv(delimitador);
  const stream = fs.createReadStream(ruta, { encoding: 'utf-8' });
  let vistoCabecera = false;

  for await (const chunk of stream as AsyncIterable<string>) {
    for (const c of chunk) {
      const fila = parser.procesarCaracter(c);
      if (!fila) continue;
      if (!vistoCabecera) {
        if (!cabeceraCoincide(fila.campos, cabeceraEsperada)) {
          throw new Error(mensajeCabeceraInvalida(ruta, delimitador, cabeceraEsperada, fila.campos));
        }
        vistoCabecera = true;
        continue;
      }
      yield fila;
    }
  }

  const ultima = parser.finalizar();
  if (ultima) {
    if (!vistoCabecera) {
      if (!cabeceraCoincide(ultima.campos, cabeceraEsperada)) {
        throw new Error(mensajeCabeceraInvalida(ruta, delimitador, cabeceraEsperada, ultima.campos));
      }
      return;
    }
    yield ultima;
  }
}

// ─── Comprobacion de FK por lote (contra la BD, no contra Sets de otro archivo) ──

/** ids de `his_patients` que existen, de entre los pedidos. */
async function idsPacientesExistentes(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const filas = await prisma.patient.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(filas.map((f) => f.id));
}

async function idsTriagesExistentes(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const filas = await prisma.triage.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(filas.map((f) => f.id));
}

async function idsAdmisionesExistentes(ids: number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const filas = await prisma.admission.findMany({ where: { id: { in: ids } }, select: { id: true } });
  return new Set(filas.map((f) => f.id));
}

/**
 * TODOS los codigos ya existentes en el catalogo (Procedure/Medication).
 * Estas dos tablas son PEQUEÑAS incluso con el extracto real completo (~2.061
 * y ~1.327 codigos, B0): cargarlas enteras UNA vez, al principio de
 * `importarServiciosLote`/`importarDispensacionesLote`, es mas barato que
 * repetir una consulta "¿ya existe este codigo?" en cada uno de los ~116
 * lotes de 5.000 filas (579.465 dispensaciones / 5.000), que ademas
 * dispararia un `createMany` de relleno en casi todos ellos (los codigos ya
 * estarian todos alli, pero el lote no lo sabria hasta preguntar).
 */
async function todosLosCodigosProcedimientos(): Promise<Set<string>> {
  const filas = await prisma.procedure.findMany({ select: { code: true } });
  return new Set(filas.map((f) => f.code));
}

async function todosLosCodigosMedicamentos(): Promise<Set<string>> {
  const filas = await prisma.medication.findMany({ select: { code: true } });
  return new Set(filas.map((f) => f.code));
}

/**
 * Da de alta en el catalogo (Procedure o Medication) los codigos de este
 * lote que aun no existen, usando el PRIMER nombre visto para ese codigo en
 * el lote (no el "mas frecuente" de todo el archivo: eso exigiria una
 * primera pasada completa como hace `importarDirectorio`, y aqui procesamos
 * el archivo en una sola pasada por lotes). ServiceRecord.code y
 * MedicationDispense.code son FK REALES a estos catalogos (schema.prisma):
 * sin esto, insertar el lote fallaria con una violacion de FK (P2003) por
 * cada codigo nuevo.
 */
async function asegurarCatalogoProcedimientos(nombrePorCodigo: Map<string, string>, conocidos: Set<string>): Promise<void> {
  const nuevos = [...nombrePorCodigo].filter(([code]) => !conocidos.has(code));
  if (nuevos.length === 0) return;
  await prisma.procedure.createMany({
    data: nuevos.map(([code, name]) => ({ code, name })),
    skipDuplicates: true,
  });
  for (const [code] of nuevos) conocidos.add(code);
}

async function asegurarCatalogoMedicamentos(nombrePorCodigo: Map<string, string>, conocidos: Set<string>): Promise<void> {
  const nuevos = [...nombrePorCodigo].filter(([code]) => !conocidos.has(code));
  if (nuevos.length === 0) return;
  await prisma.medication.createMany({
    data: nuevos.map(([code, name]) => ({ code, name, kind: tipoMedicamento(code) })),
    skipDuplicates: true,
  });
  for (const [code] of nuevos) conocidos.add(code);
}

/** Evalua las alertas tras un import. Nunca revienta el resultado ya guardado del job: solo se loguea. */
async function evaluarAlertasSinRomperElImport(): Promise<void> {
  try {
    const { evaluarAlertas } = await import('../alerts/alerts.job');
    await evaluarAlertas();
  } catch (error) {
    // El import ya termino bien (los datos estan guardados): un fallo del
    // motor de alertas no debe reportarse como fallo de la importacion.
    logger.error({ err: error }, 'La evaluacion de alertas tras un import fallo (los datos importados no se ven afectados)');
  }
}

interface AcumuladorTabla {
  procesadas: number;
  insertadas: number;
  duplicadas: number;
  vacias: number;
  admissionIds: Set<number>;
}

function nuevoAcumulador(): AcumuladorTabla {
  return { procesadas: 0, insertadas: 0, duplicadas: 0, vacias: 0, admissionIds: new Set() };
}

/** Agrupa filas ya parseadas por Zod en lotes de tamaño fijo, llamando a `procesarLote` con cada uno. */
async function porLotes<T>(items: AsyncGenerator<T>, tamano: number, procesarLote: (lote: T[]) => Promise<void>): Promise<void> {
  let lote: T[] = [];
  for await (const item of items) {
    lote.push(item);
    if (lote.length >= tamano) {
      await procesarLote(lote);
      lote = [];
    }
  }
  if (lote.length > 0) await procesarLote(lote);
}

// ─── Un handler por tabla: parsea + comprueba FK + inserta, lote a lote ────

async function importarPacientesLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
): Promise<{ acc: AcumuladorTabla; idsImportados: number[] }> {
  const acc = nuevoAcumulador();
  const idsImportados: number[] = [];

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_PACIENTE), tamanoLote, async (lote) => {
    const validos: Prisma.PatientCreateManyInput[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = pacienteSchema.safeParse(zip(CAMPOS_PACIENTE, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      validos.push(parseo.data);
      idsImportados.push(parseo.data.id);
    }
    const r = await volcarLote(validos, (d) => prisma.patient.createMany({ data: d, skipDuplicates: true }));
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  return { acc, idsImportados };
}

async function importarIngresosLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
  avisos: string[],
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();
  const normalizacionRiesgo = await calcularNormalizacionRiesgoConDelimitador(ruta, delimitador);
  let pacientesHuerfanos = 0;
  let triagesHuerfanos = 0;

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_INGRESOS), tamanoLote, async (lote) => {
    const parseados: { numero: number; d: z.infer<typeof ingresoSchema> }[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = ingresoSchema.safeParse(zip(CAMPOS_INGRESOS, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      parseados.push({ numero, d: parseo.data });
    }

    const pacientesExistentes = await idsPacientesExistentes([...new Set(parseados.map((p) => p.d.patientId))]);
    const triagesPedidos = [...new Set(parseados.filter((p) => p.d.triageIdRaw !== null).map((p) => p.d.triageIdRaw as number))];
    const triagesExistentes = await idsTriagesExistentes(triagesPedidos);

    const validos: Prisma.AdmissionCreateManyInput[] = [];
    for (const { numero, d } of parseados) {
      if (!pacientesExistentes.has(d.patientId)) {
        pacientesHuerfanos += 1;
        errores.agregar(numero, `paciente ${d.patientId} no encontrado`);
        continue;
      }
      if (d.triageIdRaw !== null && !triagesExistentes.has(d.triageIdRaw)) {
        triagesHuerfanos += 1;
        errores.agregar(numero, `triage ${d.triageIdRaw} no encontrado`);
        continue;
      }
      const riskType = normalizacionRiesgo.get(d.riskTypeRaw.toLowerCase()) ?? d.riskTypeRaw;
      validos.push({
        id: d.id,
        consecutive: d.consecutive,
        patientId: d.patientId,
        admissionClass: d.admissionClass,
        entryRoute: d.entryRoute,
        riskType,
        admittedAt: d.admittedAt,
        hospitalizedAt: d.hospitalizedAt,
        triageId: d.triageIdRaw,
        bedCode: d.bedCode,
        bedName: d.bedName,
        unit: d.unit,
        subunit: d.subunit,
        virtualBed: d.virtualBed,
        diagnosisCode: d.diagnosisCode,
        diagnosisName: d.diagnosisName,
      });
      acc.admissionIds.add(d.id);
    }

    const r = await volcarLote(validos, (datos) => prisma.admission.createMany({ data: datos, skipDuplicates: true }));
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  if (pacientesHuerfanos > 0) avisos.push(`${pacientesHuerfanos} ingreso(s) invalidos por paciente inexistente`);
  if (triagesHuerfanos > 0) avisos.push(`${triagesHuerfanos} ingreso(s) invalidos por triage inexistente`);
  return acc;
}

/** Igual que `calcularNormalizacionRiesgo`, pero sobre el reader generico (cualquier delimitador). */
async function calcularNormalizacionRiesgoConDelimitador(ruta: string, delimitador: string): Promise<Map<string, string>> {
  const frecuencias = new Map<string, Map<string, number>>();
  for await (const { campos } of leerFilasCsv(ruta, delimitador, CABECERA_INGRESOS)) {
    const original = (campos[INDICE_TIPO_RIESGO] ?? '').trim();
    if (original === '') continue;
    const clave = original.toLowerCase();
    let porForma = frecuencias.get(clave);
    if (!porForma) {
      porForma = new Map();
      frecuencias.set(clave, porForma);
    }
    porForma.set(original, (porForma.get(original) ?? 0) + 1);
  }
  return elegirMasFrecuente(frecuencias);
}

async function importarTriagesLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
  avisos: string[],
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();
  let huerfanos = 0;
  const idsImportados: number[] = [];

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_TRIAGE), tamanoLote, async (lote) => {
    const parseados: { numero: number; d: z.infer<typeof triageSchema> }[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      if (campos.every((c) => c.trim() === '')) {
        acc.vacias += 1;
        continue;
      }
      const parseo = triageSchema.safeParse(zip(CAMPOS_TRIAGE, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      parseados.push({ numero, d: parseo.data });
    }

    const pacientesPedidos = [...new Set(parseados.filter((p) => p.d.patientIdRaw !== null).map((p) => p.d.patientIdRaw as number))];
    const pacientesExistentes = await idsPacientesExistentes(pacientesPedidos);

    const validos: Prisma.TriageCreateManyInput[] = [];
    for (const { d } of parseados) {
      // TC6 (arreglo pendiente #3): un `IdPaciente2` huerfano NO invalida la
      // fila (a diferencia de admisiones/servicios/dispensaciones, donde el
      // ingreso huerfano SI la invalida): se acepta con `patientId: null` y un
      // aviso, coherente con la carga por CLI (B0, `procesarTriages` en este
      // mismo archivo). Antes esta ruta la rechazaba (huerfanos contados en
      // `invalidas`), distinto del importador completo para el MISMO archivo.
      let patientId = d.patientIdRaw;
      if (patientId !== null && !pacientesExistentes.has(patientId)) {
        patientId = null;
        huerfanos += 1;
      }
      validos.push({
        id: d.id,
        triagedAt: d.triagedAt,
        systolic: d.systolic,
        diastolic: d.diastolic,
        heartRate: d.heartRate,
        respiratoryRate: d.respiratoryRate,
        temperature: d.temperature,
        patientId,
        code: d.code,
        classification: d.classification,
        level: d.level,
      });
      idsImportados.push(d.id);
    }

    const r = await volcarLote(validos, (datos) => prisma.triage.createMany({ data: datos, skipDuplicates: true }));
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  if (huerfanos > 0) avisos.push(`${huerfanos} triage(s) con paciente huerfano: patientId puesto a null`);

  // Ingresos que YA existian referenciando estos triages (por si los ingresos
  // llegaron primero): sus derivados (triageLevel, waitMinutes) se recalculan.
  if (idsImportados.length > 0) {
    const admisiones = await prisma.admission.findMany({ where: { triageId: { in: idsImportados } }, select: { id: true } });
    for (const a of admisiones) acc.admissionIds.add(a.id);
  }
  return acc;
}

async function importarAtencionesLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
  avisos: string[],
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();
  let huerfanas = 0;

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_ATENCION), tamanoLote, async (lote) => {
    const parseados: { numero: number; d: z.infer<typeof atencionSchema> }[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = atencionSchema.safeParse(zip(CAMPOS_ATENCION, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      parseados.push({ numero, d: parseo.data });
    }

    const admisionesExistentes = await idsAdmisionesExistentes([...new Set(parseados.map((p) => p.d.admissionId))]);
    const idsLote: number[] = [];
    const fechasLote: Date[] = [];
    for (const { numero, d } of parseados) {
      if (!admisionesExistentes.has(d.admissionId)) {
        huerfanas += 1;
        errores.agregar(numero, `ingreso ${d.admissionId} no encontrado`);
        continue;
      }
      idsLote.push(d.admissionId);
      fechasLote.push(d.firstCareAt);
      acc.admissionIds.add(d.admissionId);
    }

    if (idsLote.length > 0) {
      // Misma guarda idempotente que el importador completo: solo actualiza
      // las filas que aun no tenian `firstCareAt`.
      const filas = await prisma.$executeRaw`
        UPDATE his_admissions AS a
        SET "firstCareAt" = datos.fecha
        FROM (SELECT unnest(${idsLote}::int[]) AS id, unnest(${fechasLote}::timestamptz[]) AS fecha) AS datos
        WHERE a.id = datos.id AND a."firstCareAt" IS NULL
      `;
      acc.insertadas += filas;
      acc.duplicadas += idsLote.length - filas;
    }
  });

  if (huerfanas > 0) avisos.push(`${huerfanas} atencion(es) invalidas por ingreso inexistente`);
  return acc;
}

async function importarServiciosLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
  avisos: string[],
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();
  const codigosConocidos = await todosLosCodigosProcedimientos();
  let huerfanos = 0;

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_SERVICIOS), tamanoLote, async (lote) => {
    const parseados: { numero: number; nombre: string; d: z.infer<typeof servicioSchema> }[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = servicioSchema.safeParse(zip(CAMPOS_SERVICIOS, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      parseados.push({ numero, nombre: (campos[INDICE_NOMBRE_SERVICIO] ?? '').trim(), d: parseo.data });
    }

    const admisionesExistentes = await idsAdmisionesExistentes([...new Set(parseados.map((p) => p.d.admissionId))]);

    const nombrePorCodigo = new Map<string, string>();
    for (const { nombre, d } of parseados) {
      if (nombre !== '' && !nombrePorCodigo.has(d.code)) nombrePorCodigo.set(d.code, nombre);
    }
    await asegurarCatalogoProcedimientos(nombrePorCodigo, codigosConocidos);

    const validos: Prisma.ServiceRecordCreateManyInput[] = [];
    for (const { numero, d } of parseados) {
      if (!admisionesExistentes.has(d.admissionId)) {
        huerfanos += 1;
        errores.agregar(numero, `ingreso ${d.admissionId} no encontrado`);
        continue;
      }
      if (!codigosConocidos.has(d.code)) {
        // Sin nombre en esta fila (columna vacia) y el codigo tampoco existia
        // ya en el catalogo: no hay forma de darlo de alta sin violar la FK.
        errores.agregar(numero, `codigo de procedimiento "${d.code}" desconocido (sin nombre para darlo de alta)`);
        continue;
      }
      validos.push(d);
      acc.admissionIds.add(d.admissionId);
    }

    const r = await volcarLote(validos, (datos) => prisma.serviceRecord.createMany({ data: datos, skipDuplicates: true }));
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  if (huerfanos > 0) avisos.push(`${huerfanos} servicio(s) invalidos por ingreso inexistente`);
  return acc;
}

async function importarDispensacionesLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
  avisos: string[],
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();
  const codigosConocidos = await todosLosCodigosMedicamentos();
  let huerfanos = 0;

  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_MEDICAMENTOS), tamanoLote, async (lote) => {
    const parseados: { numero: number; nombre: string; d: z.infer<typeof medicamentoSchema> }[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = medicamentoSchema.safeParse(zip(CAMPOS_MEDICAMENTOS, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      parseados.push({ numero, nombre: (campos[INDICE_NOMBRE_MEDICAMENTO] ?? '').trim(), d: parseo.data });
    }

    const admisionesExistentes = await idsAdmisionesExistentes([...new Set(parseados.map((p) => p.d.admissionId))]);

    const nombrePorCodigo = new Map<string, string>();
    for (const { nombre, d } of parseados) {
      if (nombre !== '' && !nombrePorCodigo.has(d.code)) nombrePorCodigo.set(d.code, nombre);
    }
    await asegurarCatalogoMedicamentos(nombrePorCodigo, codigosConocidos);

    const validos: Prisma.MedicationDispenseCreateManyInput[] = [];
    for (const { numero, d } of parseados) {
      if (!admisionesExistentes.has(d.admissionId)) {
        huerfanos += 1;
        errores.agregar(numero, `ingreso ${d.admissionId} no encontrado`);
        continue;
      }
      if (!codigosConocidos.has(d.code)) {
        errores.agregar(numero, `codigo de medicamento/insumo "${d.code}" desconocido (sin nombre para darlo de alta)`);
        continue;
      }
      validos.push(d);
      acc.admissionIds.add(d.admissionId);
    }

    const r = await volcarLote(validos, (datos) => prisma.medicationDispense.createMany({ data: datos, skipDuplicates: true }));
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  if (huerfanos > 0) avisos.push(`${huerfanos} dispensacion(es) invalidas por ingreso inexistente`);
  return acc;
}

async function importarCirugiasLote(
  ruta: string,
  delimitador: string,
  tamanoLote: number,
  errores: AcumuladorErrores,
): Promise<AcumuladorTabla> {
  const acc = nuevoAcumulador();

  // A diferencia de `procesarCirugias` (carga completa: borra y recarga la
  // tabla entera), aqui NO se puede vaciar la tabla: un archivo parcial
  // subido por API borraria las cirugias creadas por CRUD y las de cargas
  // anteriores. Se anexa con `createMany({ skipDuplicates: true })`, que
  // dedupe por el indice unico compuesto EXCEPTO en las filas con
  // `admissionId = null` (Postgres no iguala dos NULL: dos subidas del mismo
  // archivo duplicarian esas filas sin parar). TC6 (arreglo pendiente #2):
  // esas filas se dedupean a mano, comparando contra lo que ya hay en BD con
  // `admissionId IS NULL` (equivalente a `IS NOT DISTINCT FROM` para el caso
  // null) y contra el propio lote, sin tocar lo que ya insertaron el CRUD ni
  // cargas previas con ingreso.
  await porLotes(leerFilasCsv(ruta, delimitador, CABECERA_CIRUGIA), tamanoLote, async (lote) => {
    const validos: Prisma.SurgeryScheduleCreateManyInput[] = [];
    for (const { numero, campos } of lote) {
      acc.procesadas += 1;
      const parseo = cirugiaSchema.safeParse(zip(CAMPOS_CIRUGIA, campos));
      if (!parseo.success) {
        errores.agregar(numero, describirError(parseo.error));
        continue;
      }
      validos.push({ ...parseo.data, executed: 'desconocido' });
      if (parseo.data.admissionId !== null) acc.admissionIds.add(parseo.data.admissionId);
    }

    const conIngreso = validos.filter((v) => v.admissionId !== null);
    const sinIngreso = validos.filter((v) => v.admissionId === null);
    const nuevosSinIngreso = await filtrarCirugiasSinIngresoYaExistentes(sinIngreso);
    acc.duplicadas += sinIngreso.length - nuevosSinIngreso.length;

    const r = await volcarLote(
      [...conIngreso, ...nuevosSinIngreso],
      (datos) => prisma.surgerySchedule.createMany({ data: datos, skipDuplicates: true }),
    );
    acc.insertadas += r.insertadas;
    acc.duplicadas += r.duplicadas;
  });

  return acc;
}

/**
 * De las filas SIN ingreso (`admissionId: null`) de este lote, descarta las
 * que ya existen en BD con la misma clave natural (`scheduleNumber` +
 * `patientId` + `procedureCode`, admissionId IS NULL) y las que se repiten
 * DENTRO del propio lote (el archivo trae 276 duplicados exactos, B0). El
 * filtro por `scheduleNumber IN (...)` mantiene la consulta barata incluso
 * con miles de filas por lote; el resto de la clave se compara en memoria.
 */
async function filtrarCirugiasSinIngresoYaExistentes(
  sinIngreso: Prisma.SurgeryScheduleCreateManyInput[],
): Promise<Prisma.SurgeryScheduleCreateManyInput[]> {
  if (sinIngreso.length === 0) return [];

  const numerosPedidos = [...new Set(sinIngreso.map((v) => v.scheduleNumber))];
  const existentes = await prisma.surgerySchedule.findMany({
    where: { admissionId: null, scheduleNumber: { in: numerosPedidos } },
    select: { scheduleNumber: true, patientId: true, procedureCode: true },
  });

  const clave = (v: { scheduleNumber: string; patientId: number; procedureCode: string }): string =>
    `${v.scheduleNumber}\u0000${v.patientId}\u0000${v.procedureCode}`;
  const vistos = new Set(existentes.map(clave));

  const nuevos: Prisma.SurgeryScheduleCreateManyInput[] = [];
  for (const fila of sinIngreso) {
    const k = clave(fila);
    if (vistos.has(k)) continue;
    vistos.add(k); // tambien dedupe DENTRO del propio lote/archivo
    nuevos.push(fila);
  }
  return nuevos;
}

/**
 * Importa UN archivo (subido por API) a la tabla de la API indicada.
 * `tabla` -> archivo HIS: patients -> Paciente.txt, admissions -> Ingresos.txt,
 * triages -> Triage.txt, first-care -> Atencion.txt, service-records ->
 * Servicios.txt, dispenses -> MedicamentoInsumo.txt, surgery-schedules ->
 * ProgramacionCirugia.txt. El nombre del archivo en si no importa (se sube
 * como cuerpo de la peticion); solo su CONTENIDO (cabecera + filas) debe
 * casar con la tabla elegida.
 */
export async function importarTabla(
  tabla: TablaImportable,
  rutaArchivo: string,
  opts: OpcionesImportarTabla = {},
): Promise<ResumenTabla> {
  const tamanoLote = opts.tamanoLote ?? LOTE;
  const errores = new AcumuladorErrores(LIMITE_ERRORES_API);
  const avisos: string[] = [];

  const cabeceraPorTabla: Record<TablaImportable, readonly string[]> = {
    patients: CABECERA_PACIENTE,
    admissions: CABECERA_INGRESOS,
    triages: CABECERA_TRIAGE,
    'first-care': CABECERA_ATENCION,
    'service-records': CABECERA_SERVICIOS,
    dispenses: CABECERA_MEDICAMENTOS,
    'surgery-schedules': CABECERA_CIRUGIA,
  };

  const delimitador = await detectarDelimitador(rutaArchivo, cabeceraPorTabla[tabla]);

  let acc: AcumuladorTabla;
  switch (tabla) {
    case 'patients': {
      const r = await importarPacientesLote(rutaArchivo, delimitador, tamanoLote, errores);
      acc = r.acc;
      break;
    }
    case 'admissions':
      acc = await importarIngresosLote(rutaArchivo, delimitador, tamanoLote, errores, avisos);
      break;
    case 'triages':
      acc = await importarTriagesLote(rutaArchivo, delimitador, tamanoLote, errores, avisos);
      break;
    case 'first-care':
      acc = await importarAtencionesLote(rutaArchivo, delimitador, tamanoLote, errores, avisos);
      break;
    case 'service-records':
      acc = await importarServiciosLote(rutaArchivo, delimitador, tamanoLote, errores, avisos);
      break;
    case 'dispenses':
      acc = await importarDispensacionesLote(rutaArchivo, delimitador, tamanoLote, errores, avisos);
      break;
    case 'surgery-schedules':
      acc = await importarCirugiasLote(rutaArchivo, delimitador, tamanoLote, errores);
      break;
  }

  const admissionIds = [...acc.admissionIds];
  if (admissionIds.length > 0) {
    // Acotado a los ingresos tocados: un import parcial no debe recalcular
    // los ~18.000 restantes (a diferencia de `importarDirectorio`, que SI
    // recalcula todo porque siempre carga el extracto completo).
    await recalcularDerivados(prisma, { admissionIds });
  }
  invalidarFechaReferencia();
  await evaluarAlertasSinRomperElImport();

  return {
    table: tabla,
    delimiter: delimitador,
    procesadas: acc.procesadas,
    insertadas: acc.insertadas,
    duplicadas: acc.duplicadas,
    vacias: acc.vacias,
    invalidas: errores.total,
    avisos,
    errores: errores.lista,
  };
}
