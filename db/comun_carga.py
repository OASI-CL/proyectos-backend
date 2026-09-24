"""
OASI - Utilidades compartidas por los dos scripts de carga:

    db/seed_catalogos.py   catálogos fijos (NO lee el Excel)
    db/cargar_excel.py     datos que vienen en cada planilla nueva

Los dos scripts funcionan igual: en vez de escribir directo en la base,
GENERAN UN ARCHIVO SQL con todas las sentencias, y ese mismo archivo se
aplica en la base local, en dev y en prod. Así las tres quedan idénticas y
se puede revisar exactamente qué se va a escribir antes de aplicarlo.

El SQL nunca usa ids numéricos de otras tablas: resuelve cada referencia por
su clave natural (una región por su nombre, un proyecto por su "P123", una
empresa por su nombre normalizado). Por eso sirve para cualquier base,
aunque los ids internos difieran entre local, dev y prod.
"""

import datetime as dt
import os
import re
import unicodedata

import psycopg2

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ----------------------------------------------------------------------------
# Conexión a la base LOCAL (la de .env). Dev y prod no se tocan desde acá:
# el archivo SQL se sube con scripts/aplicar-sql.sh.
# ----------------------------------------------------------------------------

def _leer_env():
    cfg = {}
    ruta = os.path.join(BACKEND_DIR, ".env")
    if os.path.exists(ruta):
        with open(ruta, encoding="utf-8") as f:
            for linea in f:
                linea = linea.strip()
                if not linea or linea.startswith("#") or "=" not in linea:
                    continue
                k, v = linea.split("=", 1)
                cfg[k.strip()] = v.strip()
    return cfg


def conectar_local():
    cfg = _leer_env()
    return psycopg2.connect(
        host=os.environ.get("DB_HOST", cfg.get("DB_HOST", "localhost")),
        port=os.environ.get("DB_PORT", cfg.get("DB_PORT", "5432")),
        dbname=os.environ.get("DB_NAME", cfg.get("DB_NAME")),
        user=os.environ.get("DB_USER", cfg.get("DB_USER")),
        password=os.environ.get("DB_PASSWORD", cfg.get("DB_PASSWORD")),
    )


def aplicar_sql_local(sql):
    """Aplica el SQL generado en la base local, todo o nada (una transacción)."""
    conn = conectar_local()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()


# ----------------------------------------------------------------------------
# Generación de SQL
# ----------------------------------------------------------------------------

def lit(v):
    """Un valor Python como literal SQL. Comillas simples escapadas duplicándolas."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return "'" + v.isoformat()[:10] + "'"
    return "'" + str(v).replace("'", "''") + "'"


# ----------------------------------------------------------------------------
# Normalización de nombres: la clave natural de empresas y titulares.
# ----------------------------------------------------------------------------

# Sufijos societarios que NO cambian de qué empresa se habla: "Colbún" y
# "Colbun S.A." son la misma. Se sacan solo del FINAL del nombre.
_SUFIJOS_SOCIETARIOS = {"s a", "sa", "spa", "s p a", "ltda", "limitada", "s a c", "scm", "sociedad anonima"}


def normalizar(texto):
    """
    Minúsculas, sin tildes, sin signos, espacios simples.
    "Minera Centinela." -> "minera centinela". None/vacío -> None.
    """
    if texto is None:
        return None
    s = str(texto).strip()
    if s == "":
        return None
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s or None


def normalizar_empresa(texto):
    """
    Como normalizar(), y además saca sufijos societarios del final:
    "Colbun S.A." -> "colbun", "CRAMSA Infraestructusa SpA." -> "cramsa infraestructusa".
    """
    s = normalizar(texto)
    if s is None:
        return None
    cambio = True
    while cambio:
        cambio = False
        for suf in sorted(_SUFIJOS_SOCIETARIOS, key=len, reverse=True):
            if s.endswith(" " + suf) and len(s) > len(suf) + 1:
                s = s[: -(len(suf) + 1)].strip()
                cambio = True
    return s or None
