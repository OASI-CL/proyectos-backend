/**
 * ============================================================================
 * CORREOS DE COGNITO — plantillas HTML (única fuente)
 * ============================================================================
 *
 * Cognito manda solo dos correos en esta app:
 *   - invitación: cuenta creada por un admin, con contraseña temporal
 *   - recuperación: código para "Olvidé mi contraseña"
 *
 * Los usan:
 *   - infra/lib/auth-stack.ts          -> pool de PROD (lo maneja CDK)
 *   - scripts/correos-cognito.ts       -> pool de DEV (pool viejo que CDK no
 *                                         maneja; se actualiza por la API)
 * Si se cambia el diseño acá, hay que desplegar Oasi-Auth-prod y correr el
 * script para dev.
 *
 * Reglas de HTML para correo (no son caprichos):
 *   - Todo con <table> y estilos EN LÍNEA: Outlook y Gmail ignoran <style>,
 *     flexbox, grid y la mayoría del CSS moderno.
 *   - El botón es una celda de tabla con fondo + un <a>: es la única forma de
 *     que se vea como botón también en Outlook.
 *   - Placeholders que reemplaza Cognito: {username} y {####}. No tocarlos.
 *   - Límite de Cognito: 20.000 caracteres por mensaje.
 *
 * OJO: si el correo cae en "Correo no deseado", Outlook lo convierte a texto
 * sin formato (sin colores, sin logo, sin botón). Eso no es la plantilla: es
 * el remitente por defecto de Cognito (no-reply@verificationemail.com). Se
 * arregla mandando desde un dominio propio con SES (ver COGNITO_SETUP.md).
 * ============================================================================
 */

// Colores oficiales Gobierno de Chile + los de la app.
const AZUL_GOB = '#0F69B4'
const ROJO_GOB = '#EB3C46'
const AZUL_OSCURO = '#1B2A56'
const TEXTO = '#2B3445'
const GRIS = '#6B7280'
const FONDO = '#F2F5FA'

const FUENTE = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

/** Logo del Ministerio, servido por el frontend (URL pública con https). */
export const LOGO_URL = 'https://main.dyfx5stqf038v.amplifyapp.com/logo-ministerio.png'

function marco(appUrl: string, preheader: string, contenido: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OASI</title>
</head>
<body style="margin:0;padding:0;background:${FONDO};">
<!-- texto que muestra la bandeja de entrada como vista previa -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FONDO};">
<tr><td align="center" style="padding:36px 16px;">

  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(27,42,86,0.08);">

    <!-- franja con los colores del Gobierno -->
    <tr><td style="padding:0;font-size:0;line-height:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="35%" height="6" style="background:${AZUL_GOB};height:6px;font-size:0;line-height:0;">&nbsp;</td>
        <td width="65%" height="6" style="background:${ROJO_GOB};height:6px;font-size:0;line-height:0;">&nbsp;</td>
      </tr></table>
    </td></tr>

    <!-- encabezado: logo + marca -->
    <tr><td style="padding:26px 36px 22px;border-bottom:1px solid #E6EAF2;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="vertical-align:middle;padding-right:16px;">
          <img src="${LOGO_URL}" width="62" height="56" alt="Ministerio de Economía, Fomento y Turismo" style="display:block;border:0;width:62px;height:56px;">
        </td>
        <td style="vertical-align:middle;border-left:1px solid #E6EAF2;padding-left:16px;">
          <div style="font-family:${FUENTE};font-size:24px;font-weight:800;letter-spacing:1.5px;color:${AZUL_OSCURO};line-height:1;">OASI</div>
          <div style="font-family:${FUENTE};font-size:12.5px;color:${GRIS};margin-top:5px;line-height:1.3;">Seguimiento de permisos sectoriales</div>
        </td>
      </tr></table>
    </td></tr>

    <!-- contenido -->
    <tr><td style="padding:34px 36px 8px;font-family:${FUENTE};color:${TEXTO};font-size:16px;line-height:1.6;">
      ${contenido}
    </td></tr>

    <!-- botón -->
    <tr><td align="left" style="padding:18px 36px 34px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td align="center" bgcolor="${AZUL_GOB}" style="border-radius:10px;background:${AZUL_GOB};">
          <a href="${appUrl}" target="_blank" style="display:inline-block;padding:15px 34px;font-family:${FUENTE};font-size:16px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:10px;">Ingresar a OASI &rarr;</a>
        </td>
      </tr></table>
      <div style="font-family:${FUENTE};font-size:12.5px;color:${GRIS};margin-top:12px;">
        O copiá este link: <a href="${appUrl}" style="color:${AZUL_GOB};text-decoration:underline;">${appUrl}</a>
      </div>
    </td></tr>

    <!-- pie -->
    <tr><td style="padding:20px 36px;background:#F7F9FC;border-top:1px solid #E6EAF2;font-family:${FUENTE};font-size:12px;color:${GRIS};line-height:1.5;">
      <strong style="color:${AZUL_OSCURO};">OASI &middot; Seguimiento de permisos sectoriales</strong><br>
      Ministerio de Economía, Fomento y Turismo &middot; Gobierno de Chile<br>
      Este es un correo automático, por favor no lo respondas.
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`
}

/** Recuadro destacado para la contraseña o el código. */
function recuadro(etiqueta: string, valor: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 4px;">
<tr><td style="background:#EEF5FC;border:1px solid #CFE0F3;border-left:5px solid ${AZUL_GOB};border-radius:10px;padding:16px 20px;">
  <div style="font-family:${FUENTE};font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${GRIS};">${etiqueta}</div>
  <div style="font-family:Consolas,'Courier New',monospace;font-size:26px;font-weight:700;letter-spacing:2px;color:${AZUL_OSCURO};margin-top:6px;">${valor}</div>
</td></tr>
</table>`
}

