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
- `db/schema.sql` — schema completo: tablas, triggers de auditoría, vistas
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
- `infra/` — stacks de CDK para desplegar todo (ver "Deploy" abajo)

🚧 Pendiente:
- Desplegar el `OasiStack` (RDS + Lambda + API Gateway + S3) en la cuenta
  real — hoy solo está desplegado `Oasi-Auth-dev` (Cognito, gratis). Ver
  `infra/COGNITO_SETUP.md` y `DEPLOYMENT.md`.
- Generar un build real de `dist-lambda/` (`npm run build:lambda`) antes de
  ese deploy — el que hay en el repo hoy es un placeholder de una prueba de
  `cdk synth`, no un bundle real.
- Amplify Hosting para el frontend.
- No hay tests automatizados.
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
| Base de datos | PostgreSQL (RDS t3.micro en prod, local para desarrollo) |
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
    schema.sql              schema completo de Postgres (tablas + vistas)
    migrations/               cambios incrementales sobre una BD ya sembrada (idempotentes)
    seed.py                  carga el Excel origen -> Postgres
  infra/                    CDK: AuthStack (Cognito, gratis) + OasiStack (VPC/RDS/Lambda/API GW/S3)
  data/                     (no versionado) acá va el Excel origen, ver abajo
  .venv/                    (no versionado) entorno virtual Python para seed.py
```

**Por qué `models/` y no un ORM:** las instrucciones del proyecto piden SQL
crudo parametrizado, no un ORM — pero eso no significa que el SQL tenga que
vivir mezclado con el parseo del request adentro de cada archivo de `routes/`.
`models/` es esa separación: cada función recibe lo que necesita (un
`WhereBuilder` ya armado por la ruta con el scope del usuario, un `pool` o
`client` de Postgres, algún parámetro) y devuelve filas — no conoce Express,
no arma respuestas HTTP, no decide códigos de estado. Las rutas quedan
livianas: piden el request, chequean permiso, llaman al modelo, responden.

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

### 5. Aplicar el schema

Base nueva, desde cero (deja los catálogos ya cargados):

```bash
psql -h 127.0.0.1 -U postgres -d oasi_dev -f db/schema.sql
```

Base que **ya tenía datos** cargados con el modelo anterior (región, sector,
etapa y estado como texto): hay que correr la migración que los pasa a
catálogos con id.

```bash
psql -h 127.0.0.1 -U postgres -d oasi_dev -f db/migrations/002_catalogos.sql
```

Es idempotente (se puede correr dos veces), va toda en una transacción, y si
encuentra un valor de texto que no calza con el catálogo **falla a propósito**
nombrándolo, en vez de dejarlo en NULL sin avisar.

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
| `npm run build` | Compila TypeScript a `dist/` (`tsc`) |
| `npm start` | Corre el build compilado (`node dist/handler.js`) — para probar sin Lambda |
| `npm run build:lambda` | Compila + empaqueta `dist-lambda/` con `node_modules` de producción, listo para subir a Lambda |
| `npm run migrate` | Aplica las migraciones de `db/migrations/` contra la BD apuntada en `.env` |
| `npm run infra:diff` | `cd infra && cdk diff` — qué cambiaría un deploy sin aplicarlo |
| `npm run infra:deploy` | `cd infra && cdk deploy` |

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

### Catálogos (vocabulario controlado, con datos semilla en `schema.sql`)

Todo lo que es una lista cerrada es una tabla con id, no texto libre. Van con
los datos incluidos en `db/schema.sql` y con **id explícito y estable**, así
`region_id = 3` significa lo mismo en tu base local, en dev y en producción.
No dependen del Excel: se cargan junto con el schema.

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
| `v_permisos_comite` | Igual que `v_permisos` pero calculado a la fecha del comité (`c.fecha`), no de hoy — reconstruye la tabla exacta presentada en cada sesión |
| `v_resumen_comite` | Una fila por sesión: permisos en agenda, resueltos, promedio de días |
| `v_resumen_organismo` | Por organismo: pendientes, +6 meses, promedio de días, inversión bloqueada |
| `v_usuarios` | Usuario con su alcance resuelto a nombres (empresa / organismo / región) |
| `v_historial` | Historial de cambios con nombre de usuario legible (join con `usuarios`) |
| `v_solicitudes_cambio` | Solicitudes con nombre de la entidad, de quien la pidió, y las columnas de alcance que usa la cola de aprobaciones |

### Dónde ver qué columnas tiene cada entidad

Cada archivo de `src/models/` arranca con la lista completa de columnas de su
entidad, en dos interfaces: las de la tabla base y las que **agrega la vista**
encima (catálogos resueltos y valores derivados), con el comentario de cada
campo cuando el dato tiene alguna trampa. Están verificadas contra la base, no
escritas de memoria. Es el lugar para mirar antes de agregar un endpoint.

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

Infra como código en `infra/` (CDK, TypeScript), dos stacks separados para
poder probar el login sin pagar el resto:

- **`Oasi-Auth-dev`** (`infra/lib/auth-stack.ts`) — solo Cognito: User Pool +
  5 grupos + app client. Gratis (Cognito es gratis hasta 50.000 usuarios
  activos/mes). Guía completa: `infra/COGNITO_SETUP.md`.
- **`Oasi-<stage>`** (`infra/lib/oasi-stack.ts`) — todo lo demás: VPC (1 NAT
  gateway, no uno por AZ, para no duplicar el costo), RDS Postgres t3.micro,
  Lambda (con `dist-lambda/` como código), API Gateway, bucket S3 de
  adjuntos. Recibe el `userPool`/`userPoolClient` del stack anterior.

Dos carpetas de build distintas, no confundir:

- `dist/` — salida plana de `tsc` (`npm run build`), la usa `npm start` y el
  desarrollo local.
- `dist-lambda/` — lo que sube a Lambda: `dist/` **más** los `node_modules`
  de producción empaquetados juntos en una sola carpeta. Lo genera
  `npm run build:lambda` (`scripts/build-lambda.sh`). Hay que regenerarlo
  antes de cada deploy real del `OasiStack`.

Pasos generales (detalle completo en `DEPLOYMENT.md`):

1. `cd infra && npx cdk deploy Oasi-Auth-dev -c stage=dev` — despliega Cognito.
2. Crear el primer admin a mano (única vez que hace falta AWS CLI, ver
   `infra/COGNITO_SETUP.md`) — desde ahí, el resto de los usuarios se crea
   desde **Administración → Usuarios** en la propia app.
3. `npm run build:lambda` en `proyectos-backend/`.
4. `cd infra && npx cdk deploy Oasi-dev -c stage=dev` — despliega RDS, Lambda,
   API Gateway y S3 (este paso sí genera costo, principalmente el NAT
   gateway, ~US$32/mes).
5. Aplicar `db/schema.sql` contra la RDS recién creada.
6. Configurar el frontend (Amplify Hosting) con la URL de la API y los
   valores de Cognito.

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
