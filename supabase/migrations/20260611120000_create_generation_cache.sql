-- S9.3b — Caché de generaciones (prompt exacto → diagrama).
--
-- Tabla GLOBAL (sin user_id, decisión #6 de S9.1): un prompt repetido por
-- cualquier usuario evita re-pagar al LLM. La escribe SOLO el backend con
-- service_role (decisión C): RLS activada SIN políticas → ningún rol
-- anon/authenticated puede leerla ni escribirla; service_role hace bypass de RLS
-- y es el único que la toca. Así se evita el envenenamiento de una caché
-- compartida desde el cliente.
--
-- Clave de lookup = (prompt_key, model): prompt_key es el prompt normalizado
-- (trim + minúsculas + espacios colapsados) para maximizar aciertos; model es el
-- LLM_PROFILE con que se generó (un diagrama de Qwen no se sirve a un usuario de
-- GPT-4o). prompt guarda el original para depuración.
--
-- TTL: no hay caducidad en la BD; el backend filtra por created_at al leer
-- (CACHE_TTL_DAYS) e ignora/sobrescribe las entradas viejas. La versión semántica
-- (similitud por embedding) queda para Extra 1 (pgvector).

create table public.generation_cache (
  id         uuid primary key default gen_random_uuid(),
  prompt_key text not null,
  prompt     text not null,
  model      text not null,
  title      text,
  diagram    jsonb not null,
  created_at timestamptz not null default now(),
  unique (prompt_key, model)
);

-- RLS sin políticas: tabla de sistema, solo accesible vía service_role.
alter table public.generation_cache enable row level security;
