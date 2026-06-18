-- S10.3 — Versionado de diagramas como diario lineal append-only.
--
-- Replanteamiento del "chat": no era una conversación, sino un sistema de jobs
-- (request → diagrama). Cada cambio del diagrama (operación del agente O edición
-- manual) se materializa como una fila inmutable en diagram_versions, ordenada por
-- `seq` por diagrama. El historial es un DIARIO CRONOLÓGICO: nada se borra ni se
-- trunca; viajar en el tiempo es mover un cursor de lectura, no mutar el log.
--
-- Dos vistas sobre el mismo diario:
--   · la LISTA de operaciones filtra origin != 'manual_edit' (solo hitos del agente);
--   · los botones ◀ ▶ recorren TODAS las versiones (manuales incluidas).
--
-- `diagrams.data` sigue siendo el HEAD (último estado); cada versión guarda su
-- snapshot completo (no diff) — simple y suficiente a esta escala. Subsume la
-- columna `messages` (eliminada abajo): el log se DERIVA de las versiones, no se
-- guarda en paralelo (antipatrón de estado duplicado, visión global §4).

create table public.diagram_versions (
  id          uuid primary key default gen_random_uuid(),
  -- on delete cascade: borrar el diagrama (o la cuenta, vía cascada de diagrams)
  -- arrastra todas sus versiones. No hay versiones huérfanas.
  diagram_id  uuid not null references public.diagrams(id) on delete cascade,
  -- Redundante con diagrams.user_id pero necesario para que la RLS imponga la
  -- propiedad sin un join (mismo patrón que el resto de tablas con RLS).
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Orden monótono por diagrama (1, 2, 3…). Lo asigna el gateway como max(seq)+1.
  seq         int not null,
  -- Snapshot completo del diagrama tras esta operación (title/diagram_type/nodes/edges).
  data        jsonb not null,
  -- Instrucción del usuario que originó la versión. NULL en manual_edit (no hay
  -- prompt: el usuario movió/renombró a mano).
  instruction text,
  -- generate/refine = hito del agente; manual_edit = edición a mano (no sale en la
  -- lista, solo navegable con ◀ ▶); restore = "volver a esta versión" (reaparece
  -- como hito porque trae de vuelta un estado anterior al tip).
  origin      text not null check (origin in ('generate', 'refine', 'manual_edit', 'restore')),
  -- Resumen del delta para el "recibo" de la tarjeta: {added, updated, deleted,
  -- addedEdges, deletedEdges}. NULL/{} para manual_edit (no se muestra en la lista).
  op_summary  jsonb,
  created_at  timestamptz not null default now(),
  -- Un seq por diagrama: evita duplicados si dos guardados concurrentes calculasen
  -- el mismo max+1 (el segundo INSERT falla y el gateway reintenta).
  unique (diagram_id, seq)
);

-- Cubre el filtro RLS por user_id y la lectura ordenada del diario por diagrama.
create index diagram_versions_diagram_seq_idx
  on public.diagram_versions (diagram_id, seq);

alter table public.diagram_versions enable row level security;

-- Espejo de las políticas de diagrams: cada usuario solo ve/inserta lo suyo. No
-- hay UPDATE ni DELETE de versiones por el usuario: el diario es inmutable (las
-- versiones se eliminan solo en cascada al borrar el diagrama o la cuenta).
create policy "select own diagram versions" on public.diagram_versions
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own diagram versions" on public.diagram_versions
  for insert to authenticated with check (auth.uid() = user_id);

-- Subsunción de `messages`: el log de conversación se deriva ahora de las
-- versiones (origin != manual_edit). Se elimina su CHECK y la columna.
alter table public.diagrams
  drop constraint if exists diagrams_messages_is_array;
alter table public.diagrams
  drop column if exists messages;
