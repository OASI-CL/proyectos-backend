"""
OASI - Carga de la planilla "Levantamiento de Permisos" (se corre cada vez
que llega una versión nueva, aprox. cada 2 días).

QUÉ CARGA (y de qué hoja):

    comites          hoja "Parámetros", tabla "Calendario de Sesiones" (col B-C)
    empresas         hoja "Titular-Empresa" (col "Nombre empresa") + col "empresa" de "Proyectos"
    titulares        hoja "Titular-Empresa" (col "Titular")        + col "titular" de "Proyectos"
    proyectos        hoja "Proyectos"
    permisos         hoja "Permisos"
    permisos_comite  col "comite_registro" de "Permisos" ("Comité 12" -> sesión 12)

Los catálogos (regiones, sectores, organismos, ...) NO se cargan acá: están
fijos en db/seed_catalogos.py. Este script solo los usa para VALIDAR.

CONCEPTOS (no confundir):
    EMPRESA = el grupo que quiere sacar adelante el proyecto (AMSA, CODELCO).
    TITULAR = la razón social que tramita los permisos del proyecto
              (Minera Centinela, Codelco Chile División Salvador).
    Una empresa tiene muchos titulares; cada proyecto tiene uno de cada uno.

CÓMO DECIDE SI ALGO ES NUEVO O YA EXISTE (carga INCREMENTAL):

    proyecto -> por su código de la planilla ("P123", columna id_proyecto)
    permiso  -> por su código ("PM1377", columna id_permiso)
    comité   -> por su número de sesión
    empresa  -> por su NOMBRE normalizado (ver comun_carga.normalizar_empresa):
                "Colbún", "Colbun S.A." y "COLBUN" son la misma.
                NO por el código "E###": ese código no es confiable (la misma
                empresa aparece con varios, y un mismo código aparece en
                empresas distintas). Agrupar por código fue el error que dejó
                cientos de proyectos con la empresa mal puesta.
    titular  -> por su nombre normalizado, igual que empresa.

    Si ya existe: se ACTUALIZA con lo que diga la planilla nueva.
    Si no existe: se AGREGA.
    Si estaba en la base y ya no viene en la planilla: NO se borra. Se lista
    en el reporte, para que alguien decida.

    La planilla manda: si alguien editó un proyecto desde la app y la
    planilla trae otro valor, gana la planilla. Lo creado DESDE LA APP (sin
    código P/PM) nunca se toca.

CÓMO SE CORRE (desde proyectos-backend/):

    .venv/bin/python db/cargar_excel.py --file "data/20260923 ....xlsx"
        -> valida, genera data/cargas/<fecha>_carga.sql, lo aplica en la base
           LOCAL y muestra el reporte.
    .venv/bin/python db/cargar_excel.py --file ... --revisar
        -> solo valida y muestra el reporte; no genera ni aplica nada.

    scripts/aplicar-sql.sh dev  data/cargas/<fecha>_carga.sql
    scripts/aplicar-sql.sh prod data/cargas/<fecha>_carga.sql
        -> aplica ESE MISMO archivo en dev y prod.

    El SQL generado es privado (trae datos de la planilla): queda en data/,
    que no se sube a git.
"""

import argparse
import datetime as dt
import os
import re
import sys
from collections import Counter, defaultdict

import openpyxl

from comun_carga import BACKEND_DIR, aplicar_sql_local, conectar_local, lit, normalizar_empresa
import seed_catalogos as cat

CARGADO_POR = "carga_excel"  # queda en created_by / updated_by de lo que escribe este script
SIN_EMPRESA = "Sin empresa asignada"


# ============================================================================
# 1. LIMPIEZA DE VALORES (la planilla se llena a mano y viene sucia)
# ============================================================================

VACIOS = ("", "S/I", "-", "N/A", "s/i")


def texto(v):
    """Texto limpio. Vacío, 'S/I', '-', 'N/A' -> None. Números enteros sin '.0'."""
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace("\xa0", " ").strip()
    return None if s in VACIOS else s


def numero(v):
    """Número, o None si viene vacío o como texto que no es número."""
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip().replace(",", ".")
    if s in VACIOS:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def entero(v):
    n = numero(v)
    return int(n) if n is not None else None


FECHA_BASE_EXCEL = dt.date(1899, 12, 30)


