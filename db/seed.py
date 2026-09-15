"""
OASI - Carga del Excel origen a PostgreSQL.

Lee "20260904 Levantamiento de Permisos.xlsx" (esperado en backend/data/) y
carga: ministerios, organismos, empresas, proyectos, permisos, comites y
permisos_comite. Requiere que db/schema.sql ya se haya aplicado.

Uso:
    cd proyectos-backend
    .venv/bin/python db/seed.py [--file "data/otro_excel.xlsx"] [--dry-run]

Decisiones de limpieza (ver notas en cada función):
  - Fechas basura (año < 2000, 'S/I', '0', vacío) -> NULL
  - Booleanos sucios ('Sí'/'Si'/'SI'/'si' -> true, 'No'/'no'/'NO' -> false,
    cualquier otra cosa (texto largo, número, vacío) -> false, ya que
    critico/habilitante son NOT NULL en el schema (ver shared/types.ts)
  - Sectores: se unifican duplicados obvios ('Inmobiliarios'/'Inmobiliario',
    'Otros'/'Otro'). El resto se deja tal cual viene del Excel.
  - "Es crítico (Si/No)" viene 100% vacío en el Excel origen -> todos los
    permisos quedan con critico=false. Hay que revisarlos a mano en la app
    una vez migrados.
  - organismo -> ministerio: mapa fijo abajo, construido cruzando las hojas
    "Parámetros" y "Listado Organismos >>" del Excel, más 'MTT' que no
    aparece en ninguna de las dos pero sí en los datos de Permisos.
"""

import argparse
import datetime as dt
import os
import sys

import openpyxl
import psycopg2

# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_EXCEL = os.path.join(BACKEND_DIR, "data", "20260904 Levantamiento de Permisos.xlsx")

ORGANISMO_MINISTERIO = {
    "CONAF": "Ministerio de Agricultura",
    "SAG": "Ministerio de Agricultura",
    "BBNN": "Ministerio de Bienes Nacionales",
    "DGAC": "Ministerio de Defensa Nacional",
    "SSFFAA": "Ministerio de Defensa Nacional",
    "SEC": "Ministerio de Energía",
    "CEN": "Ministerio de Energía",
    "CMN": "Ministerio de las Culturas, las Artes y el Patrimonio",
    "MMA": "Ministerio de Medio Ambiente",
    "SEA": "Ministerio de Medio Ambiente",
    "SERNAGEOMIN": "Ministerio de Minería",
    "DGA": "Ministerio de Obras Públicas",
    "VIALIDAD": "Ministerio de Obras Públicas",
    "DOH": "Ministerio de Obras Públicas",
    "DIRECCION GENERAL DE CONCESIONES": "Ministerio de Obras Públicas",
    "SEREMI SALUD": "Ministerio de Salud",
    "MINVU": "Ministerio de Vivienda y Urbanismo",
    "DOM": "Municipalidades",
    "MTT": "Ministerio de Transportes y Telecomunicaciones",
}

SECTOR_ALIAS = {
    "Inmobiliarios": "Inmobiliario",
    "Otros": "Otro",
}

# columnas 1-indexadas, tal como aparecen en la fila 2 (encabezado real) del Excel
PROYECTOS_COLS = {
    "id_excel": 1, "nombre": 2, "titular": 3, "empresa_nombre": 4, "empresa_id_excel": 5,
    "region": 6, "sector": 7, "inversion_mmusd": 8, "empleo_construccion": 9,
    "empleo_operacion": 10, "estado_ambiental": 11, "etapa": 12,
    "fecha_inicio_construccion": 13, "fecha_inicio_operacion": 14,
    "habilitantes_aprobado": 15, "fecha_ingreso": 25, "fecha_ultima_resolucion": 26,
    "observaciones_oasi": 18,
}

