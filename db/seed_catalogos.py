"""
OASI - CATÁLOGOS: las tablas "básicas" que no vienen del Excel.

    ministerios, organismos, regiones, sectores, tipologias,
    etapas_proyecto, estados_permiso

Son listas cerradas y estables (el organigrama del Estado, las regiones,
la taxonomía de sectores). Sus datos están ESCRITOS EN ESTE ARCHIVO, no se
leen de ninguna planilla. Si cambia algo (un organismo nuevo, una tipología
nueva), se edita la lista de acá abajo y se vuelve a correr.

Es IDEMPOTENTE: se puede correr las veces que se quiera. Cada fila se
inserta si no existe y se actualiza si ya estaba (por su id fijo), nunca se
duplica ni se borra.

Los ids son FIJOS y significan lo mismo en local, dev y prod (region_id = 3
es Antofagasta en las tres). Nunca cambiar el id de una fila existente:
los proyectos y permisos ya cargados apuntan a él. Para agregar, usar un id
nuevo.

Uso (desde proyectos-backend/):
    .venv/bin/python db/seed_catalogos.py                 # aplica en la base local
    .venv/bin/python db/seed_catalogos.py --solo-sql X.sql  # solo genera el SQL
    scripts/aplicar-sql.sh dev X.sql                      # aplica ese SQL en dev/prod

db/cargar_excel.py importa estas listas para VALIDAR la planilla antes de
cargarla: si trae una región, sector u organismo que no está acá, avisa y
no carga nada (hay que agregarlo primero a este archivo).
"""

import argparse
import sys

from comun_carga import aplicar_sql_local, lit


# ============================================================================
# DATOS
# ============================================================================

# --- MINISTERIOS: (id, nombre, sigla) --------------------------------------
MINISTERIOS = [
    (1, "Ministerio de Agricultura", "MINAGRI"),
    (2, "Ministerio de Bienes Nacionales", "MBN"),
    (3, "Ministerio de Defensa Nacional", "MDN"),
    (4, "Ministerio de Energía", "MINENERGIA"),
    (5, "Ministerio de Medio Ambiente", "MMA"),
    (6, "Ministerio de Minería", "MINMINERIA"),
    (7, "Ministerio de Obras Públicas", "MOP"),
    (8, "Ministerio de Salud", "MINSAL"),
    (9, "Ministerio de Transportes y Telecomunicaciones", "MTT"),
    (10, "Ministerio de Vivienda y Urbanismo", "MINVU"),
    (11, "Ministerio de las Culturas, las Artes y el Patrimonio", "MINCAP"),
    (12, "Municipalidades", None),
]

# --- ORGANISMOS: (id, sigla, nombre largo, ministerio) ---------------------
# La SIGLA es la que se muestra en la app y la que trae la columna
# "organismo" de la hoja "Permisos" (se busca por ella, tal cual).
ORGANISMOS = [
    (1, "BBNN", "Ministerio de Bienes Nacionales", "Ministerio de Bienes Nacionales"),
    (2, "CEN", "Coordinador Eléctrico Nacional", "Ministerio de Energía"),
    (3, "CMN", "Consejo de Monumentos Nacionales", "Ministerio de las Culturas, las Artes y el Patrimonio"),
    (4, "CONAF", "Corporación Nacional Forestal", "Ministerio de Agricultura"),
    (5, "DGA", "Dirección General de Aguas", "Ministerio de Obras Públicas"),
    (6, "DGAC", "Dirección General de Aeronáutica Civil", "Ministerio de Defensa Nacional"),
    (7, "DIRECCION GENERAL DE CONCESIONES", "Dirección General de Concesiones de Obras Públicas", "Ministerio de Obras Públicas"),
    (8, "DOH", "Dirección de Obras Hidráulicas", "Ministerio de Obras Públicas"),
    (9, "DOM", "Dirección de Obras Municipales", "Municipalidades"),
    (10, "MINVU", "Ministerio de Vivienda y Urbanismo", "Ministerio de Vivienda y Urbanismo"),
    (11, "MMA", "Ministerio del Medio Ambiente", "Ministerio de Medio Ambiente"),
    (12, "MTT", "Ministerio de Transportes y Telecomunicaciones", "Ministerio de Transportes y Telecomunicaciones"),
    (13, "SAG", "Servicio Agrícola y Ganadero", "Ministerio de Agricultura"),
    (14, "SEA", "Servicio de Evaluación Ambiental", "Ministerio de Medio Ambiente"),
    (15, "SEC", "Superintendencia de Electricidad y Combustibles", "Ministerio de Energía"),
    (16, "SEREMI SALUD", "Secretaría Regional Ministerial de Salud", "Ministerio de Salud"),
    (17, "SERNAGEOMIN", "Servicio Nacional de Geología y Minería", "Ministerio de Minería"),
    (18, "SSFFAA", "Subsecretaría para las Fuerzas Armadas", "Ministerio de Defensa Nacional"),
    (19, "VIALIDAD", "Dirección de Vialidad", "Ministerio de Obras Públicas"),
]