def fecha(v):
    """
    Acepta: fecha real de Excel; número de serie de Excel guardado como texto
    ('46268', solo si cae entre ~2015 y ~2036); texto 'DD-MM-YYYY'.
    Cualquier otra cosa ('Por definir', basura, años < 2000) -> None.
    """
    if isinstance(v, dt.datetime):
        d = v.date()
    elif isinstance(v, dt.date):
        d = v
    elif isinstance(v, str):
        s = v.strip()
        if s.isdigit() and 42000 <= int(s) <= 50000:
            d = FECHA_BASE_EXCEL + dt.timedelta(days=int(s))
        else:
            try:
                d = dt.datetime.strptime(s, "%d-%m-%Y").date()
            except ValueError:
                return None
    else:
        return None
    return d if d.year >= 2000 else None


def si_no(v):
    """
    'Sí'/'Si'/'SI'/'si'/1 -> True; 'No'/'no'/0 -> False; vacío -> None.
    Cualquier otra cosa (un '2', un texto largo) -> 'dudoso': se devuelve
    None y quien llama decide y lo cuenta en el reporte.
    """
    if v is None:
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return {1: True, 0: False}.get(v, "dudoso")
    s = str(v).strip().lower()
    if s == "":
        return None
    if s in ("sí", "si", "s", "1"):
        return True
    if s in ("no", "n", "0"):
        return False
    return "dudoso"


def comite_numero(v):
    """'Comité 12' -> 12. 'Por definir' / vacío -> None."""
    s = texto(v)
    if s is None:
        return None
    m = re.search(r"comit[ée]\s*(\d+)", s, re.IGNORECASE)
    return int(m.group(1)) if m else None


def es_solo_numero(s):
    return s is not None and re.fullmatch(r"[\d.\s]+", s) is not None


# ============================================================================
# 2. LECTURA DE LA PLANILLA
# ============================================================================

class PlanillaInvalida(Exception):
    """Algo en la planilla impide cargar. Se aborta ANTES de escribir nada."""


# Columnas que el script necesita, por NOMBRE (fila 2 de cada hoja). Si la
# planilla las reordena no pasa nada; si falta alguna, se aborta avisando.
COLS_PROYECTOS = [
    "id_proyecto", "nombre_proyecto", "titular", "empresa", "region", "sector",
    "tipologia", "inversion_mmusd", "empleo_construccion", "empleo_operacion",
    "estado_ambiental", "etapa_proyecto", "fecha_inicio_construccion",
    "fecha_inicio_operacion", "habilitantes_aprobado", "observaciones_oasi",
    "fecha_ingreso", "fecha_ultima_resolucion", "n_catastro",
    "incluido_en_catastro", "en_universo_permisos", "sigue_liberado_al_contactar",
    "listado_37_proyectos_liberados", "listado_97_proyectos_no_iniciados",
]
# No se cargan (son cálculos que la app ya hace sola): cantidad_total_permisos,
# permisos_pendientes, tiene_permisos_mas_6_meses, cien_pct_mas_6m_en_tramite,
# proyecto_sin_permisos_pendientes_bbdd. Tampoco id_empresa / id_titular.

COLS_PERMISOS = [
    "id_permiso", "organismo", "nombre_permiso_titular", "tipo_permiso",
    "nombre_permiso_decreto", "codigo_cpat", "nombre_permiso_cpat", "n_expediente",
    "que_habilita", "id_proyecto", "estado", "fecha_ingreso",
    "fecha_resolucion_estimada", "fecha_resolucion", "tipo_resolucion",
    "hito_tramitacion", "es_permiso_habilitante_construccion", "observaciones",
    "n_catastro", "en_universo", "fecha_registro_catastro", "comite_registro",
    "fecha_actualizacion", "quien_actualizo", "incluido_catastro_hacienda",
]
# No se cargan: ministerio (sale del catálogo de organismos), nombre_proyecto,
# titular, empresa, sector, region, etapa_actual, inversion, empleos (son
# copias de los del proyecto), dias_tramitacion y supera_6_meses (cálculos).


