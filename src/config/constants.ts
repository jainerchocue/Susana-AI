import { env } from './env';

/**
 * Constantes de personalizacion. Todo lo que un cliente querria cambiar
 * (marca, colores, textos de las plantillas de email) vive aqui y en ningun
 * otro sitio. Las plantillas NO deben tener strings de marca hardcodeados.
 */

export const BRAND = {
  name: 'Hospital Intelligence',
  tagline: 'Tu plataforma, lista para producir.',
  logoUrl: `${env.APP_URL}/logo.png`,
  websiteUrl: env.APP_URL,
  supportEmail: 'soporte@plantilla.dev',
  address: 'Calle Falsa 123, Ciudad, Pais',
  social: [
    { label: 'Web', url: env.APP_URL },
    // { label: 'X', url: 'https://x.com/…' },
  ] as ReadonlyArray<{ label: string; url: string }>,
} as const;

export const THEME = {
  primary: '#4f46e5',
  primaryDark: '#4338ca',
  text: '#1f2937',
  textMuted: '#6b7280',
  background: '#f4f5f7',
  surface: '#ffffff',
  border: '#e5e7eb',
  danger: '#dc2626',
  success: '#16a34a',
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  radius: '10px',
  maxWidth: '600px',
} as const;

/** Textos comunes de las plantillas de email. */
export const MAIL_COPY = {
  greeting: (nombre?: string | null) => (nombre ? `Hola ${nombre},` : 'Hola,'),
  footerNote: `Recibiste este correo porque tienes una cuenta en ${BRAND.name}.`,
  fallbackLinkLabel: 'Si el boton no funciona, copia y pega este enlace en tu navegador:',
  signature: `El equipo de ${BRAND.name}`,
} as const;

/** Rutas del frontend a las que apuntan los enlaces enviados por email. */
export const FRONTEND_ROUTES = {
  verifyEmail: (token: string) => `${env.APP_URL}/auth/verificar-email?token=${token}`,
  resetPassword: (token: string) => `${env.APP_URL}/auth/restablecer?token=${token}`,
  login: `${env.APP_URL}/auth/login`,
  oauthCallback: `${env.APP_URL}/auth/oauth/callback`,
} as const;

/** Nombres de cookies. Cambiarlos invalida sesiones existentes. */
export const COOKIES = {
  refreshToken: 'rt',
  oauthState: 'oauth_state',
  oauthVerifier: 'oauth_verifier',
} as const;

export const PAGINATION = {
  defaultPage: 1,
  defaultLimit: 20,
  maxLimit: 100,
} as const;