PERMISOS_COLS = {
    "organismo": 2, "ministerio": 3, "nombre": 4, "tipo_permiso": 5,
    "nombre_estandar": 6, "n_expediente": 7, "critico": 8, "que_habilita": 9,
    "proyecto_id_excel": 10, "estado": 20, "fecha_ingreso": 21,
    "fecha_resolucion_estimada": 22, "fecha_resolucion": 23, "tipo_resolucion": 24,
    "hito_tramitacion": 25, "n_comite": 32, "habilitante_construccion": 33,
    "incluido_catastro_hacienda": 34, "observaciones": 35, "n_catastro": 37,
}

PROYECTOS_DATA_START_ROW = 3
PERMISOS_DATA_START_ROW = 3
PARAMETROS_COMITE_ROWS = range(8, 18)  # filas 8-17: Sesión (col B) / Fecha (col C)


# ----------------------------------------------------------------------------
# Limpieza
# ----------------------------------------------------------------------------

def clean_text(v):
    if v is None:
        return None
    s = str(v).strip()
    if s == "" or s in ("S/I", "-", "N/A"):
        return None
    return s


def clean_date(v):
    if isinstance(v, dt.datetime):
        d = v.date()
    elif isinstance(v, dt.date):
        d = v
    else:
        return None
    if d.year < 2000:  # fechas basura tipo 1900-03-29
        return None
    return d.isoformat()


def clean_bool(v, default=False):
    if v is None:
        return default
    s = str(v).strip().lower()
    if s in ("sí", "si", "s"):
        return True
    if s in ("no", "n"):
        return False
    return default  # texto largo, número (2), vacío, etc. -> default