def leer_hoja(wb, nombre_hoja, columnas, fila_encabezado=2):
    if nombre_hoja not in wb.sheetnames:
        raise PlanillaInvalida(f"La planilla no tiene la hoja '{nombre_hoja}'.")
    ws = wb[nombre_hoja]
    encabezado = [c.value for c in next(ws.iter_rows(min_row=fila_encabezado, max_row=fila_encabezado))]
    idx = {str(h).strip(): i for i, h in enumerate(encabezado) if h is not None and str(h).strip()}
    faltan = [c for c in columnas if c not in idx]
    if faltan:
        raise PlanillaInvalida(
            f"A la hoja '{nombre_hoja}' le faltan columnas: {faltan}\n"
            f"  (encabezados en la fila {fila_encabezado}: {list(idx)})"
        )
    filas = []
    for n, row in enumerate(ws.iter_rows(min_row=fila_encabezado + 1, values_only=True), start=fila_encabezado + 1):
        if all(v is None or str(v).strip() == "" for v in row):
            continue
        fila = {c: (row[idx[c]] if idx[c] < len(row) else None) for c in columnas}
        fila["_fila"] = n
        filas.append(fila)
    return filas


def leer_titular_empresa(wb):
    """Hoja 'Titular-Empresa': encabezado en la fila 1 (Titular | Nombre empresa)."""
    hoja = "Titular-Empresa"
    if hoja not in wb.sheetnames:
        raise PlanillaInvalida(f"La planilla no tiene la hoja '{hoja}'.")
    ws = wb[hoja]
    encabezado = [str(c.value).strip() if c.value is not None else "" for c in next(ws.iter_rows(min_row=1, max_row=1))]
    try:
        i_tit, i_emp = encabezado.index("Titular"), encabezado.index("Nombre empresa")
    except ValueError:
        raise PlanillaInvalida(f"La hoja '{hoja}' debe tener columnas 'Titular' y 'Nombre empresa' (tiene {encabezado}).")
    pares = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        tit = texto(row[i_tit]) if i_tit < len(row) else None
        emp = texto(row[i_emp]) if i_emp < len(row) else None
        if tit or emp:
            pares.append((tit, emp))
    return pares


def leer_comites(wb):
    """Hoja 'Parámetros', 'Calendario de Sesiones': col B = número, col C = fecha."""
    ws = wb["Parámetros"]
    comites = {}
    for row in ws.iter_rows(min_row=1, max_row=200, max_col=3, values_only=True):
        n, f = row[1], row[2]
        if isinstance(n, (int, float)) and not isinstance(n, bool) and isinstance(f, (dt.date, dt.datetime)):
            comites[int(n)] = fecha(f)
    if not comites:
        raise PlanillaInvalida("No encontré el calendario de sesiones en la hoja 'Parámetros' (col B = sesión, col C = fecha).")
    return comites


# ============================================================================
# 3. ARMADO DE LO QUE SE VA A CARGAR (+ validación contra los catálogos)
# ============================================================================

