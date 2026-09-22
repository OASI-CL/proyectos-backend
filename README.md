# proyectos-backend

Backend de OASI: seguimiento de permisos sectoriales de proyectos de inversión (Gobierno
de Chile). Reemplaza un Excel de 32 hojas. API REST en Express, pensada para correr como
Lambda detrás de API Gateway, con PostgreSQL (RDS) como base de datos.

El contexto completo del proyecto (reglas de negocio, roles, páginas del frontend, etc.)
está en `claude_instructions.md`, en la raíz de `oasi/` (un nivel arriba de este repo).

> Repo hermano: [`proyectos-frontend`](https://github.com/OASI-CL/proyectos-frontend)
> (React + Vite, consume esta API).

---

## Estado actual

✅ Hecho:
- `src/db/schema/` — **el modelo de datos**: un archivo por tabla, con sus
  columnas, claves foráneas e índices. Las migraciones y los tipos de
  TypeScript se generan desde ahí
- `db/seed.py` — carga el Excel origen a Postgres, probado con datos reales
  (317 proyectos, 1.552 permisos, 12 ministerios, 19 organismos)
- Todas las rutas de la API (ver "Endpoints" abajo)
- `src/models/` — todo el SQL de la app, separado de las rutas (ver
  "Estructura de carpetas")
- `src/middleware/scope.ts` — filtro por empresa/organismo/región según rol,
  aplicado en el backend en cada consulta (`WhereBuilder`)
- Los 5 roles (`admin`, `oasi`, `organismo`, `empresa`, `region`) y el flujo
  de solicitudes de cambio (`src/services/approvals.ts`,
  `src/routes/approvals.ts`) — ver "Reglas de acceso" abajo
- `src/routes/adjuntos.ts` — URLs prefirmadas de S3 para subir/descargar
- Login real con Cognito (`src/middleware/auth.ts`, `AUTH_MODE=cognito`) y
  alta/edición/baja de usuarios desde la propia app
  (`src/services/cognitoUsers.ts`, `src/routes/usuarios.ts`) — no hace falta
  la consola de AWS salvo para crear el primer admin
- `infra/` — infraestructura en CDK, con la configuración de los dos ambientes
  en un solo archivo (`infra/config.ts`). Ver "Deploy" abajo y
  [`infra/README.md`](infra/README.md)
- CI/CD por rama: `develop` → dev, `main` → prod (con aprobación manual)

- **dev desplegado y funcionando** en AWS, con los datos cargados. La API de
  dev es `https://39dg0v2j8j.execute-api.us-east-1.amazonaws.com/dev`

🚧 Pendiente:
- Crear prod: pasa con el primer merge a `main` (su base ya existe, vacía).
- Conectar las dos apps de Amplify (se hace por consola, una vez).
- Crear los Environments `dev` y `prod` en GitHub con su secreto, para que el
  CI pueda desplegar.
- No hay tests automatizados de lógica de negocio: el CI verifica typecheck,
  que el paquete de la Lambda funcione y que la API desplegada llegue a su
  base de datos.
- `src/routes/catalogos.ts` (español) y `src/routes/catalog.ts` (inglés)
  siguen coexistiendo — comparten el SQL vía `src/models/catalog.ts`, pero el
  primero solo se saca cuando el frontend termine de migrar a `/catalog`.

---

## Stack

| Parte | Tecnología |
|---|---|
| Runtime | Node.js 24 (LTS) + TypeScript |
| Framework HTTP | Express 5 |
| Deploy | AWS Lambda + API Gateway, vía `serverless-http` |
| Base de datos | PostgreSQL (RDS `db.t4g.micro` en AWS, local para desarrollo) |
| Cliente DB | `pg` (pool de conexiones). **No** se usa RDS Data API. |
| Auth | AWS Cognito (JWT verificado con `aws-jwt-verify`) |
| Adjuntos | S3 (`@aws-sdk/client-s3` + presigned URLs) |
| Carga inicial de datos | Python 3 (`db/seed.py`), venv propio |

---

## Estructura de carpetas

```
proyectos-backend/
  handler.ts               entry point Lambda (envuelve src/app.ts con serverless-http)
  src/
    app.ts                 app de Express: middlewares globales + monta las rutas
    app.local.ts           levanta app.ts con app.listen() para desarrollo local
    db/
      client.ts            pool de conexiones pg, lee credenciales de .env o Secrets Manager
      sql.ts                fragmentos SQL compartidos (estado de tramitación, días de atraso)
    middleware/
      auth.ts              verifica JWT contra JWKS de Cognito (o usuario falso en AUTH_MODE=dev)
      scope.ts             WhereBuilder + filtro por rol (empresa/organismo/región) para queries parametrizadas
      schema/               EL MODELO DE DATOS: un archivo por tabla, con columnas,
                            claves foráneas e índices. Fuente de verdad de todo
    models/                 todo el SQL de la app — nada de SQL vive en routes/
      proyectos.ts          queries de proyectos (lista, detalle, alta, permisos del proyecto)
      permisos.ts            queries de permisos (lista, detalle, edición, historial)
      comites.ts              sesiones y tabla por comité
      organismos.ts           resumen por organismo
      catalog.ts               listas para dropdowns (usado por /catalog y /catalogos)
      adjuntos.ts               adjuntos (metadata en Postgres; el archivo en sí vive en S3)
      usuarios.ts                alta/edición/baja de filas en la tabla `usuarios`
      approvals.ts                 lectura de `solicitudes_cambio` (el alta/aprobación compleja vive en services/)
      dashboard.ts                 todas las queries de agregación de los gráficos del dashboard
    routes/                 capa HTTP: parsea el request, chequea permisos, llama a models/, arma la respuesta
      dashboard.ts, proyectos.ts, permisos.ts, comites.ts, organismos.ts,
      catalog.ts, catalogos.ts, adjuntos.ts, approvals.ts, usuarios.ts
    services/                lógica de negocio que no es una simple query (transacciones multi-tabla, AWS SDK)
      historial.ts           diff campo a campo + escritura en `historial`
      approvals.ts            crea/aprueba/rechaza solicitudes de cambio (transaccional)
      cognitoUsers.ts          alta/edición/baja de cuentas en el User Pool de Cognito
    shared/
      types.ts               tipos compartidos con el frontend (ver nota abajo)
  db/
    migrations/             generadas desde src/db/schema/, más las escritas a
                            mano para lo que un modelo no expresa (vistas,
                            triggers, datos de catálogos)
    seed.py                  carga el Excel origen -> Postgres
  infra/                    infraestructura en CDK (ver infra/README.md)
    config.ts                 TODA la configuración de los ambientes, en un archivo
    bin/app.ts                qué stacks existen
    lib/                      network / database / auth / storage / api
  scripts/
    db.ts                     todos los comandos de base de datos (npm run db:*)
    load-data.sh              carga inicial de datos históricos
    create-admin.sh           primer admin de un ambiente
    amplify-env.sh            apunta una rama de Amplify a su ambiente
    build-lambda.sh           arma dist-lambda/
    smoke-lambda.cjs          prueba dist-lambda/ antes de desplegarlo
  data/                     (no versionado) acá va el Excel origen, ver abajo
  .venv/                    (no versionado) entorno virtual Python para seed.py
```

### Dónde vive qué: `schema/` vs `models/`

Son dos cosas distintas y conviene no confundirlas:

| | `src/db/schema/` | `src/models/` |
|---|---|---|
| Qué es | **la estructura**: qué tablas hay, qué columnas, qué claves foráneas | **las consultas**: cómo se leen y escriben esos datos |
| Quién lo usa | drizzle-kit, para generar las migraciones y los tipos | las rutas de la API |
| Si lo cambiás | hay que generar una migración (`npm run db:generate`) | no toca la base |

Los tipos de TypeScript de cada tabla **salen del modelo**
(`typeof proyectos.$inferSelect`), no se escriben a mano en `models/`: así no
pueden quedar desincronizados con la base.

**Por qué las consultas siguen siendo SQL y no el ORM:** Drizzle se usa para
el modelo y las migraciones. Las consultas siguen en SQL parametrizado porque
las 8 vistas y las agregaciones del dashboard se expresan mucho mejor en SQL
que en cualquier ORM. Pasarlas a la API de Drizzle es opcional y se puede
hacer de a poco, entidad por entidad.

Lo que sí se respeta siempre: **el SQL no vive mezclado con el parseo del
request**. Cada función de `models/` recibe lo que necesita (un
`WhereBuilder` ya armado por la ruta con el alcance del usuario, un `pool` o
`client`, algún parámetro) y devuelve filas — no conoce Express, no arma
respuestas HTTP, no decide códigos de estado. Las rutas quedan livianas:
parsean el request, chequean permiso, llaman al modelo, responden.

**Sobre `src/shared/types.ts`:** este backend y el frontend son dos repos
separados, así que no hay una carpeta compartida real entre ambos. Este
archivo es una copia manual de los tipos TypeScript del dominio (`Proyecto`,
`Permiso`, etc.). Si cambian los tipos, hay que actualizar la copia en los dos
repos a mano.

---

## Cómo correr en local

### 1. Requisitos

- Node.js 24+ y npm (instalados vía [nvm](https://github.com/nvm-sh/nvm))
- Python 3.10+ (solo para `db/seed.py`)
- PostgreSQL 14+ corriendo en algún lado (local o accesible por red)

### 2. Instalar dependencias

```bash
npm install
```

### 3. Base de datos local (para desarrollo, sin tocar la RDS real)

Si no tenés Postgres instalado en tu WSL/máquina:

```bash
sudo apt install postgresql postgresql-contrib
sudo service postgresql start          # hay que correrlo de nuevo cada vez que reiniciás WSL
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'oasi_dev_local';"
sudo -u postgres psql -c "CREATE DATABASE oasi_dev OWNER postgres;"
```

### 4. Variables de entorno

```bash
cp .env.example .env
```

Para desarrollo local con la base de arriba, `.env` queda así:

```
DB_HOST=127.0.0.1
DB_PORT=5432
DB_NAME=oasi_dev
DB_USER=postgres
DB_PASSWORD=oasi_dev_local
AUTH_MODE=dev
```

`AUTH_MODE=dev` hace que el server no valide JWT y arme un usuario falso a
partir de los headers `x-dev-rol`, `x-dev-empresa-id` y `x-dev-organismo-id`
(el frontend los manda desde su selector de rol). **En producción va
`AUTH_MODE=cognito`** y ahí sí hacen falta `COGNITO_USER_POOL_ID` y
`COGNITO_CLIENT_ID`.

`S3_BUCKET_ADJUNTOS` y `AWS_REGION` solo se necesitan para los adjuntos; sin
ellos esas rutas responden 503 y el resto de la API funciona igual.

### 5. Crear las tablas

```bash
npm run db:migrate -- --env=local
```

Sobre la base del `.env`:

- **vacía** → corre todas las migraciones en orden y queda lista, con los
  catálogos cargados
- **con historial** → aplica solo las que faltan, cada una en su propia
  transacción
- **con tablas pero sin historial** → se detiene y te pide declarar hasta
  dónde está al día con `npm run db:baseline`. No adivina: marcar como
  aplicada una migración que en realidad no corrió deja la base vieja en
  silencio

Lo aplicado queda en la tabla `_migrations`. Es el mismo código que corre en
AWS después de cada deploy (`src/db/migrate.ts`).

**Para cambiar el modelo de datos:** se edita el archivo de la tabla en
`src/db/schema/`, se corre `npm run db:generate` (escribe la migración sola) y
después `npm run db:migrate -- --env=local`. Detalle en
[`infra/README.md`](infra/README.md) → "Migraciones de base de datos".

### 6. Cargar los datos del Excel (opcional, para tener datos reales)

El Excel origen **no está en el repo** (es información privada, está en
`.gitignore`). Hay que dejarlo en `data/`:

```
proyectos-backend/data/20260904 Levantamiento de Permisos.xlsx
```

Crear el venv de Python (una sola vez):

```bash
python3 -m venv .venv
.venv/bin/pip install pandas openpyxl psycopg2-binary
```

Correr el seed:

```bash
.venv/bin/python db/seed.py --dry-run   # valida el parseo sin escribir nada
.venv/bin/python db/seed.py             # carga de verdad
```

Con el Excel del 2026-09-04 esto carga 317 proyectos, 1.552 permisos, 12
ministerios, 19 organismos y ~854 vínculos permiso↔comité. El script imprime
advertencias si encuentra filas con datos faltantes.

### 7. Levantar el server

```bash
npm run dev
```

Escucha en `http://localhost:3001`. Probar con:

```bash
curl http://localhost:3001/health
# {"status":"ok"}
```

---

## Scripts de npm

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta `src/app.local.ts` con `tsx watch` (recarga en caliente) |
| `npm run check` | **Antes de subir.** Lo mismo que corre el CI: typecheck de API e infra, build del paquete de Lambda y smoke test de ese paquete |
| `npm run db:migrate -- --env=local` | Aplica las migraciones pendientes a la BD del `.env` |
| `npm run db:migrate -- --env=dev` | Idem contra la base de dev en AWS (vía la Lambda `db-ops`) |
| `npm run db:bootstrap` | Crea las bases y los usuarios de cada ambiente en el servidor RDS (una vez) |
| `npm run db:generate` | **Después de editar un modelo:** escribe sola la migración con el cambio |
| `npm run db:generate:custom` | Crea una migración vacía para SQL a mano (vistas, triggers, catálogos) |
| `npm run db:baseline -- --env=... --hasta=...` | Declara que una base ya está al día hasta cierta migración (sin ejecutarla) |
| `npm run build` | Revisa los tipos, sin generar archivos (`tsc --noEmit`) |
| `npm start` | Corre el build compilado localmente (`dist-lambda/src/app.local.js`) |
| `npm run build:lambda` | Compila + empaqueta `dist-lambda/` con `node_modules` de producción |
| `npm run test:lambda` | Prueba ese paquete desde una copia fuera del repo (detecta dependencias faltantes, rutas rotas, CORS abierto) |
| `npm run infra:diff` | `cd infra && cdk diff` — qué cambiaría un deploy sin aplicarlo |

Scripts para operar un ambiente desplegado (usan tu `AWS_PROFILE`):

| Comando | Qué hace |
|---|---|
| `npm run db:status -- --env=dev` | Migraciones aplicadas y cantidad de filas |
| `npm run db:check -- --env=dev` | Comprueba que las credenciales de un ambiente no abran la base del otro |
| `scripts/load-data.sh dev` | Carga única de los datos desde tu base local; se niega si ya hay proyectos |
| `scripts/create-admin.sh dev <email> "<nombre>"` | Primer admin de un ambiente (cuenta en Cognito + fila en `usuarios`) |
| `scripts/amplify-env.sh <app-id> develop dev` | Apunta una rama de Amplify a su ambiente |

---

## Endpoints

Todas las rutas (salvo `/health`) requieren autenticación y aplican el filtro
de `scope.ts` según el rol. Las URLs usan el **id numérico**, no el del Excel.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Chequeo de que el server está vivo |
| GET | `/me` | Usuario actual (rol y scope) |
| GET | `/dashboard` | Todo lo que arma el dashboard: KPIs, distribución por estado RCA, línea de tiempo, permisos por región/organismo, treemap por sector. Filtros compartidos (mismo `buildScope` para permisos y proyectos): `region`, `sector`, `etapa`, `organismo_id`, `empresa_id`, `fecha_inicio_desde/hasta` |
| GET | `/catalogos` | Listas para los dropdowns, en español (versión anterior, algunas páginas del frontend todavía la usan) |
| GET | `/catalog` | Lo mismo que `/catalogos` pero en inglés — usado por el dashboard nuevo. Ambas comparten el SQL en `src/models/catalog.ts` |
| GET | `/permisos` | Lista paginada. Filtros: `organismo_id`, `ministerio_id`, `empresa_id`, `proyecto_id`, `estado`, `tramo` (`menos_3`/`entre_3_6`/`mas_6`), `region`, `sector`, `critico`, `habilitante`, `fecha_ingreso_desde/hasta`, `id_excel`, `q`. Orden: `sortBy`, `sortDir`. Paginación: `page`, `pageSize` |
| GET | `/permisos/export` | Los mismos filtros, devuelve CSV (se abre en Excel) |
| GET | `/permisos/:id` | Detalle |
| GET | `/permisos/:id/historial` | Historial de cambios con nombre de usuario |
| PATCH | `/permisos/:id` | Edita. Si el rol no escribe directo, queda en `solicitudes_cambio` pendiente de aprobación en vez de aplicarse |
| GET | `/proyectos` | Lista paginada. Filtros: `empresa_id`, `sector`, `region`, `etapa`, `con_permisos_6meses`, `sin_pendientes`, `id_excel`, `q` |
| GET | `/proyectos/:id` | Detalle |
| GET | `/proyectos/:id/permisos` | Permisos de ese proyecto |
| POST | `/proyectos` | Crear (queda con `id_excel = NULL`). Si lo crea una `empresa`, en `estado_validacion = 'en_revision'` y genera una solicitud de aprobación |
| POST | `/proyectos/:id/permisos` | Agregar un permiso al proyecto (misma lógica de aprobación) |
| GET | `/comites` | Lista de sesiones con su resumen |
| GET | `/comites/:numero` | Tabla del comité, calculada **a la fecha de esa sesión** |
| GET | `/organismos` | Resumen por organismo, respetando el scope del usuario |
| GET | `/adjuntos/permiso/:id` | Adjuntos con URL de descarga prefirmada |
| POST | `/adjuntos/permiso/:id/url-subida` | URL prefirmada para subir a S3 |
| POST | `/adjuntos/permiso/:id` | Registra el archivo ya subido |
| DELETE | `/adjuntos/:id` | Borra el registro y el objeto en S3 |
| GET | `/approvals` | Cola de solicitudes de cambio pendientes (`?estado=pendiente/aprobada/rechazada`), filtrada por scope |
| GET | `/approvals/count` | Cantidad pendiente, para el badge del menú |
| POST | `/approvals/:id/approve` | OASI/admin aprueba: aplica el cambio + escribe `historial`, en una transacción |
| POST | `/approvals/:id/reject` | OASI/admin rechaza (una creación rechazada vuelve a `borrador`, no se borra) |
| GET | `/usuarios` | Lista de usuarios — solo `admin` |
| POST | `/usuarios` | Crea la cuenta en Cognito (le manda el mail con contraseña temporal) y la fila en `usuarios`, atómico — solo `admin` |
| PATCH | `/usuarios/:id` | Edita rol/alcance; si cambia el rol, sincroniza el grupo en Cognito — solo `admin` |
| DELETE | `/usuarios/:id` | Borra la cuenta en Cognito y la fila — solo `admin` |

### Reglas de acceso

Cinco roles: `admin`, `oasi`, `organismo`, `empresa`, `region`. El filtro por
rol se aplica **en el backend**, en cada query (`middleware/scope.ts`) — lo
que hace el frontend es solo conveniencia, nunca la única barrera.

- **admin**: administra usuarios y permisos; ve todo.
- **oasi**: ve todo, aprueba/rechaza las solicitudes de cambio de `organismo`
  y `empresa`.
- **organismo**: solo ve/edita los permisos de su propio organismo (y los
  proyectos asociados). Sus ediciones quedan pendientes de aprobación de OASI.
- **empresa**: solo ve sus propios proyectos y permisos. Puede crear
  proyectos y agregar permisos, también pendientes de aprobación de OASI.
- **region**: solo lectura, ve todos los proyectos/permisos (de cualquier
  organismo) que caen en su región.
- Si un usuario pide un permiso o proyecto fuera de su scope, la respuesta es
  **404**, no 403: no se revela que el recurso existe.
- `empresa`, `organismo` y `region` necesitan su columna de alcance
  (`empresa_id`/`organismo_id`/`region`) seteada en `usuarios` — si falta, el
  login se rechaza (falla cerrado, no muestra todo por accidente).

---

## Base de datos

### Regla de IDs

Toda tabla usa `id BIGSERIAL PRIMARY KEY`. El identificador del Excel vive en
una columna aparte, `id_excel` (ej. `'P183'`, `'PM1377'`), que es solo
informativo — nunca se usa como foreign key. Los proyectos/permisos creados
desde la app tienen `id_excel = NULL`.

### Catálogos (vocabulario controlado, cargados por las migraciones)

Todo lo que es una lista cerrada es una tabla con id, no texto libre. Sus
datos van en una migración, con **id explícito y estable**, así `region_id = 3`
significa lo mismo en tu base local, en dev y en producción. No dependen del
Excel: se cargan al crear la base.

| Tabla | Contenido |
|---|---|
| `regiones` | Las 16 regiones de Chile: `id` (orden norte→sur), `numero` (número oficial), `codigo` (numeral romano), `nombre`, `nombre_oficial`. Más `Interregional` (90) y `Nivel Central` (91), que no son regiones reales pero vienen así en el Excel |
| `sectores` | Sectores productivos, con `orden` de presentación |
| `etapas_proyecto` | `no_iniciado`, `construccion`, `operacion` |
| `estados_permiso` | `Pendiente`, `Resuelto`, `Descartado`. `es_final` marca los que cierran la tramitación, así las vistas no repiten la lista en cada cálculo |
| `ministerios` | Los 12 ministerios, con sigla |
| `organismos` | Los 19 organismos, cada uno con su `ministerio_id` y nombre largo |

### Tablas de datos

`empresas`, `proyectos`, `permisos`, `comites`, `permisos_comite` (relación
N:N — un permiso se revisa en varias sesiones de comité), `usuarios`,
`solicitudes_cambio`, `historial`, `adjuntos`.

### Vistas (todo valor calculado vive acá, nunca en una columna)

Las vistas además **resuelven los catálogos**: exponen el nombre legible con
el mismo nombre de columna de siempre (`region`, `sector`, `etapa`, `estado`)
y también el `_id`. Por eso un filtro por nombre y uno por id funcionan los
dos, y normalizar los catálogos no rompió el frontend.

| Vista | Qué entrega |
|---|---|
| `v_permisos` | Permiso + proyecto + organismo + catálogos resueltos, con `dias_tramitacion`, `menos_3_meses`, `entre_3_y_6_meses`, `supera_6_meses`, `semaforo`, calculados contra `CURRENT_DATE` |
| `v_proyectos` | Proyecto + catálogos + `total_permisos`, `permisos_pendientes`, `permisos_6meses`, `criticos_pendientes`, `sin_pendientes` |
| `v_permisos_comite` | Los permisos de cada sesión de comité, calculados a la fecha de esa sesión. **Acumulativo y estricto**: la tabla del comité N son los permisos que entraron en comités *anteriores* a N |
| `v_resumen_comite` | Una fila por sesión: permisos en agenda, resueltos a esa fecha, promedio de días |
| `v_resumen_organismo` | Por organismo: pendientes, +6 meses, promedio de días, inversión bloqueada |
| `v_usuarios` | Usuario con su alcance resuelto a nombres (empresa / organismo / región) |
| `v_historial` | Historial de cambios con nombre de usuario legible (join con `usuarios`) |
| `v_solicitudes_cambio` | Solicitudes con nombre de la entidad, de quien la pidió, y las columnas de alcance que usa la cola de aprobaciones |

### Dónde ver qué columnas tiene cada entidad

**En `src/db/schema/`**, un archivo por tabla. Ahí está la lista completa de
columnas con su tipo, sus claves foráneas, sus índices y un comentario en cada
campo que tiene alguna trampa. Es lo que la base realmente tiene: no es una
copia que pueda quedar vieja, porque de ahí salen las migraciones.

Las **vistas** agregan columnas encima (catálogos resueltos y valores
calculados). Esas sí están descritas a mano, en el archivo correspondiente de
`src/models/` — son resultados de consulta, no tablas.

Es el lugar para mirar antes de agregar un endpoint.

### Auditoría

`proyectos`, `permisos`, `empresas`, `comites` y `usuarios` tienen
`created_by`, `updated_by`, `created_at`, `updated_at`. `updated_at` lo
actualiza solo el trigger `set_updated_at()` — nunca se setea a mano.

### Decisiones de limpieza de datos tomadas en `seed.py`

El Excel origen tiene bastante suciedad. Documentado en el propio script,
resumen:

- **`critico`**: la columna "Es crítico (Si/No)" viene **100% vacía** en el
  Excel — se cargó todo como `false`. Hay que marcarlos a mano en la app.
- **`habilitante_construccion`**: respuestas muy inconsistentes (`Sí/Si/SI/si`,
  números, textos largos). Todo lo que no es un sí/no claro quedó en `false`.
- **Fechas basura** (`1900-03-29`, `S/I`, vacías) → `NULL`.
- **Sectores duplicados** (`Inmobiliarios`/`Inmobiliario`, `Otros`/`Otro`) se
  unificaron; el resto se dejó tal cual viene del Excel.
- 35 permisos no traían "Nombre Permiso" pero sí "Nombre Permiso Estándar" —
  se usó ese como respaldo en vez de perderlos.
- `permisos_comite` solo trae el comité **actual** por permiso (el Excel no
  guarda el historial completo de en qué sesiones estuvo cada permiso) — eso
  se va a ir completando con el uso real de la app.

---

## Deploy

**Guía completa: [`infra/README.md`](infra/README.md).** Resumen:

### Dos ambientes, uno por rama

| | dev | prod |
|---|---|---|
| Rama (en los dos repos) | `develop` | `main` |
| Qué pasa al hacer push | CI → deploy dev → migraciones → chequeo de salud | CI → **aprobación** → deploy prod → migraciones → chequeo de salud |
| Base de datos | base `oasi_dev` con usuario propio | base `oasi_prod` con usuario propio |
| Usuarios | pool Cognito propio | pool Cognito propio (cuentas separadas) |
| Costo | los dos juntos, ~US$24/mes | |

Dev y prod comparten la red y el **servidor** de base de datos (es lo que hace
que dev salga casi gratis), pero cada uno tiene su propia base, su propio
usuario de Postgres, su propio secreto y su propia Lambda. Las credenciales de
dev no pueden abrir la base de prod.

La configuración de cada ambiente está en **un solo archivo**:
[`infra/config.ts`](infra/config.ts).

### El día a día

1. Cambiás código y probás en local (`npm run dev`, `npm run db:migrate -- --env=local`).
2. **`npm run check`** — corre lo mismo que el CI. Si pasa acá, pasa allá.
3. Push a `develop` → GitHub Actions despliega a dev, aplica migraciones y
   verifica que la API llegue a la base.
4. Probás en el sitio de dev (o con tu frontend local contra dev:
   `npm run dev:aws` en `proyectos-frontend`).
5. Pull request `develop → main`, merge, aprobás el deploy → prod.

### Stacks de CDK (`infra/`)

Compartidos por los dos ambientes:

- **`Oasi-Account`** — una vez por cuenta: permite a GitHub desplegar sin
  guardar claves de AWS (OIDC), un rol por ambiente, y la alerta de presupuesto.
- **`Oasi-Network`** — VPC y la salida a internet (NAT instance, ~US$7/mes,
  en vez del NAT Gateway de ~US$32).
- **`Oasi-Database`** — el servidor Postgres con una base aislada por ambiente.

Por ambiente:

- **`Oasi-Auth-<env>`** — Cognito (dev reusa el pool que ya existía).
- **`Oasi-Storage-<env>`** — bucket de adjuntos.
- **`Oasi-Api-<env>`** — Lambda de la API, HTTP API y Lambda `db-ops`.

La base no tiene ninguna salida a internet. Para migrarla o cargarle datos no
se usan túneles: la Lambda `db-ops` corre adentro de la red y se invoca con
los scripts de `scripts/` o desde el CI.

### `dist-lambda/`: la única carpeta de build

No está en git (la genera `npm run build:lambda` y la prueba
`npm run test:lambda`; en AWS la construye el CI). Es lo que se sube a Lambda,
y tiene tres cosas:

- el código compilado a JavaScript;
- `node_modules` solo con dependencias de producción, porque el código
  compilado sigue haciendo `require('express')`, `require('pg')`...;
- una copia de `db/*.sql`, porque la Lambda que migra la base los lee en
  tiempo de ejecución. Es la única copia y vive dentro del build, no en el
  repo.

`AUTH_MODE` decide cómo se autentica cada request:

- `dev` — usuario falso armado desde headers `x-dev-*` (para desarrollo
  local, el frontend tiene un selector de rol). **Nunca en un entorno
  desplegado** — cualquiera podría elegir su propio rol.
- `cognito` — verifica el JWT contra el JWKS del User Pool
  (`aws-jwt-verify`). Es lo que setea el CDK en el Lambda automáticamente.

---

## Convenciones de código

- TypeScript estricto
- Sin ORM: queries siempre parametrizadas (`$1`, `$2`, ...), nunca
  concatenación de strings
- El SQL vive en `src/models/`, no en `src/routes/`. Una ruta nueva se
  escribe así: parsear el request → armar el scope con `WhereBuilder` →
  llamar a la función de `models/` correspondiente → devolver la respuesta.
  Si una query nueva no encaja en ningún archivo de `models/` existente, es
  señal de que puede ser una entidad nueva, no una excusa para escribirla
  inline en la ruta.
- Lógica que no es "una query" (transacciones multi-tabla, llamadas al SDK de
  AWS) va en `src/services/`, no en `models/` ni en `routes/`
- Toda mutación que toque más de una tabla va en transacción (`BEGIN`/`COMMIT`)
- Fechas: `DATE` en la BD, ISO `YYYY-MM-DD` en la API, `DD-MM-YYYY` solo en el
  render del frontend
- Código nuevo (identificadores, comentarios) en inglés; el schema de la BD y
  los strings de cara al usuario se quedan en español
- El `sub` y los grupos de Cognito salen de `req.user`, poblado por
  `middleware/auth.ts`



