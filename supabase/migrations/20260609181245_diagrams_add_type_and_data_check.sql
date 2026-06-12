-- S9.1 — Refinamiento del schema tras el debate del modelo.
-- diagram_type: columna propia para listar/filtrar el historial sin parsear el JSON
--   (duplicado deliberado: el tipo también vive dentro de data, igual que title).
--   Sin CHECK de enum a propósito: los tipos permitidos viven en el código (agente/frontend)
--   y la política es "fallar hacia permisivo" — un tipo nuevo no debe romper el guardado.
alter table public.diagrams
  add column diagram_type text not null;

-- CHECK de forma mínima sobre data (robustez, decisión #5): objeto con nodes[] y edges[].
-- Se usa el operador de existencia (?) para forzar presencia de la clave; jsonb_typeof
-- de una clave ausente daría NULL y el CHECK no rechazaría.
alter table public.diagrams
  add constraint diagrams_data_shape check (
    jsonb_typeof(data) = 'object'
    and (data ? 'nodes') and jsonb_typeof(data->'nodes') = 'array'
    and (data ? 'edges') and jsonb_typeof(data->'edges') = 'array'
  );