def armar(wb):
    rep = defaultdict(list)  # reporte: problema -> lista de ejemplos

    comites = leer_comites(wb)
    pares_te = leer_titular_empresa(wb)
    filas_pro = leer_hoja(wb, "Proyectos", COLS_PROYECTOS)
    filas_per = leer_hoja(wb, "Permisos", COLS_PERMISOS)

    regiones = {r[3] for r in cat.REGIONES}
    sectores = {s[1] for s in cat.SECTORES}
    etapas = {e[2] for e in cat.ETAPAS_PROYECTO}
    estados = {e[2] for e in cat.ESTADOS_PERMISO}
    organismos = {o[1] for o in cat.ORGANISMOS}
    tipologias = {t[1] for t in cat.TIPOLOGIAS}

    # --- EMPRESAS: clave = nombre normalizado. Nombre a mostrar: el de la hoja
    # "Titular-Empresa" si está ahí (es la lista de referencia), si no el
    # primero que aparezca en "Proyectos".
    empresas = {}  # norm -> nombre a mostrar
    for _, emp in pares_te:
        if emp:
            empresas.setdefault(normalizar_empresa(emp), emp)

    # --- TITULARES: clave = nombre normalizado; empresa según la hoja
    # "Titular-Empresa" (puede corregirse abajo con lo que dicen los proyectos).
    titulares = {}  # norm -> {"nombre", "empresa_hoja"}
    for tit, emp in pares_te:
        if not tit:
            continue
        t = titulares.setdefault(normalizar_empresa(tit), {"nombre": tit, "empresa_hoja": set()})
        if emp:
            t["empresa_hoja"].add(normalizar_empresa(emp))

    # --- PROYECTOS ---
    proyectos, vistos = [], set()
    empresas_por_titular = defaultdict(Counter)  # lo que dicen los PROYECTOS
    for f in filas_pro:
        cod = texto(f["id_proyecto"])
        if cod is None:
            rep["Proyectos sin id_proyecto (no se cargan)"].append(f"fila {f['_fila']}")
            continue
        if cod in vistos:
            rep["id_proyecto repetido (se usa la primera fila)"].append(cod)
            continue
        vistos.add(cod)

        emp_txt = texto(f["empresa"])
        if emp_txt is None:
            emp_txt = SIN_EMPRESA
            rep["Proyecto sin empresa (queda como 'Sin empresa asignada')"].append(cod)
        emp_norm = normalizar_empresa(emp_txt)
        if emp_norm not in empresas:
            empresas[emp_norm] = emp_txt
            if emp_txt != SIN_EMPRESA:
                rep["Empresa de 'Proyectos' que no está en la hoja 'Titular-Empresa' (se crea igual)"].append(f"{cod}: {emp_txt}")

        tit_txt = texto(f["titular"])
        tit_norm = normalizar_empresa(tit_txt)
        if tit_norm:
            if tit_norm not in titulares:
                titulares[tit_norm] = {"nombre": tit_txt, "empresa_hoja": set()}
                rep["Titular de 'Proyectos' que no está en la hoja 'Titular-Empresa' (se crea igual)"].append(f"{cod}: {tit_txt}")
            empresas_por_titular[tit_norm][emp_norm] += 1
            hoja = titulares[tit_norm]["empresa_hoja"]
            if hoja and emp_norm not in hoja:
                rep["El proyecto dice una empresa y 'Titular-Empresa' otra (manda el proyecto)"].append(
                    f"{cod}: titular '{tit_txt}' -> proyecto dice '{emp_txt}', la hoja dice {sorted(empresas[e] for e in hoja if e in empresas)}"
                )

        region = texto(f["region"])
        if region and region not in regiones:
            raise PlanillaInvalida(f"{cod}: la región '{region}' no está en el catálogo (db/seed_catalogos.py, REGIONES).")
        sector = texto(f["sector"])
        sector = cat.SECTOR_ALIAS.get(sector, sector)
        if sector and sector not in sectores:
            raise PlanillaInvalida(f"{cod}: el sector '{sector}' no está en el catálogo (db/seed_catalogos.py, SECTORES / SECTOR_ALIAS).")
        tipologia = texto(f["tipologia"])
        tipologia = cat.TIPOLOGIA_ALIAS.get(tipologia, tipologia)
        if tipologia and tipologia not in tipologias:
            rep["Tipología que no está en el catálogo (queda vacía)"].append(f"{cod}: {tipologia}")
            tipologia = None
        etapa = texto(f["etapa_proyecto"])
        if etapa and etapa not in etapas:
            raise PlanillaInvalida(f"{cod}: la etapa '{etapa}' no está en el catálogo (db/seed_catalogos.py, ETAPAS_PROYECTO).")
        if etapa is None:
            rep["Proyecto sin etapa"].append(cod)

        flags = {}
        for col in ("habilitantes_aprobado", "incluido_en_catastro", "en_universo_permisos",
                    "sigue_liberado_al_contactar", "listado_37_proyectos_liberados",
                    "listado_97_proyectos_no_iniciados"):
            v = si_no(f[col])
            if v == "dudoso":
                rep[f"Valor raro en '{col}' (queda vacío)"].append(f"{cod}: {f[col]!r}")
                v = None
            flags[col] = v

        proyectos.append({
            "id_excel": cod,
            "nombre": texto(f["nombre_proyecto"]) or cod,
            "titular": tit_txt,
            "titular_norm": tit_norm,
            "empresa_norm": emp_norm,
            "region": region,
            "sector": sector,
            "tipologia": tipologia,
            "etapa": etapa,
            "inversion_mmusd": numero(f["inversion_mmusd"]),
            "empleo_construccion": entero(f["empleo_construccion"]),
            "empleo_operacion": entero(f["empleo_operacion"]),
            "estado_ambiental": texto(f["estado_ambiental"]),
            "fecha_inicio_construccion": fecha(f["fecha_inicio_construccion"]),
            "fecha_inicio_operacion": fecha(f["fecha_inicio_operacion"]),
            "fecha_ingreso": fecha(f["fecha_ingreso"]),
            "fecha_ultima_resolucion": fecha(f["fecha_ultima_resolucion"]),
            "observaciones_oasi": texto(f["observaciones_oasi"]),
            "n_catastro": entero(f["n_catastro"]),
            **flags,
        })

    # La empresa de cada titular: la que más le asignan los proyectos; si el
    # titular no tiene proyectos, la de la hoja "Titular-Empresa".
    for norm, t in titulares.items():
        if empresas_por_titular[norm]:
            t["empresa_norm"] = empresas_por_titular[norm].most_common(1)[0][0]
        elif t["empresa_hoja"]:
            t["empresa_norm"] = sorted(t["empresa_hoja"])[0]
            if len(t["empresa_hoja"]) > 1:
                rep["Titular con más de una empresa en 'Titular-Empresa' (se usa una)"].append(
                    f"{t['nombre']}: {sorted(empresas[e] for e in t['empresa_hoja'])}")
        else:
            t["empresa_norm"] = None

    # --- PERMISOS ---
    permisos, vistos = [], set()
    habilitante_dudoso = Counter()
    for f in filas_per:
        cod = texto(f["id_permiso"])
        if cod is None:
            rep["Permisos sin id_permiso (no se cargan)"].append(f"fila {f['_fila']}")
            continue
        if cod in vistos:
            rep["id_permiso repetido (se usa la primera fila)"].append(cod)
            continue
        vistos.add(cod)

        proy = texto(f["id_proyecto"])
        if proy not in {p["id_excel"] for p in proyectos}:
            rep["Permiso cuyo proyecto no está en la hoja 'Proyectos' (no se carga)"].append(f"{cod} -> {proy}")
            continue

        org = texto(f["organismo"])
        if org not in organismos:
            raise PlanillaInvalida(f"{cod}: el organismo '{org}' no está en el catálogo (db/seed_catalogos.py, ORGANISMOS).")

        estado = texto(f["estado"]) or "Pendiente"
        if estado not in estados:
            rep["Estado desconocido (queda 'Pendiente')"].append(f"{cod}: {estado}")
            estado = "Pendiente"

        # Nombre: el del titular; si no trae o es solo un número ("138"), el
        # primero con texto de decreto / CPAT / tipo.
        candidatos = [texto(f[c]) for c in ("nombre_permiso_titular", "nombre_permiso_decreto", "nombre_permiso_cpat", "tipo_permiso")]
        nombre = next((c for c in candidatos if c and not es_solo_numero(c)), None)
        if nombre is None:
            nombre = cod
            rep["Permiso sin ningún nombre (queda con su código)"].append(cod)
        elif nombre != candidatos[0]:
            rep["Permiso sin 'nombre_permiso_titular' usable (se tomó otra columna)"].append(f"{cod}: {candidatos[0]!r} -> {nombre!r}")

        hab = si_no(f["es_permiso_habilitante_construccion"])
        if hab == "dudoso":
            habilitante_dudoso[str(f["es_permiso_habilitante_construccion"])] += 1
            hab = False

        flags = {}
        for col in ("en_universo", "incluido_catastro_hacienda"):
            v = si_no(f[col])
            if v == "dudoso":
                rep[f"Valor raro en '{col}' (queda vacío)"].append(f"{cod}: {f[col]!r}")
                v = None
            flags[col] = v

        n_com = comite_numero(f["comite_registro"])
        if n_com is not None and n_com not in comites:
            rep["Comité que no está en el calendario de 'Parámetros' (no se vincula)"].append(f"{cod}: comité {n_com}")
            n_com = None

        permisos.append({
            "id_excel": cod,
            "proyecto": proy,
            "organismo": org,
            "estado": estado,
            "nombre": nombre,
            "nombre_estandar": texto(f["nombre_permiso_cpat"]),
            "codigo_cpat": texto(f["codigo_cpat"]),
            "nombre_decreto": texto(f["nombre_permiso_decreto"]),
            "tipo_permiso": texto(f["tipo_permiso"]),
            "n_expediente": texto(f["n_expediente"]),
            "que_habilita": texto(f["que_habilita"]),
            "habilitante_construccion": bool(hab),
            "fecha_ingreso": fecha(f["fecha_ingreso"]),
            "fecha_resolucion_estimada": fecha(f["fecha_resolucion_estimada"]),
            "fecha_resolucion": fecha(f["fecha_resolucion"]),
            "tipo_resolucion": texto(f["tipo_resolucion"]),
            "hito_tramitacion": texto(f["hito_tramitacion"]),
            "observaciones": texto(f["observaciones"]),
            "n_catastro": texto(f["n_catastro"]),
            "fecha_registro_catastro": fecha(f["fecha_registro_catastro"]),
            "fecha_actualizacion": fecha(f["fecha_actualizacion"]),
            "quien_actualizo": texto(f["quien_actualizo"]),
            "comite": n_com,
            **flags,
        })
    for valor, n in habilitante_dudoso.most_common():
        rep["'es_permiso_habilitante_construccion' con valor raro (queda como NO habilitante)"].append(f"{valor!r}: {n} permisos")

    return {"comites": comites, "empresas": empresas, "titulares": titulares,
            "proyectos": proyectos, "permisos": permisos}, rep


