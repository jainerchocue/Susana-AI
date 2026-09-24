import '../bootstrap';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma, disconnectDatabase } from '../core/db/prisma';
import { HIS_ZONA_HORARIA } from '../modules/his/his.periodo';

/**
 * Importador de los datos HIS (fase B, T6). Lee los 7 `.txt` de un directorio
 * (`data/raw` en produccion, `tests/fixtures/his` en los tests de fixtures) y
 * llena las tablas `his_*`.
 *
 * Diseño: streaming con `node:readline` (sin dependencias), Zod normaliza y
 * valida cada fila, `createMany({ skipDuplicates: true })` en lotes de 5.000
 * hace la carga idempotente (relanzar el importador no duplica filas).
 *
 * Orden (fija por las FK reales, verificadas contra los datos): pacientes →
 * triages → ingresos → atenciones (UPDATE de firstCareAt) → catalogos
 * Procedure/Medication → servicios → medicamentos → cirugias → derivados por
 * SQL estatico.
 */

const LOTE = 5_000;
const LIMITE_ERRORES_POR_ARCHIVO = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos del resumen
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

/** Acumula hasta `LIMITE_ERRORES_POR_ARCHIVO` errores detallados, sin dejar de contar el total. */
class AcumuladorErrores {
  private items: ErrorFila[] = [];
  private totalInvalidas = 0;

