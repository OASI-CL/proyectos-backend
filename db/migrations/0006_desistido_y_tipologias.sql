-- Datos nuevos que trae la planilla "Levantamiento de Permisos" del
-- 22-09-2026: un estado de permiso más, dos sectores más y el catálogo de
-- tipologías (subclasificación dentro de cada sector).
--
-- 'Desistido' vs 'Descartado' (aclarado por OASI, no son lo mismo):
--   Descartado  -> OASI lo excluye del conteo (no corresponde seguirlo)
--   Desistido   -> el TITULAR abandonó el trámite del permiso
-- Los dos son estados finales (dejan de contar como pendientes), pero se
-- guardan separados porque el motivo del cierre es distinto y así puede
-- reportarse aparte.

INSERT INTO estados_permiso (id, codigo, nombre, es_final, orden) VALUES
  (4, 'desistido', 'Desistido', true, 4)
ON CONFLICT (id) DO NOTHING;

SELECT setval('estados_permiso_id_seq', (SELECT max(id) FROM estados_permiso));

-- Dos sectores nuevos de la hoja "Sector-Tipología". Ningún proyecto los usa
-- todavía (0/326), pero la hoja ya los define como parte de la taxonomía.
INSERT INTO sectores (id, nombre, orden) VALUES
  (12, 'Forestal', 12),
  (13, 'Industria', 13)
ON CONFLICT (id) DO NOTHING;

SELECT setval('sectores_id_seq', (SELECT max(id) FROM sectores));