# ============================================================================
# 4. GENERACIÓN DEL SQL (todo con INSERT ... ON CONFLICT: agrega o actualiza)
# ============================================================================

def _id_por(tabla, columna, valor):
    """Subconsulta que resuelve una referencia por su clave natural."""
    return f"(SELECT id FROM {tabla} WHERE {columna} = {lit(valor)})" if valor is not None else "NULL"


def generar_sql(d, archivo_excel):
    by = lit(CARGADO_POR)
    s = [
        f"-- Carga de '{os.path.basename(archivo_excel)}' generada por db/cargar_excel.py",
        f"-- el {dt.datetime.now():%Y-%m-%d %H:%M}. Incremental: agrega o actualiza, no borra.",
    ]

    s.append("\n-- COMITÉS (clave: número de sesión)")
    for n, f in sorted(d["comites"].items()):
        s.append(
            f"INSERT INTO comites (numero, fecha, created_by, updated_by) VALUES ({n}, {lit(f)}, {by}, {by}) "
            f"ON CONFLICT (numero) DO UPDATE SET fecha = EXCLUDED.fecha, updated_by = EXCLUDED.updated_by;"
        )

    s.append("\n-- EMPRESAS (clave: nombre normalizado)")
    for norm, nombre in sorted(d["empresas"].items()):
        s.append(
            f"INSERT INTO empresas (nombre, nombre_normalizado, created_by, updated_by) "
            f"VALUES ({lit(nombre)}, {lit(norm)}, {by}, {by}) "
            f"ON CONFLICT (nombre_normalizado) WHERE nombre_normalizado IS NOT NULL "
            f"DO UPDATE SET nombre = EXCLUDED.nombre, updated_by = EXCLUDED.updated_by;"
        )

    s.append("\n-- TITULARES (clave: nombre normalizado; la empresa se busca por nombre normalizado)")
    for norm, t in sorted(d["titulares"].items()):
        s.append(
            f"INSERT INTO titulares (nombre, nombre_normalizado, empresa_id, created_by, updated_by) "
            f"VALUES ({lit(t['nombre'])}, {lit(norm)}, {_id_por('empresas', 'nombre_normalizado', t['empresa_norm'])}, {by}, {by}) "
            f"ON CONFLICT (nombre_normalizado) WHERE nombre_normalizado IS NOT NULL "
            f"DO UPDATE SET nombre = EXCLUDED.nombre, empresa_id = EXCLUDED.empresa_id, updated_by = EXCLUDED.updated_by;"
        )

    s.append("\n-- PROYECTOS (clave: id_excel 'P123'; catálogos y empresa/titular se buscan por nombre)")
    cols_p = ["id_excel", "nombre", "titular", "titular_id", "empresa_id", "region_id", "sector_id",
              "tipologia_id", "etapa_id", "inversion_mmusd", "empleo_construccion", "empleo_operacion",
              "estado_ambiental", "fecha_inicio_construccion", "fecha_inicio_operacion",
              "habilitantes_aprobado", "fecha_ingreso", "fecha_ultima_resolucion", "observaciones_oasi",
              "n_catastro", "incluido_en_catastro", "en_universo_permisos", "sigue_liberado_al_contactar",
              "listado_37_proyectos_liberados", "listado_97_proyectos_no_iniciados"]
    for p in d["proyectos"]:
        vals = [
            lit(p["id_excel"]), lit(p["nombre"]), lit(p["titular"]),
            _id_por("titulares", "nombre_normalizado", p["titular_norm"]),
            _id_por("empresas", "nombre_normalizado", p["empresa_norm"]),
            _id_por("regiones", "nombre", p["region"]),
            _id_por("sectores", "nombre", p["sector"]),
            _id_por("tipologias", "nombre", p["tipologia"]),
            _id_por("etapas_proyecto", "nombre", p["etapa"]),
        ] + [lit(p[c]) for c in cols_p[9:]]
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols_p[1:])
        s.append(
            f"INSERT INTO proyectos ({', '.join(cols_p)}, created_by, updated_by) "
            f"VALUES ({', '.join(vals)}, {by}, {by}) "
            f"ON CONFLICT (id_excel) WHERE id_excel IS NOT NULL "
            f"DO UPDATE SET {updates}, updated_by = EXCLUDED.updated_by;"
        )

    s.append("\n-- PERMISOS (clave: id_excel 'PM1377'; proyecto por su 'P123', organismo por sigla, estado por nombre)")
    cols_m = ["id_excel", "proyecto_id", "organismo_id", "estado_id", "nombre", "nombre_estandar",
              "codigo_cpat", "nombre_decreto", "tipo_permiso", "n_expediente", "que_habilita",
              "habilitante_construccion", "fecha_ingreso", "fecha_resolucion_estimada",
              "fecha_resolucion", "tipo_resolucion", "hito_tramitacion", "observaciones", "n_catastro",
              "en_universo", "incluido_catastro_hacienda", "fecha_registro_catastro",
              "fecha_actualizacion", "quien_actualizo"]
    for m in d["permisos"]:
        vals = [
            lit(m["id_excel"]),
            _id_por("proyectos", "id_excel", m["proyecto"]),
            _id_por("organismos", "nombre", m["organismo"]),
            _id_por("estados_permiso", "nombre", m["estado"]),
        ] + [lit(m[c]) for c in cols_m[4:]]
        updates = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols_m[1:])
        s.append(
            f"INSERT INTO permisos ({', '.join(cols_m)}, created_by, updated_by) "
            f"VALUES ({', '.join(vals)}, {by}, {by}) "
            f"ON CONFLICT (id_excel) WHERE id_excel IS NOT NULL "
            f"DO UPDATE SET {updates}, updated_by = EXCLUDED.updated_by;"
        )

    s.append("\n-- PERMISOS_COMITE: en qué sesión entró cada permiso (solo se agregan vínculos, no se borran)")
    for m in d["permisos"]:
        if m["comite"] is None:
            continue
        s.append(
            f"INSERT INTO permisos_comite (permiso_id, comite_id) VALUES "
            f"({_id_por('permisos', 'id_excel', m['id_excel'])}, {_id_por('comites', 'numero', m['comite'])}) "
            f"ON CONFLICT (permiso_id, comite_id) DO NOTHING;"
        )
    return "\n".join(s) + "\n"