def clean_number(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    if s == "" or s in ("S/I", "-"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def clean_sector(v):
    s = clean_text(v)
    if s is None:
        return None
    return SECTOR_ALIAS.get(s, s)


def clean_int(v):
    n = clean_number(v)
    return int(n) if n is not None else None


# ----------------------------------------------------------------------------
# Lectura del Excel
# ----------------------------------------------------------------------------

def find_last_real_row(ws, max_scan=2000, empty_streak_limit=50):
    last = 0
    streak = 0
    for i, row in enumerate(ws.iter_rows(min_row=1, max_row=max_scan, values_only=True), start=1):
        if any(v is not None and str(v).strip() != "" for v in row):
            last = i
            streak = 0
        else:
            streak += 1
            if streak > empty_streak_limit and last > 0:
                break
    return last


def row_get(row, cols, key):
    idx = cols[key]
    return row[idx - 1] if idx - 1 < len(row) else None


def read_comites(wb):
    ws = wb["Parámetros"]
    comites = {}
    for r in PARAMETROS_COMITE_ROWS:
        row = list(ws.iter_rows(min_row=r, max_row=r, values_only=True))[0]
        numero = row[1]  # col B
        fecha = row[2]   # col C
        if numero is not None and isinstance(fecha, (dt.datetime, dt.date)):
            comites[int(numero)] = clean_date(fecha)
    return comites


def read_proyectos(wb):
    ws = wb["Proyectos"]
    last_row = find_last_real_row(ws)
    proyectos = []
    empresas = {}  # id_excel -> nombre (primer nombre visto)
    for row in ws.iter_rows(min_row=PROYECTOS_DATA_START_ROW, max_row=last_row, values_only=True):
        id_excel = clean_text(row_get(row, PROYECTOS_COLS, "id_excel"))
        if id_excel is None:
            continue
        empresa_id_excel = clean_text(row_get(row, PROYECTOS_COLS, "empresa_id_excel")) or "SIN_EMPRESA"
        empresa_nombre = clean_text(row_get(row, PROYECTOS_COLS, "empresa_nombre")) or "Sin empresa asignada"
        empresas.setdefault(empresa_id_excel, empresa_nombre)

        proyectos.append({
            "id_excel": id_excel,
            "nombre": clean_text(row_get(row, PROYECTOS_COLS, "nombre")) or id_excel,
            "titular": clean_text(row_get(row, PROYECTOS_COLS, "titular")),
            "empresa_id_excel": empresa_id_excel,
            "region": clean_text(row_get(row, PROYECTOS_COLS, "region")),
            "sector": clean_sector(row_get(row, PROYECTOS_COLS, "sector")),
            "inversion_mmusd": clean_number(row_get(row, PROYECTOS_COLS, "inversion_mmusd")),
            "empleo_construccion": clean_int(row_get(row, PROYECTOS_COLS, "empleo_construccion")),
            "empleo_operacion": clean_int(row_get(row, PROYECTOS_COLS, "empleo_operacion")),
            "estado_ambiental": clean_text(row_get(row, PROYECTOS_COLS, "estado_ambiental")),
            "etapa": clean_text(row_get(row, PROYECTOS_COLS, "etapa")),
            "fecha_inicio_construccion": clean_date(row_get(row, PROYECTOS_COLS, "fecha_inicio_construccion")),
            "fecha_inicio_operacion": clean_date(row_get(row, PROYECTOS_COLS, "fecha_inicio_operacion")),
            "habilitantes_aprobado": clean_bool(row_get(row, PROYECTOS_COLS, "habilitantes_aprobado"), default=None),
            "fecha_ingreso": clean_date(row_get(row, PROYECTOS_COLS, "fecha_ingreso")),
            "fecha_ultima_resolucion": clean_date(row_get(row, PROYECTOS_COLS, "fecha_ultima_resolucion")),
            "observaciones_oasi": clean_text(row_get(row, PROYECTOS_COLS, "observaciones_oasi")),
        })
    return proyectos, empresas


def read_permisos(wb):
    ws = wb["Permisos"]
    last_row = find_last_real_row(ws)
    permisos = []
    for row in ws.iter_rows(min_row=PERMISOS_DATA_START_ROW, max_row=last_row, values_only=True):
        proyecto_id_excel = clean_text(row_get(row, PERMISOS_COLS, "proyecto_id_excel"))
        organismo = clean_text(row_get(row, PERMISOS_COLS, "organismo"))
        nombre_estandar = clean_text(row_get(row, PERMISOS_COLS, "nombre_estandar"))
        # 35 filas del Excel origen no traen 'Nombre Permiso' pero sí
        # 'Nombre Permiso Estándar' (idéntico en todos los casos vistos) -> fallback.
        nombre = clean_text(row_get(row, PERMISOS_COLS, "nombre")) or nombre_estandar
        if proyecto_id_excel is None or organismo is None or nombre is None:
            continue  # sin proyecto/organismo/nombre no hay permiso valido

        estado = clean_text(row_get(row, PERMISOS_COLS, "estado")) or "Pendiente"
        if estado not in ("Pendiente", "Resuelto", "Descartado"):
            estado = "Pendiente"

        permisos.append({
            "organismo": organismo,
            "proyecto_id_excel": proyecto_id_excel,
            "nombre": nombre,
            "nombre_estandar": clean_text(row_get(row, PERMISOS_COLS, "nombre_estandar")),
            "tipo_permiso": clean_text(row_get(row, PERMISOS_COLS, "tipo_permiso")),
            "n_expediente": clean_text(row_get(row, PERMISOS_COLS, "n_expediente")),
            "critico": clean_bool(row_get(row, PERMISOS_COLS, "critico")),
            "que_habilita": clean_text(row_get(row, PERMISOS_COLS, "que_habilita")),
            "estado": estado,
            "fecha_ingreso": clean_date(row_get(row, PERMISOS_COLS, "fecha_ingreso")),
            "fecha_resolucion_estimada": clean_date(row_get(row, PERMISOS_COLS, "fecha_resolucion_estimada")),
            "fecha_resolucion": clean_date(row_get(row, PERMISOS_COLS, "fecha_resolucion")),
            "tipo_resolucion": clean_text(row_get(row, PERMISOS_COLS, "tipo_resolucion")),
            "hito_tramitacion": clean_text(row_get(row, PERMISOS_COLS, "hito_tramitacion")),
            "n_comite": clean_int(row_get(row, PERMISOS_COLS, "n_comite")),
            "habilitante_construccion": clean_bool(row_get(row, PERMISOS_COLS, "habilitante_construccion")),
            "incluido_catastro_hacienda": clean_bool(row_get(row, PERMISOS_COLS, "incluido_catastro_hacienda"), default=None),
            "observaciones": clean_text(row_get(row, PERMISOS_COLS, "observaciones")),
            "n_catastro": clean_text(row_get(row, PERMISOS_COLS, "n_catastro")),
        })
    return permisos


# ----------------------------------------------------------------------------
# Carga a Postgres
# ----------------------------------------------------------------------------

def load_db_config():
    env_path = os.path.join(BACKEND_DIR, ".env")
    cfg = {}
    if os.path.exists(env_path):
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def get_connection():
    cfg = load_db_config()
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", cfg.get("DB_HOST", "localhost")),
        port=os.environ.get("DB_PORT", cfg.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", cfg.get("DB_NAME")),
        user=os.environ.get("DB_USER", cfg.get("DB_USER")),
        password=os.environ.get("DB_PASSWORD", cfg.get("DB_PASSWORD")),
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", default=DEFAULT_EXCEL)
    parser.add_argument("--dry-run", action="store_true", help="Solo parsear e imprimir conteos, no escribir en la BD")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"No se encontró el Excel: {args.file}", file=sys.stderr)
        sys.exit(1)

    print(f"Leyendo {args.file} ...")
    wb = openpyxl.load_workbook(args.file, read_only=True, data_only=True)

    comites = read_comites(wb)
    proyectos, empresas = read_proyectos(wb)
    permisos = read_permisos(wb)

    organismos_en_permisos = sorted({p["organismo"] for p in permisos})
    organismos_sin_ministerio = [o for o in organismos_en_permisos if o not in ORGANISMO_MINISTERIO]

    print(f"  comites (calendario): {len(comites)}")
    print(f"  proyectos: {len(proyectos)}")
    print(f"  empresas unicas: {len(empresas)}")
    print(f"  permisos: {len(permisos)}")
    print(f"  organismos distintos en permisos: {len(organismos_en_permisos)}")
    if organismos_sin_ministerio:
        print(f"  ADVERTENCIA: organismos sin ministerio mapeado (se van a omitir sus permisos): {organismos_sin_ministerio}")

    proyectos_ids_excel = {p["id_excel"] for p in proyectos}
    permisos_sin_proyecto = [p for p in permisos if p["proyecto_id_excel"] not in proyectos_ids_excel]
    if permisos_sin_proyecto:
        print(f"  ADVERTENCIA: {len(permisos_sin_proyecto)} permisos referencian un proyecto que no existe, se omiten")

    if args.dry_run:
        print("Dry-run: no se escribió nada en la base de datos.")
        return

    conn = get_connection()
    conn.autocommit = False
    cur = conn.cursor()

    try:
        # -- ministerios --
        ministerio_ids = {}
        for nombre in sorted(set(ORGANISMO_MINISTERIO.values())):
            cur.execute(
                "INSERT INTO ministerios (nombre) VALUES (%s) "
                "ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id",
                (nombre,),
            )
            ministerio_ids[nombre] = cur.fetchone()[0]

        # -- organismos --
        organismo_ids = {}
        for sigla in organismos_en_permisos:
            ministerio_nombre = ORGANISMO_MINISTERIO.get(sigla)
            if ministerio_nombre is None:
                continue
            cur.execute(
                "INSERT INTO organismos (id_excel, nombre, ministerio_id) VALUES (%s, %s, %s) "
                "ON CONFLICT (nombre) DO UPDATE SET ministerio_id = EXCLUDED.ministerio_id RETURNING id",
                (sigla, sigla, ministerio_ids[ministerio_nombre]),
            )
            organismo_ids[sigla] = cur.fetchone()[0]

        # -- empresas --
        empresa_ids = {}
        for id_excel, nombre in empresas.items():
            db_id_excel = None if id_excel == "SIN_EMPRESA" else id_excel
            cur.execute(
                "INSERT INTO empresas (id_excel, nombre) VALUES (%s, %s) RETURNING id",
                (db_id_excel, nombre),
            )
            empresa_ids[id_excel] = cur.fetchone()[0]

        # -- comites --
        comite_ids = {}
        for numero, fecha in sorted(comites.items()):
            cur.execute(
                "INSERT INTO comites (numero, fecha) VALUES (%s, %s) "
                "ON CONFLICT (numero) DO UPDATE SET fecha = EXCLUDED.fecha RETURNING id",
                (numero, fecha),
            )
            comite_ids[numero] = cur.fetchone()[0]

        # -- proyectos --
        proyecto_ids = {}
        for p in proyectos:
            cur.execute(
                """
                INSERT INTO proyectos (
                    id_excel, nombre, titular, empresa_id, region, sector,
                    inversion_mmusd, empleo_construccion, empleo_operacion,
                    estado_ambiental, etapa, fecha_inicio_construccion,
                    fecha_inicio_operacion, habilitantes_aprobado, fecha_ingreso,
                    fecha_ultima_resolucion, observaciones_oasi
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    p["id_excel"], p["nombre"], p["titular"], empresa_ids[p["empresa_id_excel"]],
                    p["region"], p["sector"], p["inversion_mmusd"], p["empleo_construccion"],
                    p["empleo_operacion"], p["estado_ambiental"], p["etapa"],
                    p["fecha_inicio_construccion"], p["fecha_inicio_operacion"],
                    p["habilitantes_aprobado"], p["fecha_ingreso"], p["fecha_ultima_resolucion"],
                    p["observaciones_oasi"],
                ),
            )
            proyecto_ids[p["id_excel"]] = cur.fetchone()[0]

        # -- permisos + permisos_comite --
        permisos_cargados = 0
        permisos_comite_cargados = 0
        for p in permisos:
            proyecto_id = proyecto_ids.get(p["proyecto_id_excel"])
            organismo_id = organismo_ids.get(p["organismo"])
            if proyecto_id is None or organismo_id is None:
                continue

            cur.execute(
                """
                INSERT INTO permisos (
                    proyecto_id, organismo_id, nombre, nombre_estandar, tipo_permiso,
                    n_expediente, critico, que_habilita, habilitante_construccion,
                    estado, fecha_ingreso, fecha_resolucion_estimada, fecha_resolucion,
                    tipo_resolucion, hito_tramitacion, incluido_catastro_hacienda,
                    n_catastro, observaciones
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    proyecto_id, organismo_id, p["nombre"], p["nombre_estandar"], p["tipo_permiso"],
                    p["n_expediente"], p["critico"], p["que_habilita"], p["habilitante_construccion"],
                    p["estado"], p["fecha_ingreso"], p["fecha_resolucion_estimada"], p["fecha_resolucion"],
                    p["tipo_resolucion"], p["hito_tramitacion"], p["incluido_catastro_hacienda"],
                    p["n_catastro"], p["observaciones"],
                ),
            )
            permiso_id = cur.fetchone()[0]
            permisos_cargados += 1

            if p["n_comite"] is not None and p["n_comite"] in comite_ids:
                cur.execute(
                    "INSERT INTO permisos_comite (permiso_id, comite_id) VALUES (%s, %s) "
                    "ON CONFLICT (permiso_id, comite_id) DO NOTHING",
                    (permiso_id, comite_ids[p["n_comite"]]),
                )
                permisos_comite_cargados += 1

        conn.commit()
        print()
        print("Carga completa:")
        print(f"  ministerios: {len(ministerio_ids)}")
        print(f"  organismos: {len(organismo_ids)}")
        print(f"  empresas: {len(empresa_ids)}")
        print(f"  comites: {len(comite_ids)}")
        print(f"  proyectos: {len(proyecto_ids)}")
        print(f"  permisos: {permisos_cargados}")
        print(f"  permisos_comite: {permisos_comite_cargados}")

    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
