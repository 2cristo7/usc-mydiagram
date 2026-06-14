-- S10.x — Persistencia de la conversación por diagrama.
-- messages: log append-only del chat (mensajes de usuario y del sistema) que
-- originó/refinó el diagrama. Se guarda y carga JUNTO con el diagrama reusando
-- el flujo de persistCurrentDiagram (POST→PATCH), no como tabla aparte: la
-- conversación no se consulta fila a fila, solo se restaura completa al abrir el
-- diagrama del historial.
--
-- jsonb, NOT NULL DEFAULT '[]': las filas existentes quedan con conversación
-- vacía (no había historial guardado antes de esta migración) en vez de NULL,
-- para que el frontend siempre reciba un array.
alter table public.diagrams
  add column messages jsonb not null default '[]'::jsonb;

-- CHECK de forma mínima (coherente con diagrams_data_shape): que sea un array.
alter table public.diagrams
  add constraint diagrams_messages_is_array check (
    jsonb_typeof(messages) = 'array'
  );
