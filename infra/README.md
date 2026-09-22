# Infraestructura OASI

Todo lo que corre en AWS, definido en código (AWS CDK). Escrito para poder
retomarlo dentro de seis meses sin acordarse de nada.

**El único archivo que vas a querer editar es [`config.ts`](config.ts).**

---

## Estado actual (22 de septiembre de 2026)

**dev está desplegado y funcionando.**

| | |
|---|---|
| API de dev | `https://39dg0v2j8j.execute-api.us-east-1.amazonaws.com/dev` |
| Base de dev | `oasi_dev` en el servidor `oasi-shared`, con 318 proyectos, 1.552 permisos, 112 empresas y 10 comités cargados |
| Login de dev | pool `oasi-dev`, con `oasi-ti@economia.cl` como admin |
| prod | la base `oasi_prod` y su usuario ya existen (vacías). Falta desplegar sus stacks: pasa con el primer merge a `main` |
| Amplify | pendiente: hay que crear las dos apps por consola (ver "Amplify" abajo) |
| GitHub | pendiente: crear los Environments `dev` y `prod` con su secreto (ver "CI/CD") |

Comprobado ejecutando, no asumido: la API responde y llega a su base
(`/health/db`), rechaza pedidos sin token (401), y las credenciales de dev
**no** pueden abrir la base de prod (`permission denied for database
"oasi_prod"`).

### Operar el día a día

| Tarea | Comando / lugar |
|---|---|
| Ver estado de la base | `scripts/db-ops.sh <env> status` |
| Aplicar migraciones | `npm run db:migrate -- --env=<env>` |
| Probar el aislamiento entre ambientes | `scripts/db-ops.sh <env> check-isolation` |
| Ver por qué falló la API | CloudWatch → `/aws/lambda/oasi-api-<env>` |
| Ver por qué falló una migración | CloudWatch → `/aws/lambda/oasi-db-ops-<env>` |
| Ver el gasto | Billing and Cost Management → Cost Explorer |

---

## Qué levanta cada stack

```
                        ┌──────────────────────────────────────┐
  COMPARTIDOS           │  Oasi-Account                        │  a mano, 1 vez
  (una vez para los     │  · acceso de GitHub por OIDC         │
   dos ambientes)       │  · 1 rol de deploy por ambiente      │
                        │  · aviso de presupuesto (US$100)     │
                        └──────────────────────────────────────┘
                        ┌──────────────────────────────────────┐
                        │  Oasi-Network                        │
                        │  · VPC 10.0.0.0/16, 2 zonas          │
                        │  · subnets públicas / privadas /     │
                        │    aisladas                          │
                        │  · NAT instance t4g.nano (~US$7/mes) │
                        │  · endpoint de S3 (gratis)           │
                        │  · security groups                   │
                        └──────────────────────────────────────┘
                        ┌──────────────────────────────────────┐
                        │  Oasi-Database                       │
                        │  · 1 RDS Postgres db.t4g.micro       │
                        │    con DOS bases adentro:            │
                        │      oasi_dev   ← oasi_dev_user      │
                        │      oasi_prod  ← oasi_prod_user     │
                        │  · 1 secreto por ambiente + maestro  │
                        │  · Lambda oasi-db-bootstrap          │
                        └──────────────────────────────────────┘

  POR AMBIENTE          ┌────────────────────┬────────────────────┐
  (dev y prod,          │  dev               │  prod              │
   idénticos)           ├────────────────────┼────────────────────┤
                        │ Oasi-Auth-dev      │ Oasi-Auth-prod     │  Cognito
                        │ (ya existía, se    │ (lo crea el CDK)   │
                        │  reusa, ver abajo) │                    │
                        ├────────────────────┼────────────────────┤
                        │ Oasi-Storage-dev   │ Oasi-Storage-prod  │  bucket S3
                        ├────────────────────┼────────────────────┤
                        │ Oasi-Api-dev       │ Oasi-Api-prod      │  · Lambda oasi-api-<env>
                        │                    │                    │  · HTTP API, stage <env>
                        │                    │                    │  · Lambda oasi-db-ops-<env>
                        │                    │                    │  · alarmas por correo
                        └────────────────────┴────────────────────┘

  FRONTEND              Amplify Hosting, 1 app por ambiente.
                        NO está en el CDK (ver "Amplify" más abajo).
```