# ============================================================================
# 5. REPORTE: qué es nuevo, qué ya estaba, qué falta, qué vino raro
# ============================================================================

def comparar_con_base(d):
    """Contra la base LOCAL: cuántos son nuevos y qué hay en la base que no vino."""
    conn = conectar_local()
    try:
        with conn.cursor() as cur:
            def existentes(sql):
                cur.execute(sql)
                return {r[0] for r in cur.fetchall()}
            base = {
                "proyectos": existentes("SELECT id_excel FROM proyectos WHERE id_excel IS NOT NULL"),
                "permisos": existentes("SELECT id_excel FROM permisos WHERE id_excel IS NOT NULL"),
                "empresas": existentes("SELECT nombre_normalizado FROM empresas WHERE nombre_normalizado IS NOT NULL"),
                "titulares": existentes("SELECT nombre_normalizado FROM titulares WHERE nombre_normalizado IS NOT NULL"),
                "comites": existentes("SELECT numero FROM comites"),
            }
    finally:
        conn.close()
    nuevos = {
        "comites": set(d["comites"]),
        "empresas": set(d["empresas"]),
        "titulares": set(d["titulares"]),
        "proyectos": {p["id_excel"] for p in d["proyectos"]},
        "permisos": {m["id_excel"] for m in d["permisos"]},
    }
    return {t: (len(nuevos[t] - base[t]), len(nuevos[t] & base[t]), sorted(base[t] - nuevos[t])) for t in nuevos}


