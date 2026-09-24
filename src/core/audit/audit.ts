import type { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { logger } from '../logger';

/**
 * Registro de auditoria append-only.
 *
 * Regla: toda operacion que cambie autoridad, credenciales o estado de una
 * cuenta deja rastro. Sin esto, tras un incidente es imposible reconstruir
 * quien hizo que (auditoria A-12).
 */

export const AUDIT = {
  loginOk: 'auth.login.success',
  logout: 'auth.logout',
  registro: 'auth.register',
  emailVerificado: 'auth.email.verified',
  passwordCambiada: 'auth.password.changed',
  passwordReset: 'auth.password.reset',
  sesionRechazada: 'auth.session.rejected',
  mfaActivada: 'auth.mfa.enabled',
  mfaDesactivada: 'auth.mfa.disabled',
  usuarioCreado: 'user.created',
  usuarioActualizado: 'user.updated',
  usuarioBorrado: 'user.deleted',
  rolesAsignados: 'user.roles.set',
  rolCreado: 'role.created',
  rolActualizado: 'role.updated',
  rolBorrado: 'role.deleted',
  permisosAsignados: 'role.permissions.set',
  escaladaBloqueada: 'security.escalation.blocked',
  asistenteConsulta: 'assistant.query',
  asistenteRechazo: 'assistant.query.rejected',
  agenteConsulta: 'agent.internal.query',
  agenteDenegado: 'agent.internal.denied',
  alertaActualizada: 'alert.updated',
  alertasEvaluadas: 'alert.evaluated',
  stockActualizado: 'medication.stock.updated',
  exportacion: 'data.export',
  accesoSensible: 'data.sensitive.read',
} as const;

export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

/**
 * Datos de la peticion que acompañan a todo rastro de auditoria.
 * Vive aqui y no en un modulo de negocio: `core` no puede depender de
 * `modules`, y todos los servicios lo necesitan.
 */
export interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  actorId?: string | null;
  /**
   * Correo del actor en el momento del hecho. Se resuelve solo si no se pasa:
   * `users.remove()` sobrescribe el correo al borrar y `audit_logs` no tiene
   * clave foranea, asi que sin esta copia el rastro queda en un UUID huerfano.
   */
  actorEmail?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

/** Congela el correo del actor. Nunca lanza: el rastro importa mas que el adorno. */
async function resolverActorEmail(
  db: Prisma.TransactionClient,
  entrada: AuditEntry,
): Promise<string | null> {
  if (entrada.actorEmail !== undefined) return entrada.actorEmail;
  if (!entrada.actorId) return null;
  try {
    const actor = await db.user.findUnique({
      where: { id: entrada.actorId },
      select: { email: true },
    });
    return actor?.email ?? null;
  } catch {
    // Un fallo aqui no puede impedir que se escriba el rastro.
    return null;
  }
}

function aFila(entrada: AuditEntry, actorEmail: string | null) {
  return {
    actorId: entrada.actorId ?? null,
    actorEmail,
    action: entrada.action,
    targetType: entrada.targetType ?? null,
    targetId: entrada.targetId ?? null,
    metadata: entrada.metadata,
    ip: entrada.ip ?? null,
    userAgent: entrada.userAgent?.slice(0, 255) ?? null,
    requestId: entrada.requestId ?? null,
  };
}

/**
 * No lanza nunca: un fallo al auditar no debe revertir la operacion auditada.
 * Se registra en el log de aplicacion para que la alerta lo recoja.
 */
export async function auditar(entrada: AuditEntry): Promise<void> {
  try {
    const actorEmail = await resolverActorEmail(prisma, entrada);
    await prisma.auditLog.create({ data: aFila(entrada, actorEmail) });
  } catch (error) {
    logger.error({ err: error, action: entrada.action }, 'No se pudo escribir el registro de auditoria');
  }
}

/**
 * Version transaccional: la entrada se escribe con la misma transaccion que la
 * operacion. Si la operacion revierte, el registro tambien. Usarla cuando el
 * rastro debe ser exacto (cambios de autoridad).
 */
export async function auditarEnTx(
  tx: Prisma.TransactionClient,
  entrada: AuditEntry,
): Promise<{ id: string }> {
  const actorEmail = await resolverActorEmail(tx, entrada);
  return tx.auditLog.create({ data: aFila(entrada, actorEmail), select: { id: true } });
}