  agregar(linea: number, motivo: string): void {
    this.totalInvalidas += 1;
    if (this.items.length < LIMITE_ERRORES_POR_ARCHIVO) this.items.push({ linea, motivo });
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
// Lectura en streaming
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
// Derivados: una pasada de SQL estatico al final (nunca fila a fila desde JS)
// ─────────────────────────────────────────────────────────────────────────────

async function calcularDerivados(): Promise<void> {
  // 1) lastActivityAt: max(providedAt) U max(dispensedAt) por ingreso. Sin
  // fecha de egreso en el HIS, es la mejor aproximacion al fin de la estancia.
  await prisma.$executeRaw`
    UPDATE his_admissions AS a
    SET "lastActivityAt" = sub.maximo
    FROM (
      SELECT "admissionId" AS id, MAX(ts) AS maximo FROM (
        SELECT "admissionId", "providedAt" AS ts FROM his_service_records
        UNION ALL
        SELECT "admissionId", "dispensedAt" AS ts FROM his_medication_dispenses
      ) AS actividad
      GROUP BY "admissionId"
    ) AS sub
    WHERE a.id = sub.id
  `;

  // 2) triageLevel: copia de Triage.level (evita JOIN en cada consulta de analitica).
  await prisma.$executeRaw`
    UPDATE his_admissions AS a
    SET "triageLevel" = t.level
    FROM his_triages AS t
    WHERE a."triageId" = t.id
  `;

  // 3) waitMinutes: minutos entre el triage y la primera atencion.
  await prisma.$executeRaw`
    UPDATE his_admissions AS a
    SET "waitMinutes" = EXTRACT(EPOCH FROM (a."firstCareAt" - t."triagedAt")) / 60.0
    FROM his_triages AS t
    WHERE a."triageId" = t.id AND a."firstCareAt" IS NOT NULL
  `;

  // 4) stayHours: horas entre el ingreso y la ultima actividad registrada.
  await prisma.$executeRaw`
    UPDATE his_admissions
    SET "stayHours" = EXTRACT(EPOCH FROM ("lastActivityAt" - "admittedAt")) / 3600.0
    WHERE "lastActivityAt" IS NOT NULL
  `;

  // 5) snapshot de paciente en el momento del ingreso. La edad se calcula en
  // la fecha de Colombia del ingreso, no en la del huso horario de la sesion
  // de Postgres (que normalmente es UTC): un ingreso de madrugada podria caer
  // en el dia equivocado y desplazar la edad en un caso extremo.
  await prisma.$executeRaw`
    UPDATE his_admissions AS a
    SET "patientSex" = p.sex, "patientRegime" = p.regime, "patientZone" = p.zone,
        "patientAge" = EXTRACT(YEAR FROM age((a."admittedAt" AT TIME ZONE ${HIS_ZONA_HORARIA})::date, p."birthDate"))::int
    FROM his_patients AS p
    WHERE a."patientId" = p.id
  `;

  // 6) executed de SurgerySchedule: 'desconocido' sin ingreso verificable en
  // el extracto; si no, 'si'/'no' segun si ServiceRecord tiene ese codigo
  // para ese mismo ingreso.
  await prisma.$executeRaw`
    UPDATE his_surgery_schedules AS s
    SET executed = CASE
      WHEN s."admissionId" IS NULL OR NOT EXISTS (SELECT 1 FROM his_admissions a WHERE a.id = s."admissionId")
        THEN 'desconocido'
      WHEN EXISTS (
        SELECT 1 FROM his_service_records sr
        WHERE sr."admissionId" = s."admissionId" AND sr.code = s."procedureCode"
      ) THEN 'si'
      ELSE 'no'
    END
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Orquestador
// ─────────────────────────────────────────────────────────────────────────────

export async function importarDirectorio(dir: string): Promise<ResumenImportacion> {
  const inicio = Date.now();
  const ruta = (archivo: string): string => path.join(dir, archivo);

  const pacientes = await procesarPacientes(ruta('Paciente.txt'));
  const triages = await procesarTriages(ruta('Triage.txt'), pacientes.ids);
  const normalizacionRiesgo = await calcularNormalizacionRiesgo(ruta('Ingresos.txt'));
  const ingresos = await procesarIngresos(ruta('Ingresos.txt'), pacientes.ids, triages.ids, normalizacionRiesgo);
  const atenciones = await procesarAtenciones(ruta('Atencion.txt'), ingresos.ids);

  const ganadoresProcedimientos = await construirCatalogo(ruta('Servicios.txt'), CABECERA_SERVICIOS, 1, 2);
  const procedimientosInsertadas = await insertarProcedimientos(ganadoresProcedimientos);
  const servicios = await procesarServicios(ruta('Servicios.txt'), ingresos.ids);

  const ganadoresMedicamentos = await construirCatalogo(ruta('MedicamentoInsumo.txt'), CABECERA_MEDICAMENTOS, 1, 2);
  const medicamentosCatalogoInsertadas = await insertarMedicamentos(ganadoresMedicamentos);
  const medicamentos = await procesarMedicamentos(ruta('MedicamentoInsumo.txt'), ingresos.ids);

  const cirugias = await procesarCirugias(ruta('ProgramacionCirugia.txt'));

  await calcularDerivados();

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

// ─────────────────────────────────────────────────────────────────────────────
// CLI: `npm run data:import -- [--dir data/raw]`
// ─────────────────────────────────────────────────────────────────────────────

function imprimirResumen(resumen: ResumenImportacion): void {
  process.stdout.write('\n=== Resumen de importacion HIS ===\n');
  for (const a of resumen.archivos) {
    process.stdout.write(
      `${a.archivo.padEnd(42)} procesadas=${a.procesadas} insertadas=${a.insertadas} ` +
        `duplicadas=${a.duplicadas} vacias=${a.vacias} invalidas=${a.invalidas}\n`,
    );
    for (const aviso of a.avisos) process.stdout.write(`  aviso: ${aviso}\n`);
  }
  process.stdout.write(`\nTiempo total: ${(resumen.ms / 1000).toFixed(1)} s\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const indiceDir = args.indexOf('--dir');
  const dir = indiceDir >= 0 ? (args[indiceDir + 1] ?? 'data/raw') : 'data/raw';

  const resumen = await importarDirectorio(dir);
  imprimirResumen(resumen);

  const rutaReporte = path.resolve(process.cwd(), 'data/import-report.json');
  fs.writeFileSync(rutaReporte, JSON.stringify(resumen, null, 2), 'utf-8');
  process.stdout.write(`\nInforme detallado: ${rutaReporte}\n`);
}

// Solo se ejecuta al invocar el archivo directamente (CLI), no cuando los
// tests importan `importarDirectorio`.
if (require.main === module) {
  main()
    .catch((error: unknown) => {
      process.stderr.write(`\nFallo la importacion: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    })
    .finally(() => {
      void disconnectDatabase();
    });
}
