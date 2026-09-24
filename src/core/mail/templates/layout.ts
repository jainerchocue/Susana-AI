import { BRAND, MAIL_COPY, THEME } from '../../../config/constants';

/**
 * Layout base de todos los emails. Tabla + estilos inline: es lo unico que
 * renderiza igual en Outlook, Gmail y Apple Mail.
 *
 * Regla: no tocar este archivo para personalizar la marca. Todo lo editable
 * esta en src/config/constants.ts (BRAND, THEME, MAIL_COPY).
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface ButtonOptions {
  label: string;
  url: string;
}

export function button({ label, url }: ButtonOptions): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:28px 0;">
    <tr>
      <td align="center" bgcolor="${THEME.primary}" style="border-radius:${THEME.radius};">
        <a href="${escapeHtml(url)}"
           style="display:inline-block;padding:14px 32px;font-family:${THEME.fontFamily};font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:${THEME.radius};">
          ${escapeHtml(label)}
        </a>
      </td>
    </tr>
  </table>`;
}

export function paragraph(text: string): string {
  return `<p style="margin:0 0 16px;font-family:${THEME.fontFamily};font-size:15px;line-height:1.6;color:${THEME.text};">${text}</p>`;
}

export function muted(text: string): string {
  return `<p style="margin:0 0 12px;font-family:${THEME.fontFamily};font-size:13px;line-height:1.6;color:${THEME.textMuted};">${text}</p>`;
}

export function fallbackLink(url: string): string {
  return `
    ${muted(MAIL_COPY.fallbackLinkLabel)}
    <p style="margin:0 0 24px;font-family:${THEME.fontFamily};font-size:12px;line-height:1.5;color:${THEME.primary};word-break:break-all;">
      ${escapeHtml(url)}
    </p>`;
}

export function infoBox(text: string, color: string = THEME.textMuted): string {
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
    <tr>
      <td style="padding:14px 16px;background:${THEME.background};border-left:3px solid ${color};border-radius:6px;font-family:${THEME.fontFamily};font-size:13px;line-height:1.6;color:${THEME.text};">
        ${text}
      </td>
    </tr>
  </table>`;
}

export interface LayoutOptions {
  /** Titulo grande dentro del email. */
  heading: string;
  /** HTML del cuerpo, construido con los helpers de arriba. */
  content: string;
  /** Texto de preheader (el que se ve en la bandeja junto al asunto). */
  preheader?: string;
}

export function renderLayout({ heading, content, preheader }: LayoutOptions): string {
  const social = BRAND.social
    .map(
      (s) =>
        `<a href="${escapeHtml(s.url)}" style="color:${THEME.textMuted};text-decoration:underline;margin:0 6px;">${escapeHtml(s.label)}</a>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${THEME.background};">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>` : ''}
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${THEME.background};padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:${THEME.maxWidth};">

          <tr>
            <td align="center" style="padding:0 0 24px;">
              <a href="${escapeHtml(BRAND.websiteUrl)}" style="font-family:${THEME.fontFamily};font-size:20px;font-weight:700;color:${THEME.primary};text-decoration:none;">
                ${escapeHtml(BRAND.name)}
              </a>
            </td>
          </tr>

          <tr>
            <td style="background:${THEME.surface};border:1px solid ${THEME.border};border-radius:${THEME.radius};padding:36px 32px;">
              <h1 style="margin:0 0 20px;font-family:${THEME.fontFamily};font-size:22px;line-height:1.3;font-weight:700;color:${THEME.text};">
                ${escapeHtml(heading)}
              </h1>
              ${content}
              <p style="margin:28px 0 0;font-family:${THEME.fontFamily};font-size:15px;line-height:1.6;color:${THEME.text};">
                ${escapeHtml(MAIL_COPY.signature)}
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:24px 16px 0;">
              <p style="margin:0 0 8px;font-family:${THEME.fontFamily};font-size:12px;line-height:1.6;color:${THEME.textMuted};">
                ${escapeHtml(MAIL_COPY.footerNote)}
              </p>
              <p style="margin:0 0 8px;font-family:${THEME.fontFamily};font-size:12px;color:${THEME.textMuted};">
                ${social}
              </p>
              <p style="margin:0;font-family:${THEME.fontFamily};font-size:11px;line-height:1.6;color:${THEME.textMuted};">
                ${escapeHtml(BRAND.address)} &middot;
                <a href="mailto:${escapeHtml(BRAND.supportEmail)}" style="color:${THEME.textMuted};">${escapeHtml(BRAND.supportEmail)}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Version texto plano. Obligatoria: mejora entregabilidad y accesibilidad. */
export function toPlainText(lines: string[]): string {
  return [...lines, '', MAIL_COPY.signature, BRAND.name, BRAND.websiteUrl].join('\n');
}
