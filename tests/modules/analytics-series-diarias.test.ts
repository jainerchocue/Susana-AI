import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { censoDiario } from '../../src/modules/analytics/occupancy.service';
import { p50Diario } from '../../src/modules/analytics/wait-time.service';
import { getApp, prisma } from '../helpers';

/**
 * Series diarias de `/dashboard/wait-times` y `/dashboard/occupancy` (T15):
 * dos bugs encontrados por la suite E2E donde el dia de borde de un periodo
 * (el primero o el ultimo) contaba de mas o de menos.
 *
 * Fixtures PROPIOS, no los de `tests/fixtures/his/` (ya los usan otros tests
 * con cifras calculadas a mano sobre TODO ese dataset): un paciente y unos
 * ingresos en 2030, un año que ningun otro test toca, para poder acotar el
 * periodo consultado sin arrastrar filas de otros archivos. Se limpian en
 * `afterAll`; no se llama a `cargarFixturesHis()` (no depende de esos datos
 * y no hace falta reimportarlos).
 */
const PACIENTE_ID = 900001;

function admision(
  id: number,
  admittedAt: Date,
  overrides: Partial<Prisma.AdmissionCreateManyInput> = {},
): Prisma.AdmissionCreateManyInput {
  return {
    id,
    consecutive: id,
    patientId: PACIENTE_ID,
    admissionClass: 'Ambulatorio',
    entryRoute: 'Urgencias',
    riskType: 'Enfermedad General',
    admittedAt,
    bedCode: `T-${id}`,
    bedName: `CAMA T-${id}`,
    unit: 'URGENCIAS',
    subunit: 'URGENCIAS ADULTOS',
    virtualBed: false,
    ...overrides,
  };
}

async function limpiarPropios(): Promise<void> {
  await prisma.admission.deleteMany({ where: { patientId: PACIENTE_ID } });
  await prisma.patient.deleteMany({ where: { id: PACIENTE_ID } });
}

describe('Series diarias: bordes de dia de un periodo (T15, bugfix)', () => {
  beforeAll(async () => {
    await getApp();
    await limpiarPropios();
    await prisma.patient.create({
      data: {
        id: PACIENTE_ID,
        documentType: 'CC',
        birthDate: new Date('1990-01-01'),
        sex: 'M',
        insurer: 'TEST',
        regime: 'CONTRIBUTIVO',
        department: 'TEST',
        municipality: 'TEST',
        zone: 'URBANA',
      },
    });
  });

  afterAll(async () => {
    await limpiarPropios();
    await prisma.$disconnect();
  });

  /**
   * `p50Diario` (wait-time.service.ts): antes del arreglo, el LEFT JOIN
   * agrupaba por IGUALDAD de dia calendario sin acotar `admittedAt` a
   * [desde,hasta] (a diferencia de `esperaPorNivel`/`ingresosPorDiaYUnidad`),
   * asi que el primer y el ultimo dia del periodo arrastraban ingresos de
   * FUERA del rango exacto con tal de compartir el mismo dia calendario.
   */
  describe('wait-time.service#p50Diario', () => {
    const desde = new Date('2030-03-10T14:00:00-05:00');
    const hasta = new Date('2030-03-12T10:00:00-05:00');

    beforeAll(async () => {
      await prisma.admission.deleteMany({ where: { patientId: PACIENTE_ID } });
      await prisma.admission.createMany({
        data: [
          // Mismo dia calendario que `desde` (2030-03-10) pero ANTES de las 14:00: fuera del periodo.
          admision(900101, new Date('2030-03-10T08:00:00-05:00'), { waitMinutes: 10 }),
          // Mismo dia, DESPUES de `desde`: dentro del periodo.
          admision(900102, new Date('2030-03-10T16:00:00-05:00'), { waitMinutes: 20 }),
          // Mismo dia calendario que `hasta` (2030-03-12) pero DESPUES de las 10:00: fuera del periodo.
          admision(900103, new Date('2030-03-12T18:00:00-05:00'), { waitMinutes: 30 }),
        ],
      });
    });

    it('el primer dia del periodo NO cuenta ingresos anteriores a `desde` del mismo dia calendario', async () => {
      const serie = await p50Diario(desde, hasta);
      const primerDia = serie.find((f) => f.day === '2030-03-10');
      expect(primerDia).toBeDefined();
      expect(primerDia?.n).toBe(1);
      expect(primerDia?.p50).toBe(20);
    });

    it('el ultimo dia del periodo NO cuenta ingresos posteriores a `hasta` del mismo dia calendario', async () => {
      const serie = await p50Diario(desde, hasta);
      const ultimoDia = serie.find((f) => f.day === '2030-03-12');
      expect(ultimoDia).toBeDefined();
      expect(ultimoDia?.n).toBe(0);
      expect(ultimoDia?.p50).toBe('insufficient_data');
    });
  });

  /**
   * `censoDiario` (occupancy.service.ts): antes del arreglo, la CTE
   * `admisiones` (el prefiltro de candidatos al barrido) acotaba con
   * `admittedAt <= hasta`, pero el instante real que se evalua para el
   * ULTIMO dia de la serie es las 23:59:59 hora Bogota de ese dia calendario
   * -posterior a `hasta` salvo que `hasta` sea ya el fin de ese dia-, asi que
   * un ingreso que empieza DESPUES de `hasta` pero sigue activo a esa
   * medianoche quedaba excluido del censo, aunque debia contar.
   */
  describe('occupancy.service#censoDiario', () => {
    const desde = new Date('2030-04-01T00:00:00-05:00');
    const hasta = new Date('2030-04-01T15:00:00-05:00');

    beforeAll(async () => {
      await prisma.admission.deleteMany({ where: { patientId: PACIENTE_ID } });
      await prisma.admission.createMany({
        data: [
          // Empieza DESPUES de `hasta` (18:00 > 15:00) pero sigue activo bien
          // pasada la medianoche: debe contar en el censo de las 23:59:59.
          admision(900201, new Date('2030-04-01T18:00:00-05:00'), {
            lastActivityAt: new Date('2030-04-02T05:00:00-05:00'),
          }),
        ],
      });
    });

    it('el ultimo dia del periodo cuenta un ingreso que empieza tras `hasta` pero sigue activo a las 23:59:59', async () => {
      const serie = await censoDiario(desde, hasta);
      const dia = serie.find((f) => f.day === '2030-04-01');
      expect(dia).toBeDefined();
      expect(dia?.census).toBe(1);
    });
  });
});