Cómo viaja un request:

```
Navegador ──► Amplify (sitio React)
   │
   ├──► Cognito  (login, devuelve un token)
   │
   └──► HTTP API ──► Lambda oasi-api-<env> ──► RDS  (base privada, sin internet)
                            │                  └──► Secrets Manager (contraseña)
                            └──► S3 (adjuntos, con URL prefirmada)
```

### Por qué dev y prod comparten la red y el servidor de base

Un servidor RDS encendido cuesta ~US$14/mes aunque nadie lo use, y una salida
a internet privada otros ~US$7. Duplicar las dos cosas para 20 usuarios y una
base de pocos MB serían ~US$21/mes extra sin beneficio real.

Comparten **el cableado y el servidor**. No comparten nada de lo que importa:
cada ambiente tiene su base, su usuario de Postgres, su secreto, su Cognito,
su Lambda, su API y su bucket.

El aislamiento entre las dos bases está en tres capas independientes
(`lib/database-stack.ts` y `src/ops/dbBootstrap.ts`):

1. **Postgres**: cada usuario es dueño solo de su base; se le quita
   explícitamente el permiso de conectarse a la del otro ambiente, y se le
   quita a `PUBLIC` (que por defecto deja entrar a cualquier rol).
2. **Secrets Manager**: un secreto por ambiente.
3. **IAM**: la Lambda de dev solo tiene permiso para leer el secreto de dev.

Aunque alguien pegue mal un connection string, las credenciales de dev no
abren prod.

---

## Requisitos

```bash
export AWS_PROFILE=oasi     # credenciales con permisos de administrador
cd proyectos-backend
npm ci && npm ci --prefix infra
```

Una sola vez por cuenta (ya está hecho): `npx cdk bootstrap` dentro de `infra/`.

---

## Cómo desplegar

Antes de cualquier deploy conviene mirar qué va a cambiar:

```bash
cd infra
npx cdk diff --all --context env=dev     # no toca nada, solo compara
```

Desplegar:

```bash
# El paquete de la Lambda se construye y se prueba primero, siempre
cd proyectos-backend
npm run check

cd infra
npx cdk deploy --all --context env=dev     # dev
npx cdk deploy --all --context env=prod    # prod
```

`--context env=dev` deja fuera de la app los stacks de prod, así que un
`--all` de dev no puede tocar producción (y viceversa).

`Oasi-Account` queda fuera cuando se usa `--context env=...`, a propósito:
define los permisos con los que corre el CI, así que se despliega aparte y a
mano:

```bash
npx cdk deploy Oasi-Account
```

**En el día a día no hace falta desplegar a mano:** un push a `develop`
despliega dev y un merge a `main` despliega prod (ver "CI/CD").

### La primera vez de un ambiente

```bash
cd proyectos-backend
npm run check
cd infra && npx cdk deploy --all --context env=dev && cd ..

npm run db:bootstrap                  # crea bases, usuarios y permisos
npm run db:migrate -- --env=dev       # crea las tablas
scripts/load-data.sh dev              # carga los datos históricos (opcional, 1 vez)
scripts/create-admin.sh dev tu@correo.cl "Tu Nombre"   # primer admin
scripts/db-ops.sh dev status          # revisar cómo quedó
scripts/db-ops.sh dev check-isolation # comprobar que no alcanza la base del otro ambiente
```

Después del deploy, AWS manda un correo de **"Subscription Confirmation"** a
la dirección de `config.ts`: hay que hacer clic, o las alarmas nunca llegan.

---

## Migraciones de base de datos

```bash
npm run db:migrate -- --env=local    # tu Postgres de WSL (el del .env)
npm run db:migrate -- --env=dev      # la base de dev en AWS
npm run db:migrate -- --env=prod     # la base de prod en AWS
```

La base de AWS no tiene salida ni entrada a internet, así que tu PC no puede
conectarse. El comando le pide a la Lambda `oasi-db-ops-<env>`, que sí está
adentro de esa red, que aplique las migraciones. Es el mismo código en los
tres casos (`src/db/migrate.ts`).

