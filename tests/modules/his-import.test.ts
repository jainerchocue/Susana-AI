import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { importarDirectorio, type ResumenArchivo, type ResumenImportacion } from '../../src/scripts/import-data';
import { prisma } from '../helpers';

/**
 * Tests del importador HIS (T6) contra fixtures pequeños escritos a mano en
 * `tests/fixtures/his/` (5-6 filas por archivo), diseñados para cubrir cada
 * caso especial de B0: fila vacia de triage, vitales basura, huerfano de
 * IdPaciente2, variante de mayusculas de TipoRiesgo, duplicado exacto de
 * cirugia, cirugia con ingreso fuera del extracto, codigo de dispositivo
 * (prefijo DM) y cabecera erronea (en un directorio aparte).
 *
 * Corre contra `hospital_test_c` (ver DATABASE_URL de la tarea).
 */

const DIR_FIXTURES = path.join(__dirname, '../fixtures/his');
const DIR_CABECERA_MALA = path.join(__dirname, '../fixtures/his-cabecera-mala');

async function limpiarTablasHis(): Promise<void> {
  await prisma.$transaction([
    prisma.serviceRecord.deleteMany(),
    prisma.medicationDispense.deleteMany(),
    prisma.surgerySchedule.deleteMany(),
    prisma.medicationStock.deleteMany(),
    prisma.admission.deleteMany(),
    prisma.triage.deleteMany(),
    prisma.patient.deleteMany(),
    prisma.procedure.deleteMany(),
    prisma.medication.deleteMany(),
  ]);
}

function buscar(resumen: ResumenImportacion, archivo: string): ResumenArchivo {
  const fila = resumen.archivos.find((a) => a.archivo === archivo);
  if (!fila) throw new Error(`El resumen no trae "${archivo}": ${resumen.archivos.map((a) => a.archivo).join(', ')}`);
  return fila;
}

