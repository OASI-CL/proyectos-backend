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
- Estructura del proyecto (Express + TypeScript, esqueleto de Lambda handler)
- `db/schema.sql` — schema completo: tablas, triggers de auditoría, vistas
- `db/seed.py` — carga el Excel origen a Postgres, probado con datos reales
  (317 proyectos, 1.552 permisos, 12 ministerios, 19 organismos)
- Conexión a Postgres (`src/db/client.ts`)

🚧 Pendiente (ver "Lo que falta construir" en `claude_instructions.md`):
- `src/middleware/auth.ts` — verificar JWT contra Cognito
- `src/middleware/scope.ts` — filtrar por empresa/organismo según rol
- Rutas CRUD (`src/routes/proyectos.ts`, `permisos.ts`, `comites.ts`, `organismos.ts`, `usuarios.ts`)
- `src/services/historial.ts` — diff automático en cada UPDATE
- Upload a S3 con URL prefirmada (`src/routes/adjuntos.ts`)

Hoy el servidor solo expone `GET /health` para confirmar que todo el toolchain
(Node, TypeScript, Postgres) está andando.

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
      auth.ts              [pendiente] verifica JWT contra JWKS de Cognito
      scope.ts              [pendiente] inyecta el filtro por rol (empresa/organismo)
    routes/
      proyectos.ts          [pendiente]
      permisos.ts           [pendiente]
      comites.ts             [pendiente]
      organismos.ts          [pendiente]
      adjuntos.ts             [pendiente]
      usuarios.ts             [pendiente]
    services/
      historial.ts           [pendiente] diff campo a campo + escritura en `historial`
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
```

(Los valores de `COGNITO_*` y `S3_*` no hacen falta todavía — nada del código
pendiente los usa aún.)

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

Hoy solo existe:

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Chequeo de que el server está vivo. Responde `{"status":"ok"}` |

Los endpoints CRUD reales (`/proyectos`, `/permisos`, `/comites`,
`/organismos`, `/adjuntos`, `/usuarios`) están definidos en
`claude_instructions.md` pero todavía no implementados. Todas las rutas van a
requerir JWT (`Authorization: Bearer <token>`) y van a aplicar el filtro de
`scope.ts` según el rol del usuario (`admin`, `oasi`, `organismo_lector`,
`empresa`).

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