export function correoInvitacion(appUrl: string): { asunto: string; html: string } {
  return {
    asunto: 'Bienvenido/a a OASI: tu cuenta está lista',
    html: marco(
      appUrl,
      'Tu cuenta de OASI fue creada. Adentro está tu contraseña temporal.',
      `<div style="font-size:26px;font-weight:800;color:${AZUL_OSCURO};line-height:1.25;margin:0 0 10px;">¡Te damos la bienvenida! 👋</div>
<p style="margin:0 0 22px;color:${GRIS};">Te crearon una cuenta en <strong style="color:${TEXTO};">OASI</strong>, la plataforma de seguimiento de permisos sectoriales del Ministerio de Economía.</p>

<p style="margin:0 0 6px;"><strong>Tu usuario</strong></p>
<p style="margin:0 0 18px;font-size:17px;"><strong style="color:${AZUL_GOB};">{username}</strong></p>

${recuadro('Contraseña temporal', '{####}')}

<p style="margin:22px 0 8px;"><strong>Próximos pasos</strong></p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="font-family:${FUENTE};font-size:15px;color:${TEXTO};line-height:1.5;">
<tr><td valign="top" style="padding:3px 10px 3px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:${AZUL_GOB};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">1</span></td><td style="padding:3px 0;">Entrá con el botón de abajo, usando tu correo y la contraseña temporal.</td></tr>
<tr><td valign="top" style="padding:3px 10px 3px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:${AZUL_GOB};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">2</span></td><td style="padding:3px 0;">Te va a pedir crear <strong>tu propia contraseña</strong> (mínimo 12 caracteres, con mayúscula, número y símbolo).</td></tr>
<tr><td valign="top" style="padding:3px 10px 3px 0;"><span style="display:inline-block;width:22px;height:22px;border-radius:11px;background:${AZUL_GOB};color:#fff;font-size:12px;font-weight:700;text-align:center;line-height:22px;">3</span></td><td style="padding:3px 0;">¡Listo! La contraseña temporal <strong>vence en 7 días</strong>.</td></tr>
</table>`,
    ),
  }
}

export function correoRecuperacion(appUrl: string): { asunto: string; html: string } {
  return {
    asunto: 'Tu código para recuperar la contraseña de OASI',
    html: marco(
      appUrl,
      'Usá este código para crear una contraseña nueva en OASI.',
      `<div style="font-size:26px;font-weight:800;color:${AZUL_OSCURO};line-height:1.25;margin:0 0 10px;">Recuperá tu contraseña 🔑</div>
<p style="margin:0 0 22px;color:${GRIS};">Recibimos una solicitud para cambiar la contraseña de tu cuenta de <strong style="color:${TEXTO};">OASI</strong>. Ingresá este código en la pantalla de recuperación:</p>

${recuadro('Código de verificación', '{####}')}

<p style="margin:22px 0 0;font-size:14px;color:${GRIS};">
<strong style="color:${TEXTO};">¿No fuiste vos?</strong> Ignorá este correo: tu contraseña actual sigue funcionando y nadie puede cambiarla sin este código.
</p>`,
    ),
  }
}
