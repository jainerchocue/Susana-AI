import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { env } from '../../src/config/env';
import { recalcularDerivados } from '../../src/modules/his/his.derivados';
import { Sesion, comoRol, credenciales, prismaE2E } from './cliente';

/**
 * TC3 (ola E2): CRUD de `service-records`, `procedures` y `surgery-schedules`
 * contra el proceso real y los datos HIS reales que carga `global-setup.ts`
 * (582.352 filas en his_service_records).
 *
 * E0: los registros que este archivo escribe son SINTETICOS (id >= 9.100.000,
 * codigo `ZE2E-E2E-*`) para no alterar los totales que `analytics.e2e.test.ts`
 * y `cirugias.e2e.test.ts` recalculan de forma independiente en la MISMA
 * corrida (comparten `hospital_e2e_b`). `afterAll` los borra por Prisma
 * directo (no confia en que cada `it` haya llegado a su propio DELETE) y
 * recalcula los derivados de cualquier ingreso REAL que haya tocado, para
 * dejar `lastActivityAt`/`executed` exactamente como los encontro.
 */

const BASE = inject('e2eUrl');
const PREFIJO = env.API_PREFIX;
const ID_SINTETICO_BASE = 9_100_000;

function comoRegistro(valor: unknown): Record<string, unknown> {
  if (typeof valor !== 'object' || valor === null) {
    throw new Error(`Se esperaba un objeto JSON; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor as Record<string, unknown>;
}

function comoArreglo(valor: unknown): unknown[] {
  if (!Array.isArray(valor)) throw new Error(`Se esperaba un arreglo; se recibio: ${JSON.stringify(valor)}`);
  return valor;
}

function comoNumero(valor: unknown): number {
  if (typeof valor !== 'number' || Number.isNaN(valor)) {
    throw new Error(`Se esperaba un numero; se recibio: ${JSON.stringify(valor)}`);
  }
  return valor;
}

describe('service-records / procedures / surgery-schedules (TC3) end-to-end', () => {
  let admin: Sesion;
  let analista: Sesion;
  let farmacia: Sesion;

  // Registrados aqui SOLO tras un 2xx real: `afterAll` los borra por id/codigo
  // exacto, nunca por rango, para no arriesgar una fila de otro test.
  const idsServiceRecord = new Set<number>();
  const idsSurgerySchedule = new Set<number>();
  const codigosProcedure = new Set<string>();
  const admisionesTocadas = new Set<number>();

  beforeAll(async () => {
    admin = await comoRol(BASE, 'ADMIN');
    analista = await comoRol(BASE, 'ANALISTA');
    farmacia = new Sesion(BASE);
    expect((await farmacia.login(credenciales.farmacia.email, credenciales.farmacia.password)).status).toBe(200);
  }, 60_000);

  afterAll(async () => {
    const prisma = prismaE2E();
    if (idsServiceRecord.size > 0) {
      await prisma.serviceRecord.deleteMany({ where: { id: { in: [...idsServiceRecord] } } });
    }
    if (idsSurgerySchedule.size > 0) {
      await prisma.surgerySchedule.deleteMany({ where: { id: { in: [...idsSurgerySchedule] } } });
    }
    if (codigosProcedure.size > 0) {
      await prisma.procedure.deleteMany({ where: { code: { in: [...codigosProcedure] } } });
    }
    // Restaura lastActivityAt/executed de cualquier ingreso REAL que un
    // service-record sintetico haya movido, ANTES de que el proceso real se
    // apague: sin esto, un test que falla a mitad de camino (sin llegar a su
    // propio DELETE) dejaria la cifra alterada para analytics.e2e/cirugias.e2e.
    if (admisionesTocadas.size > 0) {
      await recalcularDerivados(prisma, { admissionIds: [...admisionesTocadas] });
    }
    await prisma.$disconnect();
  });

  describe('permisos', () => {
    it('401 sin sesion en las tres colecciones', async () => {
      const anonimo = new Sesion(BASE);
      expect((await anonimo.get(`${PREFIJO}/service-records`)).status).toBe(401);
      expect((await anonimo.get(`${PREFIJO}/procedures`)).status).toBe(401);
      expect((await anonimo.get(`${PREFIJO}/surgery-schedules`)).status).toBe(401);
    });

    it('FARMACIA -> 403 al listar (sin services:read ni surgeries:read)', async () => {
      expect((await farmacia.get(`${PREFIJO}/service-records`)).status).toBe(403);
      expect((await farmacia.get(`${PREFIJO}/procedures`)).status).toBe(403);
      expect((await farmacia.get(`${PREFIJO}/surgery-schedules`)).status).toBe(403);
    });

    it('ANALISTA -> 200 al listar (services:read/surgeries:read), 403 al escribir (sin data:manage)', async () => {
      expect((await analista.get(`${PREFIJO}/service-records?limit=1`)).status).toBe(200);
      expect((await analista.get(`${PREFIJO}/procedures?limit=1`)).status).toBe(200);
      expect((await analista.get(`${PREFIJO}/surgery-schedules?limit=1`)).status).toBe(200);

      expect(
        (
          await analista.post(`${PREFIJO}/procedures`, {
            code: 'ZE2ENOPE',
            name: 'no deberia crearse',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('service-records: listado filtrado cotejado con Prisma real (582k filas)', () => {
    it('filtra por code y coincide con Prisma directo; mide el tiempo', async () => {
      const prisma = prismaE2E();
      const algunCodigo = await prisma.serviceRecord.findFirst({ select: { code: true }, orderBy: { id: 'asc' } });
      if (!algunCodigo) throw new Error('his_service_records esta vacia: el global-setup deberia haberla importado.');

      const inicio = Date.now();
      const r = await analista.get(`${PREFIJO}/service-records?code=${algunCodigo.code}&limit=50`);
      const ms = Date.now() - inicio;
      expect(r.status).toBe(200);

      const directos = await prisma.serviceRecord.findMany({
        where: { code: algunCodigo.code },
        orderBy: { id: 'asc' },
        take: 50,
      });
      const idsApi = comoArreglo(comoRegistro(r.body).data).map((f) => comoNumero(comoRegistro(f).id));
      expect(idsApi).toEqual(directos.map((d) => d.id));

      // eslint-disable-next-line no-console -- cifra real para el reporte de la tarea.
      console.log(`[TC3 e2e] GET /service-records?code=${algunCodigo.code}: ${ms}ms (proceso real + Postgres real)`);
      expect(ms, `tardo ${ms}ms`).toBeLessThan(3_000);
    });

    it('un query param desconocido responde 422', async () => {
      const r = await analista.get(`${PREFIJO}/service-records?x=1`);
      expect(r.status).toBe(422);
    });
  });

  describe('procedures: alta automatica desde service-records y 409 al borrar con dependientes', () => {
    it('crear un service-record con codigo nuevo da de alta el procedimiento en el catalogo', async () => {
      const prisma = prismaE2E();
      const admission = await prisma.admission.findFirst({ select: { id: true } });
      if (!admission) throw new Error('his_admissions esta vacia.');

      // Sin guiones: `code` pasa por `codigoHis` (alfanumerico, /^[A-Z0-9]{3,20}$/).
      const codigo = 'ZE2EE2E01';
      const id = ID_SINTETICO_BASE + 1;

      expect(await prisma.procedure.findUnique({ where: { code: codigo } })).toBeNull();

      const creado = await admin.post(`${PREFIJO}/service-records`, {
        id,
        admissionId: admission.id,
        code: codigo,
        procedureName: 'Procedimiento sintetico E2E (TC3)',
        quantity: 1,
        providedAt: '2026-06-01T08:00:00-05:00',
        areaCode: 'ZE2',
        area: 'AREA E2E',
        specialty: 'ESPECIALIDAD E2E',
      });
      expect(creado.status).toBe(201);
      idsServiceRecord.add(id);
      codigosProcedure.add(codigo);
      admisionesTocadas.add(admission.id);

      const catalogo = await prisma.procedure.findUnique({ where: { code: codigo } });
      expect(catalogo).toMatchObject({ code: codigo, name: 'Procedimiento sintetico E2E (TC3)' });

      // Limpieza inmediata de este sub-test (ademas de la red de seguridad en afterAll).
      const borrado = await admin.delete(`${PREFIJO}/service-records/${id}`);
      expect(borrado.status).toBe(204);
      idsServiceRecord.delete(id);
      await prisma.procedure.delete({ where: { code: codigo } });
      codigosProcedure.delete(codigo);
    });

    it('409 al intentar borrar un procedimiento real con service-records asociados', async () => {
      const prisma = prismaE2E();
      const conDependientes = await prisma.procedure.findFirst({ where: { services: { some: {} } } });
      if (!conDependientes) throw new Error('Ningun procedimiento real tiene service-records asociados.');

      const res = await admin.delete(`${PREFIJO}/procedures/${conDependientes.code}`);
      expect(res.status).toBe(409);
      // No se borro de verdad.
      expect(await prisma.procedure.findUnique({ where: { code: conDependientes.code } })).not.toBeNull();
    });
  });

  describe('surgery-schedules: executed derivado (no se acepta en la entrada) y recalculo cruzado', () => {
    it('`executed` en el cuerpo responde 422 tanto en POST como en PATCH', async () => {
      const conExecuted = await admin.post(`${PREFIJO}/surgery-schedules`, {
        scheduleNumber: 'ZE2E-E2E-02',
        patientId: ID_SINTETICO_BASE + 2,
        admissionId: null,
        procedureCode: 'ZE2E02',
        executed: 'si',
      });
      expect(conExecuted.status).toBe(422);

      const prisma = prismaE2E();
      const existente = await prisma.surgerySchedule.findFirst({ select: { id: true } });
      if (!existente) throw new Error('his_surgery_schedules esta vacia.');
      const patchConExecuted = await admin.patch(`${PREFIJO}/surgery-schedules/${existente.id}`, { executed: 'no' });
      expect(patchConExecuted.status).toBe(422);
    });

    it(
      'crear/borrar un service-record cambia lastActivityAt del ingreso y el executed de sus cirugias programadas',
      async () => {
        const prisma = prismaE2E();
        const admission = await prisma.admission.findFirst({
          where: { lastActivityAt: { not: null } },
          select: { id: true, lastActivityAt: true },
        });
        if (!admission?.lastActivityAt) throw new Error('Ningun ingreso real tiene lastActivityAt.');
        admisionesTocadas.add(admission.id);

        // Sin guiones: se usa a la vez como `procedureCode`/`code`, que pasan
        // por `codigoHis` (alfanumerico, /^[A-Z0-9]{3,20}$/).
        const codigo = 'ZE2EE2E03';
        const serviceRecordId = ID_SINTETICO_BASE + 4;

        // 1) Se programa una cirugia para ese ingreso con un codigo que TODAVIA
        // no tiene ningun service-record: executed = 'no' (ingreso real, sin verificar).
        const cirugia = await admin.post(`${PREFIJO}/surgery-schedules`, {
          scheduleNumber: codigo,
          patientId: ID_SINTETICO_BASE + 5,
          admissionId: admission.id,
          procedureCode: codigo,
        });
        expect(cirugia.status).toBe(201);
        const idCirugia = comoNumero(comoRegistro(comoRegistro(cirugia.body).data).id);
        idsSurgerySchedule.add(idCirugia);
        expect(comoRegistro(comoRegistro(cirugia.body).data).executed).toBe('no');

        // 2) Llega un service-record posterior a la ultima actividad conocida,
        // con el MISMO codigo y el MISMO ingreso.
        const nuevaFecha = new Date(admission.lastActivityAt.getTime() + 60_000);
        const servicio = await admin.post(`${PREFIJO}/service-records`, {
          id: serviceRecordId,
          admissionId: admission.id,
          code: codigo,
          procedureName: 'Cirugia sintetica E2E (TC3)',
          quantity: 1,
          providedAt: nuevaFecha.toISOString(),
          areaCode: 'ZE2',
          area: 'AREA E2E',
          specialty: 'ESP E2E',
        });
        expect(servicio.status).toBe(201);
        idsServiceRecord.add(serviceRecordId);
        codigosProcedure.add(codigo);

        const cirugiaTrasCrear = await admin.get(`${PREFIJO}/surgery-schedules/${idCirugia}`);
        expect(comoRegistro(comoRegistro(cirugiaTrasCrear.body).data).executed).toBe('si');

        const admissionTrasCrear = await prisma.admission.findUniqueOrThrow({ where: { id: admission.id } });
        expect(admissionTrasCrear.lastActivityAt?.toISOString()).toBe(nuevaFecha.toISOString());

        // 3) Se borra el service-record: executed vuelve a 'no' y lastActivityAt
        // vuelve al valor original.
        const borrado = await admin.delete(`${PREFIJO}/service-records/${serviceRecordId}`);
        expect(borrado.status).toBe(204);
        idsServiceRecord.delete(serviceRecordId);

        const cirugiaTrasBorrar = await admin.get(`${PREFIJO}/surgery-schedules/${idCirugia}`);
        expect(comoRegistro(comoRegistro(cirugiaTrasBorrar.body).data).executed).toBe('no');

        const admissionTrasBorrar = await prisma.admission.findUniqueOrThrow({ where: { id: admission.id } });
        expect(admissionTrasBorrar.lastActivityAt?.toISOString()).toBe(admission.lastActivityAt.toISOString());

        const borradoCirugia = await admin.delete(`${PREFIJO}/surgery-schedules/${idCirugia}`);
        expect(borradoCirugia.status).toBe(204);
        idsSurgerySchedule.delete(idCirugia);

        await prisma.procedure.delete({ where: { code: codigo } });
        codigosProcedure.delete(codigo);
        admisionesTocadas.delete(admission.id);
      },
      30_000,
    );
  });
});
