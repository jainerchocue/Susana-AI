import { beforeAll, describe, expect, it } from 'vitest';
import { cargarFixturesHis, prisma } from '../helpers';
import { recalcularDerivados } from '../../src/modules/his/his.derivados';

/**
 * `recalcularDerivados` (TC0) es la misma logica que usaba el importador
 * (`calcularDerivados`), extraida para que los CRUD de escritura (TC2-TC4) la
 * compartan. Lo unico nuevo de verdad es el filtro `admissionIds`: sin el,
 * un PATCH sobre un ingreso recalcularia los ~18.000 restantes por nada.
 */
describe('recalcularDerivados (his.derivados.ts)', () => {
  beforeAll(async () => {
    await cargarFixturesHis();
  }, 30_000);

  it('sin filtro, recalcula los derivados de todos los ingresos con actividad', async () => {
    const total = await prisma.admission.count();
    expect(total).toBeGreaterThan(0);

    await recalcularDerivados(prisma);

    const conEstancia = await prisma.admission.count({ where: { stayHours: { not: null } } });
    expect(conEstancia).toBeGreaterThan(0);
  });

  it('con filtro, SOLO toca los ingresos indicados: el resto conserva su valor previo', async () => {
    const candidatos = await prisma.admission.findMany({
      where: { lastActivityAt: { not: null } },
      select: { id: true },
      take: 2,
    });
    expect(candidatos.length).toBeGreaterThanOrEqual(2);
    const [tocado, intacto] = candidatos as [{ id: number }, { id: number }];

    // Se "corrompen" los dos a mano: si `recalcularDerivados` respeta el
    // filtro, solo el primero debe recuperar un valor real.
    await prisma.admission.updateMany({
      where: { id: { in: [tocado.id, intacto.id] } },
      data: { stayHours: -999 },
    });

    await recalcularDerivados(prisma, { admissionIds: [tocado.id] });

    const filas = await prisma.admission.findMany({
      where: { id: { in: [tocado.id, intacto.id] } },
      select: { id: true, stayHours: true },
    });
    const filaTocada = filas.find((f) => f.id === tocado.id);
    const filaIntacta = filas.find((f) => f.id === intacto.id);

    expect(filaTocada?.stayHours).not.toBe(-999);
    expect(filaIntacta?.stayHours).toBe(-999);
  });

  it('el filtro tambien acota `his_surgery_schedules.executed` a las cirugias del ingreso indicado', async () => {
    const cirugia = await prisma.surgerySchedule.findFirst({ where: { admissionId: { not: null } } });
    if (!cirugia) return; // los fixtures pequeños pueden no traer ninguna cirugia con ingreso.

    await prisma.surgerySchedule.update({ where: { id: cirugia.id }, data: { executed: 'desconocido' } });
    await recalcularDerivados(prisma, { admissionIds: [-1] }); // ingreso inexistente: no debe tocar nada.

    const trasFiltroAjeno = await prisma.surgerySchedule.findUniqueOrThrow({ where: { id: cirugia.id } });
    expect(trasFiltroAjeno.executed).toBe('desconocido');

    await recalcularDerivados(prisma, { admissionIds: [cirugia.admissionId!] });
    const trasFiltroPropio = await prisma.surgerySchedule.findUniqueOrThrow({ where: { id: cirugia.id } });
    expect(trasFiltroPropio.executed).not.toBe('desconocido');
  });

  // ───────────────────────────────────────────────────────────────────────────
  // TC6 (arreglo pendiente #1): "UPDATE ... FROM" con JOIN implicito NO toca
  // la fila cuando la fuente desaparece del todo (0 filas en la subconsulta /
  // sin fila que casar en el JOIN), asi que el derivado se queda con el valor
  // VIEJO en vez de volver a null. Estos tres tests fallaban antes del fix
  // (recalcularDerivados con LEFT JOIN/CASE) y pasan despues.
  // ───────────────────────────────────────────────────────────────────────────

  it('cuando un ingreso se queda SIN ninguna actividad, lastActivityAt y stayHours vuelven a null', async () => {
    const candidato = await prisma.admission.findFirst({
      where: { lastActivityAt: { not: null } },
      select: { id: true },
    });
    expect(candidato).not.toBeNull();
    const { id } = candidato!;

    await prisma.serviceRecord.deleteMany({ where: { admissionId: id } });
    await prisma.medicationDispense.deleteMany({ where: { admissionId: id } });

    await recalcularDerivados(prisma, { admissionIds: [id] });

    const tras = await prisma.admission.findUniqueOrThrow({ where: { id } });
    expect(tras.lastActivityAt).toBeNull();
    expect(tras.stayHours).toBeNull();
  });

  it('al limpiar triageId (ingreso sin triage), triageLevel y waitMinutes vuelven a null', async () => {
    const candidato = await prisma.admission.findFirst({
      where: { triageId: { not: null }, waitMinutes: { not: null } },
      select: { id: true },
    });
    expect(candidato).not.toBeNull();
    const { id } = candidato!;

    await prisma.admission.update({ where: { id }, data: { triageId: null } });
    await recalcularDerivados(prisma, { admissionIds: [id] });

    const tras = await prisma.admission.findUniqueOrThrow({ where: { id } });
    expect(tras.triageLevel).toBeNull();
    expect(tras.waitMinutes).toBeNull();
  });

  it('al limpiar firstCareAt (sin tocar el triage), waitMinutes vuelve a null', async () => {
    const candidato = await prisma.admission.findFirst({
      where: { firstCareAt: { not: null }, waitMinutes: { not: null } },
      select: { id: true },
    });
    expect(candidato).not.toBeNull();
    const { id } = candidato!;

    await prisma.admission.update({ where: { id }, data: { firstCareAt: null } });
    await recalcularDerivados(prisma, { admissionIds: [id] });

    const tras = await prisma.admission.findUniqueOrThrow({ where: { id } });
    expect(tras.waitMinutes).toBeNull();
  });

  it('al borrar el service-record que hacia verificable una cirugia, executed vuelve a "no"', async () => {
    const admission = await prisma.admission.findFirstOrThrow({ select: { id: true } });
    const admissionId = admission.id;

    await prisma.procedure.create({ data: { code: 'ZE2EDERIV1', name: 'Procedimiento sintetico TC6' } });
    const cirugia = await prisma.surgerySchedule.create({
      data: { scheduleNumber: 'ZE2E-DERIV', patientId: 9_999_001, admissionId, procedureCode: 'ZE2EDERIV1', executed: 'desconocido' },
    });
    const servicio = await prisma.serviceRecord.create({
      data: {
        id: 9_999_101,
        admissionId,
        code: 'ZE2EDERIV1',
        quantity: 1,
        providedAt: new Date('2026-06-01T12:00:00.000Z'),
        areaCode: 'Z1',
        area: 'AREA SINTETICA TC6',
        specialty: 'ESP SINTETICA TC6',
      },
    });

    try {
      await recalcularDerivados(prisma, { admissionIds: [admissionId] });
      const trasCrear = await prisma.surgerySchedule.findUniqueOrThrow({ where: { id: cirugia.id } });
      expect(trasCrear.executed).toBe('si');

      await prisma.serviceRecord.delete({ where: { id: servicio.id } });
      await recalcularDerivados(prisma, { admissionIds: [admissionId] });
      const trasBorrar = await prisma.surgerySchedule.findUniqueOrThrow({ where: { id: cirugia.id } });
      expect(trasBorrar.executed).toBe('no');
    } finally {
      await prisma.surgerySchedule.deleteMany({ where: { id: cirugia.id } });
      await prisma.serviceRecord.deleteMany({ where: { id: 9_999_101 } });
      await prisma.procedure.deleteMany({ where: { code: 'ZE2EDERIV1' } });
    }
  });
});
