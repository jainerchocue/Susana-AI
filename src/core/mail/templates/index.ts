import { BRAND, MAIL_COPY, THEME } from '../../../config/constants';
import {
  button,
  escapeHtml,
  fallbackLink,
  infoBox,
  muted,
  paragraph,
  renderLayout,
  toPlainText,
} from './layout';

/**
 * Catalogo de plantillas. Cada una devuelve { subject, html, text }.
 *
 * Para agregar una plantilla nueva: escribe la funcion aqui usando los
 * helpers del layout y añadela al objeto `templates` del final. No armes
 * HTML a mano en los servicios.
 */

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

export interface VerifyEmailData {
  name?: string | null;
  url: string;
  expiresInHours: number;
}

export function verifyEmail(data: VerifyEmailData): RenderedTemplate {
  const heading = `Confirma tu correo`;
  const content = [
    paragraph(escapeHtml(MAIL_COPY.greeting(data.name))),
    paragraph(
      `Gracias por crear tu cuenta en <strong>${escapeHtml(BRAND.name)}</strong>. Solo falta confirmar tu direccion de correo para activarla.`,
    ),
    button({ label: 'Confirmar mi correo', url: data.url }),
    infoBox(`Este enlace caduca en <strong>${data.expiresInHours} horas</strong>.`),
    fallbackLink(data.url),
    muted('Si no creaste esta cuenta, puedes ignorar este mensaje.'),
  ].join('\n');

  return {
    subject: `Confirma tu correo en ${BRAND.name}`,
    html: renderLayout({ heading, content, preheader: 'Activa tu cuenta confirmando tu correo.' }),
    text: toPlainText([
      MAIL_COPY.greeting(data.name),
      '',
      `Confirma tu correo para activar tu cuenta en ${BRAND.name}:`,
      data.url,
      '',
      `El enlace caduca en ${data.expiresInHours} horas.`,
      'Si no creaste esta cuenta, ignora este mensaje.',
    ]),
  };
}

export interface ResetPasswordData {
  name?: string | null;
  url: string;
  expiresInMinutes: number;
  ip?: string | null;
}

export function resetPassword(data: ResetPasswordData): RenderedTemplate {
  const heading = 'Restablecer tu contraseña';
  const content = [
    paragraph(escapeHtml(MAIL_COPY.greeting(data.name))),
    paragraph('Recibimos una solicitud para restablecer la contraseña de tu cuenta.'),
    button({ label: 'Crear una nueva contraseña', url: data.url }),
    infoBox(
      `Este enlace caduca en <strong>${data.expiresInMinutes} minutos</strong> y solo puede usarse una vez.`,
    ),
    fallbackLink(data.url),
    muted(
      data.ip
        ? `Solicitud originada desde la IP ${escapeHtml(data.ip)}. Si no fuiste tu, ignora este correo: tu contraseña no cambiara.`
        : 'Si no fuiste tu, ignora este correo: tu contraseña no cambiara.',
    ),
  ].join('\n');

  return {
    subject: `Restablece tu contraseña de ${BRAND.name}`,
    html: renderLayout({ heading, content, preheader: 'Enlace para crear una nueva contraseña.' }),
    text: toPlainText([
      MAIL_COPY.greeting(data.name),
      '',
      'Solicitaste restablecer tu contraseña. Abre este enlace:',
      data.url,
      '',
      `Caduca en ${data.expiresInMinutes} minutos y es de un solo uso.`,
      'Si no fuiste tu, ignora este correo.',
    ]),
  };
}

export interface WelcomeData {
  name?: string | null;
  loginUrl: string;
}

