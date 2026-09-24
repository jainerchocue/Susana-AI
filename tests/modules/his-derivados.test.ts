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
});