-- Las 71 tipologías, cada una resuelta a su sector por nombre (no por id, para
-- no depender del orden en que se insertaron arriba). Nombres de sector
-- pasados por el mismo alias que unifica los duplicados del Excel
-- ('Infraestructura' -> 'Infraestructura / Obras públicas', etc. — ver
-- SECTOR_ALIAS en db/seed.py), porque la hoja de referencia "Sector-Tipología"
-- usa los nombres crudos del Excel, no los del catálogo ya unificado.
INSERT INTO tipologias (sector_id, nombre) VALUES
  ((SELECT id FROM sectores WHERE nombre = 'Agropecuario'), 'Planteles y establos de crianza'),
  ((SELECT id FROM sectores WHERE nombre = 'Agropecuario'), 'Agroindustria'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Centrales generadoras de energía mayores a 3 MW'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Líneas de transmisión eléctrica de alto voltaje'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Subestaciones'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Gasoductos'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Almacenamiento'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Biocombustible'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Eólico'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Fotovoltaico'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Hidroeléctrica'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Hidrógeno Verde'),
  ((SELECT id FROM sectores WHERE nombre = 'Energía'), 'Líneas de transmisión y subestacionadoras eléctricas'),
  ((SELECT id FROM sectores WHERE nombre = 'Forestal'), 'Industrias de celulosas'),
  ((SELECT id FROM sectores WHERE nombre = 'Forestal'), 'Aserraderos y plantas elaboradoras de madera'),
  ((SELECT id FROM sectores WHERE nombre = 'Forestal'), 'Plantas astilladoras'),
  ((SELECT id FROM sectores WHERE nombre = 'Industria'), 'Centro logístico'),
  ((SELECT id FROM sectores WHERE nombre = 'Industria'), 'Comercio'),
  ((SELECT id FROM sectores WHERE nombre = 'Industria'), 'Estación de servicio'),
  ((SELECT id FROM sectores WHERE nombre = 'Industria'), 'Piscicultura'),
  ((SELECT id FROM sectores WHERE nombre = 'Industria'), 'Planta industrial'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Desaladora'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Infraestructura ferroviaria'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Infraestructura portuaria'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Acueducto'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Hospital'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Vías férreas'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Ruta o caminos públicos'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Terminales de camiones'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Aeropuertos'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Autopistas'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Presas y embalses'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Data Center'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Astilleros'),
  ((SELECT id FROM sectores WHERE nombre = 'Infraestructura / Obras públicas'), 'Proyectos de desarrollo urbano'),
  ((SELECT id FROM sectores WHERE nombre = 'Inmobiliario'), 'Inmobiliario subsidios'),
  ((SELECT id FROM sectores WHERE nombre = 'Inmobiliario'), 'Turismo'),
  ((SELECT id FROM sectores WHERE nombre = 'Inmobiliario'), 'Proyectos inmobiliarios'),
  ((SELECT id FROM sectores WHERE nombre = 'Inmobiliario'), 'Proyecto de desarrollo turístico'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Prospecciones y exploraciones'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Proyectos de desarrollo minero sobre 5.000 ton/mes'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Proyectos de disposición de residuos y estériles'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Proyectos de desarrollo minero de petróleo y gas'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Ductos mineros'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Proyectos de extracción de áridos y greda'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Minería Cobre'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Minería Litio'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Minería Oro'),
  ((SELECT id FROM sectores WHERE nombre = 'Minería'), 'Minería Yodo'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Producción, disposición o reutilización de sustancias inflamables, (sustancias señaladas en la Clase 2 División 2.1, 3 y 4 de la NCh. 382, Of. 2004)'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Ingreso voluntario'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Producción, disposición o reutilización de sustancias corrosivas o reactivas, (sustancias señaladas en las clases 5 de la NCh. 382, Of. 2004)'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Ejecución de obras, programas o actividades en parques nacionales, reservas nacionales, monumentos naturales, reservas de zonas vírgenes, santuarios de la naturaleza, parques marinos, reservas marinas o en cualesquiera otra área colocada bajo protección oficial, en los casos en que la legislación respectiva lo permita'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Transporte por medios terrestres de sustancias tóxicas, explosivas, inflamables, corrosivas o reactivas en una cantidad igual o superior a 400 ton/día'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Producción, disposición o reutilización de sustancias tóxicas, (sustancias señaladas en la Clase 6 División 6.1 de la NCh. 382, Of. 2004)'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Ejecución de obras o actividades que puedan significar una alteración física o química a los componentes bióticos, a sus interacciones o a los flujos ecosistémicos de humedales que se encuentran total o parcialmente dentro del límite urbano, y que impliquen su relleno, drenaje, secado, extracción de caudales o de áridos, la alteración de  la barra terminal, de  la vegetación azonal  hídrica  y ripariana,  la extracción de  la cubierta vegetal de turberas o el deterioro, menoscabo, transformación o invasión de la flora y la fauna contenida dentro del humedal, indistintamente de su superficie.'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Producción, disposición o reutilización de sustancias explosivas (sustancias señaladas en la Clase 1 División 1.1, dela NCh 382, Of.2004)'),
  ((SELECT id FROM sectores WHERE nombre = 'Otro'), 'Ductos análogos'),
  ((SELECT id FROM sectores WHERE nombre = 'Pesca y Acuicultura'), 'Producción anual de engorda de peces 8 ton o cultivo de microalgas y/o juveniles de otros recursos hidrobiológicos que requieran el suministro y/o evacuación de aguas de origen continental, marina o estuarina, cualquiera sea su producción anual'),
  ((SELECT id FROM sectores WHERE nombre = 'Pesca y Acuicultura'), 'Producción anual de moluscos filtradores u otras especies filtradoras a través de un sistema de producción extensivo'),
  ((SELECT id FROM sectores WHERE nombre = 'Pesca y Acuicultura'), 'Producción anual igual o mayor a (35ton) tratándose de equinodermos, crustáceos y moluscos no filtradores, peces y otras especies, a través de un sistema de producción intensivo'),
  ((SELECT id FROM sectores WHERE nombre = 'Pesca y Acuicultura'), 'Plantas Procesadoras de recursos hidrobiológicos'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Sistemas de tratamiento y/o disposición de residuos industriales líquidos'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Plantas de tratamiento de aguas de origen domiciliario que atiendan a una población igual o mayor a 2.500 habitantes'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Sistemas de tratamiento, disposición y/o eliminación de residuos industriales sólidos'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Reparación o recuperación de áreas que contengan contaminantes, que abarquen, una superficie igual o mayor a 10.000 m2'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Plantas de tratamiento, disposición y/o eliminación de residuos peligrosos'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Plantas de tratamiento y/o disposición de residuos sólidos de origen domiciliario, rellenos sanitarios y estaciones de transferencia y centros de acopio y clasificación que atiendan a una población igual o mayor a 5.000 habitantes'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Sistemas de alcantarillado de aguas servidas, que atiendan a una población igual o mayor a 10.000 habitantes'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Sistemas de agua potable que comprendan obras que capten y conduzcan agua desde el lugar de captación hasta su entrega en el inmueble del usuario'),
  ((SELECT id FROM sectores WHERE nombre = 'Saneamiento Ambiental'), 'Emisarios submarinos')
ON CONFLICT (nombre) DO NOTHING;
