-- S9.1 — Tabla diagrams con RLS por usuario.
-- La columna embedding (pgvector) se difiere a Extra 1 (decisión cerrada S9).

create table public.diagrams (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  prompt     text,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un solo índice cubre el filtro RLS por user_id y el orden del historial (S9.3).
create index diagrams_user_updated_idx on public.diagrams (user_id, updated_at desc);

alter table public.diagrams enable row level security;

-- Políticas separadas por operación, restringidas al rol authenticated.
-- INSERT/UPDATE llevan WITH CHECK explícito (USING no ve la fila nueva en un INSERT).
create policy "select own diagrams" on public.diagrams
  for select to authenticated using (auth.uid() = user_id);
create policy "insert own diagrams" on public.diagrams
  for insert to authenticated with check (auth.uid() = user_id);
create policy "update own diagrams" on public.diagrams
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own diagrams" on public.diagrams
  for delete to authenticated using (auth.uid() = user_id);

-- updated_at garantizado en la capa de datos (misma filosofía que RLS).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger diagrams_set_updated_at
  before update on public.diagrams
  for each row execute function public.set_updated_at();
