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
- `db/schema.sql` — schema completo: tablas, triggers de auditoría, 6 vistas
- `db/seed.py` — carga el Excel origen a Postgres, probado con datos reales
  (317 proyectos, 1.552 permisos, 12 ministerios, 19 organismos)
- Todas las rutas de la API (ver "Endpoints" abajo)
- `src/middleware/scope.ts` — filtro por empresa/organismo según rol, aplicado
  en el backend en cada consulta
- `src/services/historial.ts` — diff campo a campo en cada UPDATE, dentro de
  la misma transacción
- `src/routes/adjuntos.ts` — URLs prefirmadas de S3 para subir/descargar

🚧 Pendiente:
- **Cognito.** `src/middleware/auth.ts` ya tiene la verificación contra el
  JWKS escrita, pero hoy el server corre con `AUTH_MODE=dev`, que arma un
  usuario falso a partir de headers `x-dev-*` (así el frontend puede tener un
  selector de rol para probar cada vista). **En producción tiene que ir
  `AUTH_MODE=cognito`.**
- **S3.** Las rutas de adjuntos funcionan pero necesitan `S3_BUCKET_ADJUNTOS`
  y `AWS_REGION` configurados; sin eso responden 503 con un mensaje claro.
- CRUD de usuarios (depende de que exista el User Pool).

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
  handler.ts              entry point Lambda (envuelve src/app.ts con serverless-http)
  src/
    app.ts                app de Express: middlewares globales + monta las rutas
    app.local.ts           levanta app.ts con app.listen() para desarrollo local
    db/
      client.ts            pool de conexiones pg, lee credenciales de .env
    middleware/
      auth.ts              verifica JWT contra JWKS de Cognito (o usuario falso en AUTH_MODE=dev)
      scope.ts              inyecta el filtro por rol + WhereBuilder para queries parametrizadas
    routes/
      dashboard.ts          KPIs y datos de los gráficos
      proyectos.ts          lista, detalle, alta, permisos del proyecto
      permisos.ts           lista, detalle, edición, historial, exportación CSV
      comites.ts             sesiones y tabla por comité
      organismos.ts          resumen por organismo
      adjuntos.ts             URLs prefirmadas de S3
      catalogos.ts            listas para dropdowns
    services/
      historial.ts           diff campo a campo + escritura en `historial`
    shared/
      types.ts               tipos compartidos con el frontend (ver nota abajo)
  db/
    schema.sql              schema completo de Postgres (tablas + vistas)
    seed.py                  carga el Excel origen -> Postgres
  data/                     (no versionado) acá va el Excel origen, ver abajo
  .venv/                    (no versionado) entorno virtual Python para seed.py