Lo aplicado queda registrado en la tabla `_migrations`; cada archivo corre una
sola vez por base.

**Para escribir una migración nueva:**

1. Creá `db/migrations/NNN_descripcion.sql` con el número siguiente.
2. **No pongas `BEGIN`/`COMMIT`**: el runner envuelve cada archivo y su
   registro en una transacción, así un error no deja nada a medias.
3. Aplicá el mismo cambio a `db/schema.sql`, para que una base nueva nazca igual.
4. Nada de comandos de psql (líneas que empiezan con `\`): esto corre por el
   driver, no por psql.
5. Probá con `--env=local`, después subí. El CI la aplica sola al desplegar.

Escribí migraciones que funcionen mientras la versión **anterior** de la API
todavía está respondiendo (agregar una columna antes de usarla; dejar de usar
una columna antes de borrarla). La Lambda cambia de versión segundos después
de la migración, no en el mismo instante.

---

## Cómo cambiar dev de base compartida a su propio servidor RDS

Dos pasos:

1. En [`config.ts`](config.ts), en `CONFIG.dev.database`, cambiá
   `mode: 'shared'` por `mode: 'dedicated'`.
2. `cd infra && npx cdk deploy --all --context env=dev`

CDK crea una instancia RDS nueva para dev (~US$14/mes más) y la Lambda de dev
pasa a usarla. Después: `npm run db:bootstrap` y
`npm run db:migrate -- --env=dev` para dejarla con el schema, y
`scripts/load-data.sh dev` si querés datos.

El mismo cambio al revés vuelve a la compartida (ojo: el servidor dedicado
queda creado, hay que borrarlo a mano desde la consola de RDS).

Para volver a apuntar dev a tu Postgres local: `mode: 'local'`. En ese caso el
CDK no crea base ni configura la Lambda de dev para conectarse a ninguna (la
Lambda desplegada no va a poder leer datos: tu PC no acepta conexiones desde
AWS), y el CI se saltea el paso de migraciones.

---

## Cómo agregar una IP a las permitidas del RDS

Hoy la base **no es accesible desde internet**, así que no hay ninguna IP
permitida y la lista está vacía. Esto es para el día que quieras conectarte
con pgAdmin o DBeaver desde tu PC.

1. Averiguá tu IP: https://checkip.amazonaws.com
2. En [`config.ts`](config.ts) → `SHARED.database`:
   ```ts
   publiclyAccessible: true,              // de false a true
   allowedDbIps: ['190.100.20.30/32'],    // tu IP, con /32 al final
   ```
3. `cd infra && npx cdk deploy Oasi-Network Oasi-Database --context env=dev`

El `/32` significa "exactamente esta IP". Si la conexión de tu casa cambia de
IP (lo normal), hay que actualizarla.

**Ojo con lo que implica:** la base pasa a subnets públicas y queda
alcanzable desde internet para esas IPs. Son datos de gobierno; volvé a
`publiclyAccessible: false` cuando termines.

---

## Qué hacer si un deploy falla a la mitad

CloudFormation revierte solo: deja el stack como estaba antes y lo marca
`UPDATE_ROLLBACK_COMPLETE` o `ROLLBACK_COMPLETE`. No hay que apurarse a
borrar nada.

1. **Leé la causa real.** El error que muestra la terminal suele ser el
   resumen. El bueno está en la consola → CloudFormation → el stack →
   pestaña **Events**, buscando el primer `CREATE_FAILED`/`UPDATE_FAILED`
   desde abajo (el primero en el tiempo, no el último).

   ```bash
   aws cloudformation describe-stack-events --stack-name Oasi-Api-dev \
     --query "StackEvents[?ResourceStatusReason!=null].[Timestamp,LogicalResourceId,ResourceStatus,ResourceStatusReason]" \
     --output text | head -20
   ```

2. **Arreglá el código y volvé a desplegar.** En la mayoría de los casos
   alcanza con eso.

3. Si el stack quedó en `ROLLBACK_COMPLETE` (falló mientras se creaba por
   primera vez), CloudFormation no lo deja actualizar: hay que borrarlo y
   crearlo de nuevo.
   ```bash
   npx cdk destroy Oasi-Api-dev --context env=dev
   ```

4. Si falla el paso de migraciones (no el de CloudFormation), la
   infraestructura quedó bien y la base a medias. El log completo está en
   CloudWatch → `/aws/lambda/oasi-db-ops-<env>`. Se corrige y se vuelve a
   correr `npm run db:migrate -- --env=<env>`: las migraciones ya aplicadas no
   se repiten.

**Si la API responde 500 y el log dice "connection timeout":** casi seguro se
apagó el NAT instance, o arrancó mal. Es el punto débil conocido de ahorrar
US$25/mes.

```bash
# 1. ¿Está prendido?
aws ec2 describe-instances --filters Name=tag:Name,Values=oasi-nat \
  --query 'Reservations[].Instances[].[InstanceId,State.Name]' --output text
aws ec2 start-instances --instance-ids <id>

# 2. ¿Se configuró bien? Tiene que aparecer MASQUERADE e iptables-save,
#    y NO tiene que aparecer "Killed" (eso es falta de memoria).
aws ec2 get-console-output --instance-id <id> --latest --query Output --output text \
  | grep -E "MASQUERADE|iptables-save|Killed"
```

Si arrancó mal, la forma de rehacerlo es forzar una instancia nueva: cambiale
la letra al id en `lib/network-stack.ts`
(`natInstance.overrideLogicalId('OasiNatInstanceA')` → `...B`) y desplegá
`Oasi-Network`. El user data solo corre en el primer arranque, así que
reiniciar la máquina no vuelve a configurarla.

### Dos errores que ya nos pasaron, para no perder tiempo de nuevo

**"An internal error has occurred (Service: Ec2, Status Code: 500)" al crear
`VpcprivateSubnetNDefaultRoute`.** Pasa cuando la ruta apunta al **id de la
instancia** NAT, que es la forma antigua de EC2. Nos rebotó dos despliegues
seguidos. Por eso el NAT de acá está armado a mano —su interfaz de red se
crea aparte y las rutas apuntan a **la interfaz**—, en vez de usar
`ec2.NatProvider.instanceV2` de CDK, que usa el id de la instancia. Si algún
día alguien "simplifica" eso volviendo al provider, este error vuelve.

**No se puede borrar una base de datos detenida.** Si un `cdk destroy` se
queda en `DELETE_IN_PROGRESS` durante mucho rato, es casi seguro eso:
prendela con `aws rds start-db-instance` y la eliminación sigue sola.

---

## CI/CD

| Rama | Workflow | Qué hace |
|---|---|---|
| `develop` | `.github/workflows/deploy-dev.yml` | revisa → despliega dev → migra → verifica |
| `main` | `.github/workflows/deploy-prod.yml` | revisa → **espera aprobación** → despliega prod → migra → verifica |

Los pull request solo corren la revisión y **nunca** reciben credenciales de
AWS. La revisión incluye typecheck de la API y de la infraestructura,
construir el paquete real de la Lambda y probarlo desde una copia fuera del
repo, y sintetizar CloudFormation.

Un deploy verde significa que la API responde **y llega a su base de datos**
(el último paso llama a `/health/db`), no solo que CloudFormation terminó.

Las credenciales son por **OIDC**: GitHub pide un token temporal a AWS en cada
corrida. No hay claves de AWS guardadas en GitHub. Cada rol solo puede ser
asumido por un job que corra en su GitHub Environment, así que un deploy de
dev no puede tocar prod.

### Configuración en GitHub (una vez)

**Settings → Environments**, dos ambientes:

| Environment | Secret `AWS_DEPLOY_ROLE_ARN` | Protección |
|---|---|---|
| `dev` | `arn:aws:iam::533354334744:role/oasi-github-deploy-dev` | ninguna |
| `prod` | `arn:aws:iam::533354334744:role/oasi-github-deploy-prod` | **Required reviewers**: vos · **Deployment branches**: solo `main` |

**Settings → Rules → New branch ruleset**, para `main`: exigir pull request y
que pase el check de CI, y bloquear force push. Eso es lo que hace que "a prod
solo llega lo que pasó por develop" sea cierto y no solo una costumbre.

---

## Amplify (el frontend)

No está en el CDK **a propósito**: conectar Amplify a GitHub desde CDK obliga
a guardar un token de GitHub de larga vida en Secrets Manager y a rotarlo a
mano. Se conecta una vez por consola y listo.

1. Consola → **Amplify** → **Create new app** → GitHub → autorizar.
2. Repo `OASI-CL/proyectos-frontend`, rama `develop` (y después otra app para
   `main`). Amplify detecta `amplify.yml` solo.
3. El primer build falla a propósito: falta `VITE_API_URL`. Se arregla con:
   ```bash
   scripts/amplify-env.sh <app-id> develop dev
   ```
   Eso lee lo que ya está desplegado y configura las variables de esa rama,
   la redirección para que funcionen los links profundos, y lanza un build.
4. Copiá la URL del sitio a `frontendOrigins` del ambiente en `config.ts` y
   desplegá `Oasi-Api-<env>`, o la API va a rechazar al sitio por CORS.

---

## Costo mensual estimado

us-east-1, precios bajo demanda, para los **dos ambientes juntos**:

| Servicio | US$/mes | Nota |
|---|---|---|
| RDS `db.t4g.micro` | 11,70 | el servidor, compartido |
| Disco 20 GB gp3 | 2,30 | mínimo de RDS |
| Backups (7 días) | ~0 | gratis hasta el tamaño de la base |
| NAT instance t4g.nano | 3,10 | en vez de US$32 del NAT Gateway |
| Disco del NAT + IP pública | 4,30 | |
| Secrets Manager (3 secretos) | 1,20 | |
| Alarmas CloudWatch (4) | 0,40 | |
| Lambda + HTTP API + S3 | ~0,10 | bajo las capas gratis permanentes |
| Cognito | 0 | gratis hasta 10.000 usuarios/mes |
| Amplify (2 apps) | ~1,00 | builds y tráfico |
| **Total** | **~US$24** | |

Dev suma casi nada: lo caro es el servidor y la red, que ya están.

**Esta cuenta no tiene capa gratis de RDS.** AWS la sacó para las cuentas
creadas después del 15 de julio de 2025 (ahora dan créditos en dólares). El
presupuesto `oasi-monthly` avisa por correo al 80% de US$100.

Cómo ver el gasto real: consola → **Billing and Cost Management** → **Cost
Explorer**, agrupando por servicio. AWS lo publica con un día de atraso.

---

## Cómo destruir todo y empezar de nuevo

El servidor de base de datos tiene **protección de borrado** y política
`RETAIN`: no se va a ir por accidente, ni siquiera con `cdk destroy`.

```bash
cd proyectos-backend/infra

# 1. Lo que se borra sin ceremonia
npx cdk destroy Oasi-Api-dev Oasi-Storage-dev --context env=dev
npx cdk destroy Oasi-Api-prod Oasi-Storage-prod Oasi-Auth-prod --context env=prod

# 2. La base: hay que sacarle la protección primero
aws rds modify-db-instance --db-instance-identifier oasi-shared \
  --no-deletion-protection --apply-immediately
aws rds delete-db-instance --db-instance-identifier oasi-shared \
  --final-db-snapshot-identifier oasi-final-$(date +%Y%m%d)   # deja respaldo
npx cdk destroy Oasi-Database --context env=dev

# 3. La red (tiene que ir después: la base vive adentro)
npx cdk destroy Oasi-Network --context env=dev
```

Ojo con estos detalles, que muerden:

- **Un RDS apagado no se puede borrar.** Si está `stopped`, prendelo primero
  (`aws rds start-db-instance`) y recién ahí borralo.
- **Los secretos no se borran de inmediato**: quedan 30 días "programados para
  borrar" y su nombre sigue reservado, así que un stack nuevo con el mismo
  nombre falla. Para liberarlos ya:
  ```bash
  aws secretsmanager delete-secret --secret-id oasi/db/dev --force-delete-without-recovery
  ```
- **`Oasi-Auth-dev` tiene usuarios reales.** Borrarlo borra las cuentas y hay
  que volver a invitar a todo el mundo.
- `Oasi-Account` y el presupuesto se borran aparte, y solo si vas a abandonar
  la cuenta:
  ```bash
  aws cloudformation update-termination-protection \
    --stack-name Oasi-Account --no-enable-termination-protection
  npx cdk destroy Oasi-Account
  ```
