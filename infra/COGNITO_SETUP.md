# Cognito: login y usuarios

Cómo funciona el ingreso a la app y cómo se administran las cuentas.
Para desplegar infraestructura, ver [`README.md`](README.md).

Cognito es **gratis** hasta 10.000 usuarios activos por mes.

---

## Un pool por ambiente

| Ambiente | User Pool | Quién lo maneja |
|---|---|---|
| dev | `oasi-dev` (`us-east-1_WDLIW3Jby`) | ya existía; se **reusa**, no lo toca el CDK |
| prod | `oasi-users-prod` | lo crea el stack `Oasi-Auth-prod` |

Las cuentas **no se comparten** entre ambientes: quien entra a dev no entra a
prod. Es a propósito, porque en prod van a entrar seremis y subsecretarios.

El pool de dev se reusa porque ya tiene usuarios reales adentro y recrearlo
significaría que todos pierden la cuenta. Sus ids están en
[`config.ts`](config.ts) → `CONFIG.dev.cognito`. Cuando un ambiente trae ids
ahí, el CDK no crea ningún pool.

Cada pool tiene cinco grupos, uno por rol: `admin`, `oasi`, `organismo`,
`empresa`, `region`. El grupo es solo una pista: **la tabla `usuarios` es la
que manda**, porque ahí vive el alcance (qué empresa, qué organismo, qué
región), y un rol sin su alcance no se puede aplicar. Si falta, el backend
rechaza el ingreso en vez de mostrar todo.

---

## Cómo se autentica cada request

`AUTH_MODE` decide el modo:

| | `AUTH_MODE=dev` | `AUTH_MODE=cognito` |
|---|---|---|
| Dónde | solo en tu PC | siempre en AWS (lo fija el CDK) |
| Valida el token | no | sí, contra el JWKS del pool |
| De dónde sale el rol | headers `x-dev-*` (selector en la barra superior) | del token |

**`AUTH_MODE=dev` en un ambiente desplegado dejaría que cualquiera eligiera su
propio rol con un header HTTP.** Por eso el CDK lo fija en `cognito` y no es
configurable.

---

## Variables del frontend

El sitio necesita saber a qué pool hablarle. Son públicas por diseño (viajan
dentro del bundle del navegador):

```
VITE_API_URL=<URL del HTTP API del ambiente>
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_REGION=us-east-1
```

- **En Amplify**: se configuran por rama, y no a mano:
  `scripts/amplify-env.sh <app-id> develop dev` las lee de lo que ya está
  desplegado y las escribe.
- **En tu PC**: en `.env` (vacías, para usar el selector de rol) o en
  `.env.aws` (con los valores de dev, para `npm run dev:aws`).

Vite las incrusta al compilar, así que cambiar una exige un build nuevo.

Si las variables están vacías, el frontend no muestra login: usa el selector
de rol contra un backend local en `AUTH_MODE=dev`.

---

## Primer admin de un ambiente

Son dos mitades: la cuenta vive en Cognito y el rol en la tabla `usuarios`.
Un script hace las dos:

```bash
cd proyectos-backend
export AWS_PROFILE=oasi
scripts/create-admin.sh dev tu.correo@economia.cl "Tu Nombre"
```

Crea la cuenta en Cognito (o reusa la que exista), la mete al grupo `admin` y
escribe la fila en `usuarios` a través de la Lambda `oasi-db-ops-<env>`. A una
cuenta nueva le llega un correo con contraseña temporal, y la pantalla de
login se encarga del cambio obligatorio en el primer ingreso.

**Del segundo usuario en adelante no se usa la consola ni la CLI:** se crean
desde **Administración → Usuarios** en la propia app. Esa pantalla hace las
dos mitades en una acción (cuenta en Cognito + fila con rol y alcance), y al
eliminar un usuario borra las dos.

Para que esa pantalla funcione **corriendo en tu PC** necesita tus
credenciales de AWS:

```bash
# en proyectos-backend/.env
AWS_PROFILE=oasi
```

Desplegada no hace falta nada: la Lambda ya tiene exactamente los cuatro
permisos que usa (`AdminCreateUser`, `AdminAddUserToGroup`,
`AdminRemoveUserFromGroup`, `AdminDeleteUser`), acotados a su propio pool.

---

## Límite de correos

El correo lo manda Cognito, con un tope de **50 mensajes por día**. Alcanza
para invitaciones y recuperación de contraseña de un equipo chico.

Si alguna vez hay que dar de alta a mucha gente de golpe, hay que pasar a SES
con un remitente `@economia.cl`. Es un cambio en `lib/auth-stack.ts`
(`UserPoolEmail.withSES`) más la verificación del dominio.

---

## Diseño de los correos

Invitación (cuenta nueva + contraseña temporal) y recuperación de contraseña
tienen un HTML propio: logo del Ministerio, franja de colores del Gobierno,
recuadro con la contraseña o el código, y botón "Ingresar a OASI" que lleva a
la app de ese ambiente (`appUrl` en `config.ts`).

- Plantillas: **`lib/correos.ts`** (única fuente).
- **prod**: las aplica CDK -> `cd infra && npx cdk deploy Oasi-Auth-prod`.
- **dev**: el pool es viejo y CDK no lo maneja ->
  `AWS_PROFILE=oasi npx tsx scripts/correos-cognito.ts --env=dev`.

### Si el correo llega "sin formato" o a Correo no deseado

Outlook convierte a **texto plano** (sin colores, logo ni botón) todo lo que
cae en "Correo no deseado", y avisa arriba: *"Este mensaje se ha convertido a
texto sin formato"*. No es la plantilla: es el remitente. Cognito manda por
defecto desde `no-reply@verificationemail.com`, que los filtros del
Exchange de `economia.cl` marcan como spam.

Dos arreglos, los dos requieren a TI del ministerio:

1. **Rápido**: que TI agregue `no-reply@verificationemail.com` a la lista de
   remitentes seguros del Exchange.
2. **Definitivo**: mandar desde una casilla propia (ej.
   `no-responder@economia.cl`) con SES. Requiere que TI publique en el DNS de
   `economia.cl` los registros DKIM/SPF que da SES, y cambiar
   `email: cognito.UserPoolEmail.withSES(...)` en `lib/auth-stack.ts`. De paso
   saca el tope de 50 correos por día.

---

## Contraseñas

Política del pool: mínimo 12 caracteres, con mayúscula, minúscula, número y
símbolo. Recuperación solo por correo.

El token de sesión dura 8 horas; el de refresco, 30 días.