# --- REGIONES: (id, numero oficial, numeral, nombre, nombre oficial) -------
# id = orden norte -> sur (el orden en que se muestran). 90 y 91 no son
# regiones reales, pero la planilla las usa.
REGIONES = [
    (1, 15, "XV", "Arica y Parinacota", "Región de Arica y Parinacota"),
    (2, 1, "I", "Tarapacá", "Región de Tarapacá"),
    (3, 2, "II", "Antofagasta", "Región de Antofagasta"),
    (4, 3, "III", "Atacama", "Región de Atacama"),
    (5, 4, "IV", "Coquimbo", "Región de Coquimbo"),
    (6, 5, "V", "Valparaíso", "Región de Valparaíso"),
    (7, 13, "RM", "Metropolitana", "Región Metropolitana de Santiago"),
    (8, 6, "VI", "O'Higgins", "Región del Libertador General Bernardo O'Higgins"),
    (9, 7, "VII", "Maule", "Región del Maule"),
    (10, 16, "XVI", "Ñuble", "Región de Ñuble"),
    (11, 8, "VIII", "Biobío", "Región del Biobío"),
    (12, 9, "IX", "La Araucanía", "Región de La Araucanía"),
    (13, 14, "XIV", "Los Ríos", "Región de Los Ríos"),
    (14, 10, "X", "Los Lagos", "Región de Los Lagos"),
    (15, 11, "XI", "Aysén", "Región de Aysén del General Carlos Ibáñez del Campo"),
    (16, 12, "XII", "Magallanes", "Región de Magallanes y de la Antártica Chilena"),
    (90, None, None, "Interregional", "Proyecto que abarca más de una región"),
    (91, None, None, "Nivel Central", "Tramitación a nivel central, sin región asociada"),
]

# --- SECTORES: (id, nombre, orden en pantalla) -----------------------------
SECTORES = [
    (1, "Energía", 1),
    (2, "Minería", 2),
    (3, "Inmobiliario", 3),
    (4, "Infraestructura / Obras públicas", 4),
    (5, "Infraestructura de Transporte", 5),
    (6, "Infraestructura Hidráulica", 6),
    (7, "Saneamiento Ambiental", 7),
    (8, "Agropecuario", 8),
    (9, "Pesca y Acuicultura", 9),
    (10, "Instalaciones fabriles varias", 10),
    (11, "Otro", 99),
    (12, "Forestal", 12),
    (13, "Industria", 13),
]

# Cómo escribe la planilla algunos sectores -> nombre en el catálogo.
# cargar_excel.py lo usa para las columnas "sector" de Proyectos.
SECTOR_ALIAS = {
    "Infraestructura": "Infraestructura / Obras públicas",
    "Inmobiliarios": "Inmobiliario",
    "Otros": "Otro",
    "Energía / Infraestructura": "Energía",
}

# --- ETAPAS DEL PROYECTO: (id, codigo, nombre, orden) ----------------------
# `nombre` es exactamente lo que trae la columna "etapa_proyecto".
# `codigo` es lo que usa el código de la app (no cambiarlo).
ETAPAS_PROYECTO = [
    (1, "no_iniciado", "No se ha iniciado", 1),
    (2, "construccion", "En fase de construcción", 2),
    (3, "operacion", "En operación", 3),
]

# --- ESTADOS DEL PERMISO: (id, codigo, nombre, es_final, orden) -------------
# es_final = el trámite terminó (no cuenta como pendiente).
# Descartado = OASI lo saca del conteo. Desistido = el titular abandonó.
ESTADOS_PERMISO = [
    (1, "pendiente", "Pendiente", False, 1),
    (2, "resuelto", "Resuelto", True, 2),
    (3, "descartado", "Descartado", True, 3),
    (4, "desistido", "Desistido", True, 4),
]