describe('importador HIS (fixtures)', () => {
  let primera: ResumenImportacion;
  let segunda: ResumenImportacion;

  beforeAll(async () => {
    await limpiarTablasHis();
    primera = await importarDirectorio(DIR_FIXTURES);
    // Segunda pasada sobre el mismo directorio, SIN limpiar: verifica que
    // relanzar el importador es idempotente (createMany skipDuplicates + la
    // guarda `firstCareAt IS NULL` + el indice unico de SurgerySchedule).
    segunda = await importarDirectorio(DIR_FIXTURES);
  }, 30_000);

  it('cabecera erronea aborta con un mensaje claro y no toca la BD', async () => {
    await expect(importarDirectorio(DIR_CABECERA_MALA)).rejects.toThrow(/Cabecera invalida/);
  });

  describe('resumen de la primera importacion', () => {
    it('Paciente.txt: 6 pacientes, todos validos', () => {
      const r = buscar(primera, 'Paciente.txt');
      expect(r).toMatchObject({ procesadas: 6, insertadas: 6, duplicadas: 0, vacias: 0, invalidas: 0 });
    });

    it('Triage.txt: salta la fila vacia y resuelve el huerfano de IdPaciente2', () => {
      const r = buscar(primera, 'Triage.txt');
      expect(r).toMatchObject({ procesadas: 5, insertadas: 4, duplicadas: 0, vacias: 1, invalidas: 0 });
      expect(r.avisos.some((a) => a.includes('huerfano'))).toBe(true);
    });

    it('Ingresos.txt: 6 ingresos, todos validos', () => {
      const r = buscar(primera, 'Ingresos.txt');
      expect(r).toMatchObject({ procesadas: 6, insertadas: 6, duplicadas: 0, invalidas: 0 });
    });

    it('Atencion.txt: actualiza firstCareAt de los 4 ingresos con atencion', () => {
      const r = buscar(primera, 'Atencion.txt');
      expect(r).toMatchObject({ procesadas: 4, insertadas: 4, duplicadas: 0, invalidas: 0 });
    });

    it('Servicios.txt: 5 lineas, catalogo Procedure con 3 codigos (nombre mas frecuente)', () => {
      const r = buscar(primera, 'Servicios.txt');
      expect(r).toMatchObject({ procesadas: 5, insertadas: 5, invalidas: 0 });
      const catalogo = buscar(primera, 'his_procedures (catalogo, de Servicios.txt)');
      expect(catalogo).toMatchObject({ procesadas: 3, insertadas: 3 });
    });

    it('MedicamentoInsumo.txt: 4 lineas, catalogo Medication con 4 codigos', () => {
      const r = buscar(primera, 'MedicamentoInsumo.txt');
      expect(r).toMatchObject({ procesadas: 4, insertadas: 4, invalidas: 0 });
      const catalogo = buscar(primera, 'his_medications (catalogo, de MedicamentoInsumo.txt)');
      expect(catalogo).toMatchObject({ procesadas: 4, insertadas: 4 });
    });

    it('ProgramacionCirugia.txt: dedupe en memoria de la fila duplicada exacta', () => {
      const r = buscar(primera, 'ProgramacionCirugia.txt');
      expect(r).toMatchObject({ procesadas: 4, insertadas: 3, duplicadas: 1, invalidas: 0 });
    });
  });

  it('idempotencia: la segunda importacion no inserta nada nuevo (salvo cirugias, que se recargan enteras)', () => {
    for (const archivo of segunda.archivos) {
      if (archivo.archivo === 'ProgramacionCirugia.txt') continue;
      expect(archivo.insertadas, `${archivo.archivo} deberia insertar 0 en la 2a pasada`).toBe(0);
    }
    // his_surgery_schedules no tiene PK natural: cada import la borra entera y
    // la vuelve a llenar, asi que "insertadas" es el mismo numero en las dos
    // pasadas (no 0), pero el resultado final es identico (ver mas abajo).
    const primeraCirugias = buscar(primera, 'ProgramacionCirugia.txt');
    const segundaCirugias = buscar(segunda, 'ProgramacionCirugia.txt');
    expect(segundaCirugias.insertadas).toBe(primeraCirugias.insertadas);
  });

  describe('catalogo de medicamentos/insumos: kind por prefijo DM (no solo DMT)', () => {
    it('DMT... es insumo', async () => {
      const m = await prisma.medication.findUniqueOrThrow({ where: { code: 'DMT0000007' } });
      expect(m.kind).toBe('insumo');
      expect(m.name).toBe('TUBO DE TORAX No 30');
    });

    it('DMC... (device con otro sufijo) tambien es insumo', async () => {
      const m = await prisma.medication.findUniqueOrThrow({ where: { code: 'DMC0000392' } });
      expect(m.kind).toBe('insumo');
    });

    it('un codigo sin prefijo DM es medicamento', async () => {
      const m = await prisma.medication.findUniqueOrThrow({ where: { code: 'B05BM002702' } });
      expect(m.kind).toBe('medicamento');
    });
  });

  it('catalogo Procedure: se queda con el nombre mas frecuente por codigo', async () => {
    // 3 filas con codigo 902210: "HEMOGRAMA" x2, "HEMOGRAMA COMPLETO" x1.
    const p = await prisma.procedure.findUniqueOrThrow({ where: { code: '902210' } });
    expect(p.name).toBe('HEMOGRAMA');
  });

  describe('Triage: signos vitales basura -> null, nivel extraido del texto', () => {
    it('vitales fuera de rango se guardan como null, el resto se conserva', async () => {
      const t = await prisma.triage.findUniqueOrThrow({ where: { id: 7004 } });
      expect(t.systolic).toBeNull();
      expect(t.diastolic).toBeNull();
      expect(t.heartRate).toBeNull();
      expect(t.temperature).toBeNull();
      expect(t.respiratoryRate).toBe(18);
      expect(t.level).toBe(3);
    });

    it('huerfano de IdPaciente2 queda con patientId null (no se descarta la fila)', async () => {
      const t = await prisma.triage.findUniqueOrThrow({ where: { id: 7005 } });
      expect(t.patientId).toBeNull();
      expect(t.level).toBe(4);
    });

    it('nivel se extrae del texto de clasificacion, no de CodigoTriage', async () => {
      const t = await prisma.triage.findUniqueOrThrow({ where: { id: 7001 } });
      expect(t.level).toBe(1);
      expect(t.systolic).toBe(120);
      expect(t.diastolic).toBe(80);
    });
  });

  describe('Admission: derivados calculados a mano contra los fixtures', () => {
    it('5001: variante correcta de TipoRiesgo, cama fisica, espera y estancia', async () => {
      const a = await prisma.admission.findUniqueOrThrow({ where: { id: 5001 } });
      expect(a.riskType).toBe('Accidente en el Hogar');
      expect(a.virtualBed).toBe(false);
      expect(a.triageLevel).toBe(1);
      expect(a.waitMinutes).toBeCloseTo(15, 5);
      expect(a.stayHours).toBeCloseTo(3, 5);
      expect(a.patientAge).toBe(35);
      expect(a.patientSex).toBe('Masculino');
      expect(a.patientRegime).toBe('Contributivo');
      expect(a.patientZone).toBe('Urbana');
    });

    it('5002: colapsa "accidente en el hogar" a la forma mas frecuente, cama virtual, sin triage', async () => {
      const a = await prisma.admission.findUniqueOrThrow({ where: { id: 5002 } });
      expect(a.riskType).toBe('Accidente en el Hogar');
      expect(a.virtualBed).toBe(true);
      expect(a.triageId).toBeNull();
      expect(a.triageLevel).toBeNull();
      expect(a.waitMinutes).toBeNull();
      expect(a.stayHours).toBeNull();
      expect(a.diagnosisCode).toBeNull();
      expect(a.diagnosisName).toBeNull();
      expect(a.hospitalizedAt).toBeNull();
      expect(a.patientAge).toBe(41);
    });

    it('5003: hospitalizedAt presente, espera y estancia calculadas', async () => {
      const a = await prisma.admission.findUniqueOrThrow({ where: { id: 5003 } });
      expect(a.hospitalizedAt).not.toBeNull();
      expect(a.triageLevel).toBe(2);
      expect(a.waitMinutes).toBeCloseTo(25, 5);
      expect(a.stayHours).toBeCloseTo(3, 5);
      expect(a.patientAge).toBe(15);
    });

    it('5004: triage con vitales basura igual aporta su nivel y espera', async () => {
      const a = await prisma.admission.findUniqueOrThrow({ where: { id: 5004 } });
      expect(a.triageLevel).toBe(3);
      expect(a.waitMinutes).toBeCloseTo(30, 5);
      expect(a.stayHours).toBeCloseTo(2.5, 5);
      expect(a.patientAge).toBe(51);
    });

    it('5005 y 5006: sin triage, estancia estimada solo con servicios/medicamentos', async () => {
      const a5 = await prisma.admission.findUniqueOrThrow({ where: { id: 5005 } });
      expect(a5.stayHours).toBeCloseTo(2, 5);
      expect(a5.patientAge).toBe(25);

      const a6 = await prisma.admission.findUniqueOrThrow({ where: { id: 5006 } });
      expect(a6.stayHours).toBeCloseTo(1, 5);
      expect(a6.patientAge).toBe(30);
    });
  });

  describe('SurgerySchedule: executed calculado contra ServiceRecord', () => {
    it('con ingreso y codigo verificables en Servicios -> si', async () => {
      const filas = await prisma.surgerySchedule.findMany({ where: { admissionId: 5005, procedureCode: '806104' } });
      expect(filas).toHaveLength(1);
      expect(filas[0]?.executed).toBe('si');
    });

    it('con ingreso verificable pero sin ese codigo en Servicios -> no', async () => {
      const fila = await prisma.surgerySchedule.findFirstOrThrow({ where: { admissionId: 5006 } });
      expect(fila.executed).toBe('no');
    });

    it('con OidIngreso fuera del extracto -> desconocido', async () => {
      const fila = await prisma.surgerySchedule.findFirstOrThrow({ where: { admissionId: 9999 } });
      expect(fila.executed).toBe('desconocido');
    });
  });

  describe('SurgerySchedule: idempotencia real con OidIngreso vacio', () => {
    /**
     * ProgramacionCirugia.txt no tiene PK natural y ~2.400 filas del extracto
     * real traen OidIngreso vacio: dos filas con `admissionId = null` NO
     * colisionan en el @@unique de Postgres (NULL <> NULL), asi que antes un
     * `skipDuplicates` las reinsertaba en cada relanzamiento. Este directorio
     * temporal (los otros 6 archivos van vacios: la tabla no tiene FK a nada)
     * reproduce justo ese caso para probar que la recarga completa lo arregla.
     */
    function crearFixtureConCirugiaSinIngreso(): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'his-fixture-sin-ingreso-'));
      const soloCabecera = (cabecera: string): string => `${cabecera}\n`;
      fs.writeFileSync(path.join(dir, 'Paciente.txt'), soloCabecera('TipoDocumento|IdPaciente|NombrePaciente|FechaNacimiento|Sexo|Asegurador|Regimen|Departamento|Municipio|Zona'));
      fs.writeFileSync(path.join(dir, 'Triage.txt'), soloCabecera('OidTriage|FechaTriage|MotivoConsulta|TensionArterial|FrecuenciaCardiaca|FrecuenciaRespiratoria|Temperatura|IdPaciente2|CodigoTriage|ClasificacionTriage'));
      fs.writeFileSync(path.join(dir, 'Ingresos.txt'), soloCabecera('OidIngreso|ConsecutivoIngreso|IdPaciente|ClaseIngreso|ViaIngreso|TipoRiesgo|FechaIngreso|FechaHospitalizacion|OidTriageA|CodigoCama|NombreCama|NombreGrupoCama|NombreSubgrupoCama|CodigoDiagnostico|NombreDiagnostico'));
      fs.writeFileSync(path.join(dir, 'Atencion.txt'), soloCabecera('OidIngreso|FechaAtencion'));
      fs.writeFileSync(path.join(dir, 'Servicios.txt'), soloCabecera('OidIngreso|CodigoServicio|NombreServicio|Cantidad|FechaPrestacion|CodigoAreaServicio|AreaServicio|Especialidad|OidS'));
      fs.writeFileSync(path.join(dir, 'MedicamentoInsumo.txt'), soloCabecera('OidIngreso|CodigoServicio|NombreServicio|Cantidad|FechaPrestacion|AreaServicio|Especialidad|OidMI'));
      fs.writeFileSync(
        path.join(dir, 'ProgramacionCirugia.txt'),
        'ConsecutivoProgramacion|IdPaciente|OidIngreso|CodigoServicio\nSCHNULL|1||COD1\n',
      );
      return dir;
    }

    it('relanzar el import dos veces no duplica una cirugia sin OidIngreso', async () => {
      const dir = crearFixtureConCirugiaSinIngreso();
      try {
        await importarDirectorio(dir);
        expect(await prisma.surgerySchedule.count()).toBe(1);

        await importarDirectorio(dir);
        expect(await prisma.surgerySchedule.count()).toBe(1);

        const fila = await prisma.surgerySchedule.findFirstOrThrow({ where: { scheduleNumber: 'SCHNULL' } });
        expect(fila.admissionId).toBeNull();
        expect(fila.executed).toBe('desconocido');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
