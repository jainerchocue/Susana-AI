import { Resend } from 'resend';
import { env, isProd } from '../../config/env';
import { BRAND } from '../../config/constants';
import { logger } from '../logger';
import { cache } from '../cache/redis';
import type { RenderedTemplate } from './templates';

/**
 * Envio de correo con Resend.
 *
 * Se eligio frente a SMTP porque el proveedor gestiona reintentos, reputacion
 * de IP, SPF/DKIM/DMARC y webhooks de rebote: nada de eso deberia vivir en
 * este proceso. Ademas elimina nodemailer, que arrastraba dos CVE altos
 * (auditoria C-07).
 */

let cliente: Resend | null = null;

function getCliente(): Resend {
  if (!cliente) cliente = new Resend(env.RESEND_API_KEY);
  return cliente;
}

export interface SendMailInput extends RenderedTemplate {
  to: string;
  replyTo?: string;
  /**
   * Clave de deduplicacion. Dos envios con la misma clave en 5 minutos solo
   * mandan un correo: evita bombardear al usuario si reintenta el formulario.
   */
  dedupeKey?: string;
  /** Cabeceras para agrupar en el panel de Resend y filtrar rebotes. */
  tags?: { name: string; value: string }[];
}

const DEDUPE_TTL_S = 300;

/**
 * Nunca lanza: un fallo de correo no debe tumbar un registro exitoso.
 * Devuelve false y deja rastro en el log para que lo recoja la alerta.
 *
 * ponytail: envio en linea. Con volumen alto, encolar (BullMQ + Redis, que ya
 * esta) y cambiar solo el cuerpo de esta funcion.
 */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  if (!env.MAIL_ENABLED) {
    logger.info({ to: redactar(input.to), subject: input.subject }, 'MAIL_ENABLED=false, correo no enviado');
    if (!isProd) logger.debug({ text: input.text }, 'Contenido del correo');
    return false;
  }

  if (input.dedupeKey) {
    const primero = await cache.setNx(`mail:dedupe:${input.dedupeKey}`, '1', DEDUPE_TTL_S);
    if (!primero) {
      logger.debug({ dedupeKey: input.dedupeKey }, 'Correo omitido por deduplicacion');
      return false;
    }
  }

  try {
    const { data, error } = await getCliente().emails.send({
      from: `${env.MAIL_FROM_NAME} <${env.MAIL_FROM_EMAIL}>`,
      to: input.to,
      replyTo: input.replyTo ?? env.MAIL_REPLY_TO ?? BRAND.supportEmail,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tags,
    });

    if (error) {
      logger.error({ err: error, to: redactar(input.to), subject: input.subject }, 'Resend rechazo el envio');
      return false;
    }

    logger.info({ to: redactar(input.to), subject: input.subject, id: data?.id }, 'Correo enviado');
    return true;
  } catch (error) {
    logger.error({ err: error, to: redactar(input.to), subject: input.subject }, 'Fallo el envio de correo');
    return false;
  }
}

/** Los logs no deben guardar direcciones completas (PII). */
function redactar(email: string): string {
  const [local = '', dominio = ''] = email.split('@');
  return `${local.slice(0, 2)}***@${dominio}`;
}

/** Comprobacion al arrancar. Solo avisa: no debe impedir el arranque. */
export async function verifyMailer(): Promise<void> {
  if (!env.MAIL_ENABLED) return;
  try {
    // Endpoint barato que valida la API key sin enviar nada.
    const { error } = await getCliente().domains.list();
    if (error) logger.warn({ err: error }, 'La API key de Resend no valida; los correos fallaran');
    else logger.info('Resend verificado');
  } catch (error) {
    logger.warn({ err: error }, 'No se pudo verificar Resend; los correos podrian fallar');
  }
}

export function closeMailer(): void {
  cliente = null;
}