export function welcome(data: WelcomeData): RenderedTemplate {
  const heading = `Bienvenido a ${BRAND.name}`;
  const content = [
    paragraph(escapeHtml(MAIL_COPY.greeting(data.name))),
    paragraph(
      `Tu cuenta ya esta activa. ${escapeHtml(BRAND.tagline)}`,
    ),
    button({ label: 'Entrar a mi cuenta', url: data.loginUrl }),
    muted(`Cualquier duda, escribenos a ${escapeHtml(BRAND.supportEmail)}.`),
  ].join('\n');

  return {
    subject: `Bienvenido a ${BRAND.name}`,
    html: renderLayout({ heading, content, preheader: 'Tu cuenta ya esta activa.' }),
    text: toPlainText([
      MAIL_COPY.greeting(data.name),
      '',
      'Tu cuenta ya esta activa.',
      data.loginUrl,
    ]),
  };
}

export interface SecurityAlertData {
  name?: string | null;
  title: string;
  message: string;
  ip?: string | null;
  userAgent?: string | null;
  actionUrl?: string;
  actionLabel?: string;
}

/** Alerta generica de seguridad (cambio de contraseña, nuevo dispositivo, ...). */
export function securityAlert(data: SecurityAlertData): RenderedTemplate {
  const detalles = [
    data.ip ? `IP: ${escapeHtml(data.ip)}` : null,
    data.userAgent ? `Dispositivo: ${escapeHtml(data.userAgent)}` : null,
    `Fecha: ${new Date().toLocaleString('es-ES')}`,
  ]
    .filter(Boolean)
    .join('<br>');

  const content = [
    paragraph(escapeHtml(MAIL_COPY.greeting(data.name))),
    paragraph(escapeHtml(data.message)),
    infoBox(detalles, THEME.danger),
    data.actionUrl && data.actionLabel
      ? button({ label: data.actionLabel, url: data.actionUrl })
      : '',
    muted(
      `Si no reconoces esta actividad, cambia tu contraseña y contacta a ${escapeHtml(BRAND.supportEmail)} de inmediato.`,
    ),
  ].join('\n');

  return {
    subject: `${data.title} · ${BRAND.name}`,
    html: renderLayout({ heading: data.title, content, preheader: data.message }),
    text: toPlainText([
      MAIL_COPY.greeting(data.name),
      '',
      data.message,
      data.ip ? `IP: ${data.ip}` : '',
      data.userAgent ? `Dispositivo: ${data.userAgent}` : '',
      '',
      `Si no reconoces esta actividad, contacta a ${BRAND.supportEmail}.`,
    ]),
  };
}

export interface MfaData {
  name?: string | null;
  codigosRestantes: number;
  activada: boolean;
}

/** Aviso de activacion o desactivacion de la verificacion en dos pasos. */
export function mfaCambiada(data: MfaData): RenderedTemplate {
  const heading = data.activada
    ? 'Verificacion en dos pasos activada'
    : 'Verificacion en dos pasos desactivada';

  const content = [
    paragraph(escapeHtml(MAIL_COPY.greeting(data.name))),
    paragraph(
      data.activada
        ? 'Tu cuenta ahora pide un codigo de tu app autenticadora al iniciar sesion.'
        : 'Tu cuenta ha dejado de pedir el segundo factor. Si no fuiste tu, actua de inmediato.',
    ),
    data.activada
      ? infoBox(
          `Guarda tus <strong>${data.codigosRestantes} codigos de recuperacion</strong> en un lugar seguro: son la unica forma de entrar si pierdes el telefono.`,
          THEME.success,
        )
      : infoBox('Tu cuenta queda protegida solo por la contraseña.', THEME.danger),
    muted(`Si no reconoces este cambio, contacta a ${escapeHtml(BRAND.supportEmail)}.`),
  ].join('\n');

  return {
    subject: `${heading} · ${BRAND.name}`,
    html: renderLayout({ heading, content, preheader: heading }),
    text: toPlainText([
      MAIL_COPY.greeting(data.name),
      '',
      heading,
      data.activada
        ? `Guarda tus ${data.codigosRestantes} codigos de recuperacion en un lugar seguro.`
        : 'Tu cuenta queda protegida solo por la contraseña.',
    ]),
  };
}

export const templates = {
  verifyEmail,
  resetPassword,
  welcome,
  securityAlert,
  mfaCambiada,
} as const;