def imprimir_reporte(d, rep, comparacion):
    print("\n=== LO QUE TRAE LA PLANILLA ===")
    print(f"  comités: {len(d['comites'])}   empresas: {len(d['empresas'])}   titulares: {len(d['titulares'])}")
    print(f"  proyectos: {len(d['proyectos'])}   permisos: {len(d['permisos'])}   "
          f"vínculos permiso-comité: {sum(1 for m in d['permisos'] if m['comite'])}")
    sin_emp = sum(1 for p in d["proyectos"] if p["empresa_norm"] == normalizar_empresa(SIN_EMPRESA))
    print(f"  proyectos sin empresa: {sin_emp}")

    if comparacion:
        print("\n=== CONTRA LA BASE LOCAL (antes de aplicar) ===")
        for t, (n_nuevos, n_existen, faltan) in comparacion.items():
            linea = f"  {t:10} nuevos: {n_nuevos:4}   se actualizan: {n_existen:4}"
            if faltan:
                linea += f"   EN LA BASE PERO NO EN LA PLANILLA (no se borran): {len(faltan)} {faltan[:10]}"
            print(linea)

    if rep:
        print("\n=== PARA REVISAR EN LA PLANILLA ===")
        for problema, casos in rep.items():
            print(f"  - {problema}: {len(casos)}")
            for c in casos[:8]:
                print(f"      {c}")
            if len(casos) > 8:
                print(f"      ... y {len(casos) - 8} más")


