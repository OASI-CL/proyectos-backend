-- Extensiones de Postgres.
--
-- Va PRIMERO y en una migración aparte porque los índices de trigramas de
-- 0001_tablas.sql no se pueden crear sin esta extensión.
--
-- pg_trgm: búsquedas por texto parcial (el buscador de proyectos y permisos
-- usa ILIKE '%algo%', que sin este índice recorre la tabla entera).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