# --- TIPOLOGÍAS: (sector, nombre) -------------------------------------------
# Subclasificación dentro de un sector, según la hoja "Sector-Tipología".
# Sin id fijo: se identifican por su nombre (que es único).
TIPOLOGIAS = [
    ("Energía", "Centrales generadoras de energía mayores a 3 MW"),
    ("Energía", "Líneas de transmisión eléctrica de alto voltaje"),
    ("Energía", "Subestaciones"),
    ("Energía", "Gasoductos"),
    ("Energía", "Almacenamiento"),
    ("Energía", "Biocombustible"),
    ("Energía", "Eólico"),
    ("Energía", "Fotovoltaico"),
    ("Energía", "Hidroeléctrica"),
    ("Energía", "Hidrógeno Verde"),
    ("Energía", "Líneas de transmisión y subestacionadoras eléctricas"),
    ("Minería", "Prospecciones y exploraciones"),
    ("Minería", "Proyectos de desarrollo minero sobre 5.000 ton/mes"),
    ("Minería", "Proyectos de disposición de residuos y estériles"),
    ("Minería", "Proyectos de desarrollo minero de petróleo y gas"),
    ("Minería", "Ductos mineros"),
    ("Minería", "Proyectos de extracción de áridos y greda"),
    ("Minería", "Minería Cobre"),
    ("Minería", "Minería Litio"),
    ("Minería", "Minería Oro"),
    ("Minería", "Minería Yodo"),
    ("Inmobiliario", "Inmobiliario subsidios"),
    ("Inmobiliario", "Turismo"),
    ("Inmobiliario", "Proyectos inmobiliarios"),
    ("Inmobiliario", "Proyecto de desarrollo turístico"),
    ("Infraestructura / Obras públicas", "Desaladora"),
    ("Infraestructura / Obras públicas", "Infraestructura ferroviaria"),
    ("Infraestructura / Obras públicas", "Infraestructura portuaria"),
    ("Infraestructura / Obras públicas", "Acueducto"),
    ("Infraestructura / Obras públicas", "Hospital"),
    ("Infraestructura / Obras públicas", "Vías férreas"),
    ("Infraestructura / Obras públicas", "Ruta o caminos públicos"),
    ("Infraestructura / Obras públicas", "Terminales de camiones"),
    ("Infraestructura / Obras públicas", "Aeropuertos"),
    ("Infraestructura / Obras públicas", "Autopistas"),
    ("Infraestructura / Obras públicas", "Presas y embalses"),
    ("Infraestructura / Obras públicas", "Data Center"),
    ("Infraestructura / Obras públicas", "Astilleros"),
    ("Infraestructura / Obras públicas", "Proyectos de desarrollo urbano"),
    ("Saneamiento Ambiental", "Sistemas de tratamiento y/o disposición de residuos industriales líquidos"),
    ("Saneamiento Ambiental", "Plantas de tratamiento de aguas de origen domiciliario que atiendan a una población igual o mayor a 2.500 habitantes"),
    ("Saneamiento Ambiental", "Sistemas de tratamiento, disposición y/o eliminación de residuos industriales sólidos"),
    ("Saneamiento Ambiental", "Reparación o recuperación de áreas que contengan contaminantes, que abarquen, una superficie igual o mayor a 10.000 m2"),
    ("Saneamiento Ambiental", "Plantas de tratamiento, disposición y/o eliminación de residuos peligrosos"),
    ("Saneamiento Ambiental", "Plantas de tratamiento y/o disposición de residuos sólidos de origen domiciliario, rellenos sanitarios y estaciones de transferencia y centros de acopio y clasificación que atiendan a una población igual o mayor a 5.000 habitantes"),
    ("Saneamiento Ambiental", "Sistemas de alcantarillado de aguas servidas, que atiendan a una población igual o mayor a 10.000 habitantes"),
    ("Saneamiento Ambiental", "Sistemas de agua potable que comprendan obras que capten y conduzcan agua desde el lugar de captación hasta su entrega en el inmueble del usuario"),
    ("Saneamiento Ambiental", "Emisarios submarinos"),
    ("Agropecuario", "Planteles y establos de crianza"),
    ("Agropecuario", "Agroindustria"),
    ("Pesca y Acuicultura", "Producción anual de engorda de peces 8 ton o cultivo de microalgas y/o juveniles de otros recursos hidrobiológicos que requieran el suministro y/o evacuación de aguas de origen continental, marina o estuarina, cualquiera sea su producción anual"),
    ("Pesca y Acuicultura", "Producción anual de moluscos filtradores u otras especies filtradoras a través de un sistema de producción extensivo"),
    ("Pesca y Acuicultura", "Producción anual igual o mayor a (35ton) tratándose de equinodermos, crustáceos y moluscos no filtradores, peces y otras especies, a través de un sistema de producción intensivo"),
    ("Pesca y Acuicultura", "Plantas Procesadoras de recursos hidrobiológicos"),
    ("Otro", "Producción, disposición o reutilización de sustancias inflamables, (sustancias señaladas en la Clase 2 División 2.1, 3 y 4 de la NCh. 382, Of. 2004)"),
    ("Otro", "Ingreso voluntario"),
    ("Otro", "Producción, disposición o reutilización de sustancias corrosivas o reactivas, (sustancias señaladas en las clases 5 de la NCh. 382, Of. 2004)"),
    ("Otro", "Ejecución de obras, programas o actividades en parques nacionales, reservas nacionales, monumentos naturales, reservas de zonas vírgenes, santuarios de la naturaleza, parques marinos, reservas marinas o en cualesquiera otra área colocada bajo protección oficial, en los casos en que la legislación respectiva lo permita"),
    ("Otro", "Transporte por medios terrestres de sustancias tóxicas, explosivas, inflamables, corrosivas o reactivas en una cantidad igual o superior a 400 ton/día"),
    ("Otro", "Producción, disposición o reutilización de sustancias tóxicas, (sustancias señaladas en la Clase 6 División 6.1 de la NCh. 382, Of. 2004)"),
    ("Otro", "Ejecución de obras o actividades que puedan significar una alteración física o química a los componentes bióticos, a sus interacciones o a los flujos ecosistémicos de humedales que se encuentran total o parcialmente dentro del límite urbano, y que impliquen su relleno, drenaje, secado, extracción de caudales o de áridos, la alteración de  la barra terminal, de  la vegetación azonal  hídrica  y ripariana,  la extracción de  la cubierta vegetal de turberas o el deterioro, menoscabo, transformación o invasión de la flora y la fauna contenida dentro del humedal, indistintamente de su superficie."),
    ("Otro", "Producción, disposición o reutilización de sustancias explosivas (sustancias señaladas en la Clase 1 División 1.1, dela NCh 382, Of.2004)"),
    ("Otro", "Ductos análogos"),
    ("Forestal", "Industrias de celulosas"),
    ("Forestal", "Aserraderos y plantas elaboradoras de madera"),
    ("Forestal", "Plantas astilladoras"),
    ("Industria", "Centro logístico"),
    ("Industria", "Comercio"),
    ("Industria", "Estación de servicio"),
    ("Industria", "Piscicultura"),
    ("Industria", "Planta industrial"),
]