# ============================================================================
# 6. MAIN
# ============================================================================

def main():
    parser = argparse.ArgumentParser(description="Carga incremental de la planilla de levantamiento de permisos.")
    parser.add_argument("--file", required=True, help="Ruta al .xlsx (ej. 'data/20260923 Levantamiento de Permisos C.M.E.xlsx')")
    parser.add_argument("--revisar", action="store_true", help="Solo validar y mostrar el reporte; no genera ni aplica nada.")
    parser.add_argument("--no-aplicar", action="store_true", help="Genera el SQL pero no lo aplica en la base local.")
    args = parser.parse_args()

    if not os.path.exists(args.file):
        print(f"No encontré la planilla: {args.file}", file=sys.stderr)
        return 1

    print(f"Leyendo {args.file} ...")
    wb = openpyxl.load_workbook(args.file, read_only=True, data_only=True)
    try:
        datos, rep = armar(wb)
    except PlanillaInvalida as err:
        print(f"\nNO SE CARGÓ NADA. {err}", file=sys.stderr)
        return 1

    comparacion = None
    try:
        comparacion = comparar_con_base(datos)
    except Exception as err:  # la base local puede no estar levantada; el reporte sigue igual
        print(f"(no pude comparar con la base local: {err})")
    imprimir_reporte(datos, rep, comparacion)

    if args.revisar:
        print("\n--revisar: no se generó ni aplicó nada.")
        return 0

    carpeta = os.path.join(BACKEND_DIR, "data", "cargas")
    os.makedirs(carpeta, exist_ok=True)
    ruta_sql = os.path.join(carpeta, f"{dt.datetime.now():%Y%m%d_%H%M}_carga.sql")
    with open(ruta_sql, "w", encoding="utf-8") as f:
        f.write(generar_sql(datos, args.file))
    print(f"\nSQL generado: {os.path.relpath(ruta_sql, BACKEND_DIR)}")

    if args.no_aplicar:
        return 0
    aplicar_sql_local(open(ruta_sql, encoding="utf-8").read())
    print("Aplicado en la base local. Para dev/prod:")
    print(f"  scripts/aplicar-sql.sh dev  {os.path.relpath(ruta_sql, BACKEND_DIR)}")
    print(f"  scripts/aplicar-sql.sh prod {os.path.relpath(ruta_sql, BACKEND_DIR)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