```

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

```bash
psql -h 127.0.0.1 -U postgres -d oasi_dev -f db/schema.sql
```

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
| `npm start` | Corre el build compilado (`node dist/handler.js`) — para probar el bundle de Lambda |

---

## Endpoints

Todas las rutas (salvo `/health`) requieren autenticación y aplican el filtro
de `scope.ts` según el rol. Las URLs usan el **id numérico**, no el del Excel.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Chequeo de que el server está vivo |
| GET | `/me` | Usuario actual (rol y scope) |
| GET | `/dashboard` | KPIs, pendientes por organismo, evolución por comité, semáforo, 10 permisos más antiguos |
| GET | `/catalogos` | Listas para los dropdowns: organismos, ministerios, empresas, regiones, sectores, etapas |
| GET | `/permisos` | Lista paginada. Filtros: `organismo_id`, `ministerio_id`, `empresa_id`, `proyecto_id`, `estado`, `tramo` (`menos_3`/`entre_3_6`/`mas_6`), `region`, `sector`, `critico`, `habilitante`, `fecha_ingreso_desde/hasta`, `id_excel`, `q`. Orden: `sortBy`, `sortDir`. Paginación: `page`, `pageSize` |
| GET | `/permisos/export` | Los mismos filtros, devuelve CSV (se abre en Excel) |
| GET | `/permisos/:id` | Detalle |
| GET | `/permisos/:id/historial` | Historial de cambios con nombre de usuario |
| PATCH | `/permisos/:id` | Edita y escribe el diff en `historial`, en una transacción |
| GET | `/proyectos` | Lista paginada. Filtros: `empresa_id`, `sector`, `region`, `etapa`, `con_permisos_6meses`, `sin_pendientes`, `id_excel`, `q` |
| GET | `/proyectos/:id` | Detalle |
| GET | `/proyectos/:id/permisos` | Permisos de ese proyecto |
| POST | `/proyectos` | Crear (queda con `id_excel = NULL`) |
| POST | `/proyectos/:id/permisos` | Agregar un permiso al proyecto |
| GET | `/comites` | Lista de sesiones con su resumen |
| GET | `/comites/:numero` | Tabla del comité, calculada **a la fecha de esa sesión** |
| GET | `/organismos` | Resumen por organismo |
| GET | `/adjuntos/permiso/:id` | Adjuntos con URL de descarga prefirmada |
| POST | `/adjuntos/permiso/:id/url-subida` | URL prefirmada para subir a S3 |
| POST | `/adjuntos/permiso/:id` | Registra el archivo ya subido |
| DELETE | `/adjuntos/:id` | Borra el registro y el objeto en S3 |

### Reglas de acceso

- Si un usuario `empresa` pide un permiso o proyecto que no es suyo, la
  respuesta es **404**, no 403: no se revela que el recurso existe.
- `organismo_lector` es de solo lectura y solo ve los permisos de su organismo.
- Los proyectos y permisos creados por una `empresa` quedan en
  `estado_validacion = 'en_revision'`.

---

## Base de datos

### Regla de IDs

Toda tabla usa `id BIGSERIAL PRIMARY KEY`. El identificador del Excel vive en
una columna aparte, `id_excel` (ej. `'P183'`, `'PM1377'`), que es solo
informativo — nunca se usa como foreign key. Los proyectos/permisos creados
desde la app tienen `id_excel = NULL`.

### Tablas

`ministerios`, `organismos`, `empresas`, `proyectos`, `permisos`, `comites`,
`permisos_comite` (relación N:N — un permiso se revisa en varias sesiones de
comité), `usuarios`, `historial`, `adjuntos`.

### Vistas (todo valor calculado vive acá, nunca en una columna)

| Vista | Qué entrega |
|---|---|
| `v_permisos` | Permiso + proyecto + organismo, con `dias_tramitacion`, `menos_3_meses`, `entre_3_y_6_meses`, `supera_6_meses`, `semaforo`, calculados contra `CURRENT_DATE` |
| `v_proyectos` | Proyecto + `total_permisos`, `permisos_pendientes`, `permisos_6meses`, `criticos_pendientes`, `sin_pendientes` |
| `v_permisos_comite` | Igual que `v_permisos` pero calculado a la fecha del comité (`c.fecha`), no de hoy — reconstruye la tabla exacta presentada en cada sesión |
| `v_resumen_comite` | Una fila por sesión: permisos en agenda, resueltos, promedio de días |
| `v_resumen_organismo` | Por organismo: pendientes, +6 meses, promedio de días, inversión bloqueada |
| `v_historial` | Historial de cambios con nombre de usuario legible (join con `usuarios`) |

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

Pensado para AWS Lambda + API Gateway:

- `handler.ts` es el entry point (envuelve `src/app.ts` con `serverless-http`)
- `npm run build` genera `dist/handler.js`, que es lo que se sube a Lambda
- La RDS de producción se configura vía las variables `DB_*` en el entorno de
  Lambda (no en un `.env` commiteado)
- CORS debe restringirse al dominio de Amplify en producción (hoy `cors()`
  está abierto para desarrollo)

---

## Convenciones de código

- TypeScript estricto
- Queries siempre parametrizadas (`$1`, `$2`, ...), nunca concatenación de strings
- Toda mutación que toque más de una tabla va en transacción (`BEGIN`/`COMMIT`)
- Fechas: `DATE` en la BD, ISO `YYYY-MM-DD` en la API, `DD-MM-YYYY` solo en el
  render del frontend
- El `sub` y los grupos de Cognito salen de `req.user`, poblado por
  `middleware/auth.ts`