# Cómo escribe la planilla algunas tipologías -> nombre en el catálogo.
TIPOLOGIA_ALIAS = {
    "Hospitales": "Hospital",
}


# ============================================================================
# GENERACIÓN DEL SQL
# ============================================================================

def _secuencia(tabla):
    # Las filas se insertan con id explícito: la secuencia tiene que quedar
    # después del mayor id, o el próximo INSERT sin id choca.
    return (
        f"SELECT setval(pg_get_serial_sequence('public.{tabla}', 'id'), "
        f"(SELECT GREATEST(max(id), 1) FROM public.{tabla}));"
    )


def generar_sql():
    s = ["-- Catálogos OASI (generado por db/seed_catalogos.py). Idempotente."]

    s.append("\n-- ministerios")
    for id_, nombre, sigla in MINISTERIOS:
        s.append(
            f"INSERT INTO ministerios (id, nombre, sigla) VALUES ({id_}, {lit(nombre)}, {lit(sigla)}) "
            f"ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, sigla = EXCLUDED.sigla;"
        )
    s.append(_secuencia("ministerios"))

    s.append("\n-- organismos (el ministerio se busca por nombre)")
    for id_, sigla, largo, ministerio in ORGANISMOS:
        s.append(
            f"INSERT INTO organismos (id, id_excel, nombre, nombre_largo, ministerio_id) "
            f"VALUES ({id_}, {lit(sigla)}, {lit(sigla)}, {lit(largo)}, "
            f"(SELECT id FROM ministerios WHERE nombre = {lit(ministerio)})) "
            f"ON CONFLICT (id) DO UPDATE SET id_excel = EXCLUDED.id_excel, nombre = EXCLUDED.nombre, "
            f"nombre_largo = EXCLUDED.nombre_largo, ministerio_id = EXCLUDED.ministerio_id;"
        )
    s.append(_secuencia("organismos"))

    s.append("\n-- regiones")
    for id_, numero, codigo, nombre, oficial in REGIONES:
        s.append(
            f"INSERT INTO regiones (id, numero, codigo, nombre, nombre_oficial) "
            f"VALUES ({id_}, {lit(numero)}, {lit(codigo)}, {lit(nombre)}, {lit(oficial)}) "
            f"ON CONFLICT (id) DO UPDATE SET numero = EXCLUDED.numero, codigo = EXCLUDED.codigo, "
            f"nombre = EXCLUDED.nombre, nombre_oficial = EXCLUDED.nombre_oficial;"
        )
    s.append(_secuencia("regiones"))

    s.append("\n-- sectores")
    for id_, nombre, orden in SECTORES:
        s.append(
            f"INSERT INTO sectores (id, nombre, orden) VALUES ({id_}, {lit(nombre)}, {orden}) "
            f"ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, orden = EXCLUDED.orden;"
        )
    s.append(_secuencia("sectores"))

    s.append("\n-- etapas_proyecto")
    for id_, codigo, nombre, orden in ETAPAS_PROYECTO:
        s.append(
            f"INSERT INTO etapas_proyecto (id, codigo, nombre, orden) VALUES ({id_}, {lit(codigo)}, {lit(nombre)}, {orden}) "
            f"ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre, orden = EXCLUDED.orden;"
        )
    s.append(_secuencia("etapas_proyecto"))

    s.append("\n-- estados_permiso")
    for id_, codigo, nombre, es_final, orden in ESTADOS_PERMISO:
        s.append(
            f"INSERT INTO estados_permiso (id, codigo, nombre, es_final, orden) "
            f"VALUES ({id_}, {lit(codigo)}, {lit(nombre)}, {lit(es_final)}, {orden}) "
            f"ON CONFLICT (id) DO UPDATE SET codigo = EXCLUDED.codigo, nombre = EXCLUDED.nombre, "
            f"es_final = EXCLUDED.es_final, orden = EXCLUDED.orden;"
        )
    s.append(_secuencia("estados_permiso"))

    s.append("\n-- tipologias (clave: el nombre; el sector se busca por nombre)")
    for sector, nombre in TIPOLOGIAS:
        s.append(
            f"INSERT INTO tipologias (sector_id, nombre) "
            f"VALUES ((SELECT id FROM sectores WHERE nombre = {lit(sector)}), {lit(nombre)}) "
            f"ON CONFLICT (nombre) DO UPDATE SET sector_id = EXCLUDED.sector_id;"
        )

    return "\n".join(s) + "\n"


def main():
    parser = argparse.ArgumentParser(description="Carga los catálogos fijos de OASI.")
    parser.add_argument("--solo-sql", metavar="ARCHIVO",
                        help="No toca la base: solo escribe el SQL en ARCHIVO (para aplicarlo en dev/prod).")
    args = parser.parse_args()

    sql = generar_sql()
    if args.solo_sql:
        with open(args.solo_sql, "w", encoding="utf-8") as f:
            f.write(sql)
        print(f"SQL de catálogos escrito en {args.solo_sql}")
        return

    aplicar_sql_local(sql)
    print(
        f"Catálogos aplicados en la base local: {len(MINISTERIOS)} ministerios, "
        f"{len(ORGANISMOS)} organismos, {len(REGIONES)} regiones, {len(SECTORES)} sectores, "
        f"{len(TIPOLOGIAS)} tipologías, {len(ETAPAS_PROYECTO)} etapas, {len(ESTADOS_PERMISO)} estados."
    )


if __name__ == "__main__":
    sys.exit(main())
