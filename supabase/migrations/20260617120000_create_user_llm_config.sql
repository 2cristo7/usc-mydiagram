-- S10.3 — Configuración LLM por usuario con RLS y Vault para la API key.
-- La key nunca se almacena en claro: vive en vault.secrets; la tabla guarda el secret_id.

-- 1. Extensión Vault (idempotente).
create extension if not exists supabase_vault with schema vault;

-- 2. Tabla user_llm_config (1 fila por usuario).
create table public.user_llm_config (
  user_id           uuid        primary key references auth.users(id) on delete cascade,
  provider          text        not null default 'ollama'
                                check (provider in ('openai','anthropic','gemini','ollama')),
  transport         text        not null default 'browser'
                                check (transport in ('api','direct','browser')),
  model_fast        text        not null default '',
  model_capable     text        not null default '',
  api_key_secret_id uuid,               -- referencia lógica a vault.secrets.id (sin FK física)
  base_url          text,               -- override para ollama-direct; nullable
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Trigger updated_at (reutiliza la función pública ya creada en la migración de diagrams).
-- Si por cualquier motivo la función no existiera (entorno limpio sin la migración previa),
-- create or replace garantiza idempotencia.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_llm_config_set_updated_at
  before update on public.user_llm_config
  for each row execute function public.set_updated_at();

-- 3. RLS — patrón idéntico a diagrams (select/insert/update; no delete).
alter table public.user_llm_config enable row level security;

create policy "select own llm config" on public.user_llm_config
  for select to authenticated using (auth.uid() = user_id);

create policy "insert own llm config" on public.user_llm_config
  for insert to authenticated with check (auth.uid() = user_id);

create policy "update own llm config" on public.user_llm_config
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4. RPC SECURITY DEFINER — operan siempre sobre auth.uid().
--    search_path fijado para acceder a vault sin ambigüedad.

-- 4a. upsert_llm_config
--     Gestión de Vault:
--       - p_api_key no null y no vacío → update_secret si ya hay id, create_secret si no.
--       - p_api_key null → deja la key existente intacta.
create or replace function public.upsert_llm_config(
  p_provider    text,
  p_transport   text,
  p_model_fast  text,
  p_model_capable text,
  p_base_url    text default null,
  p_api_key     text default null
) returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_existing_secret_id uuid;
  v_new_secret_id      uuid;
begin
  -- Obtener el secret_id actual del usuario (puede ser null si no tiene fila todavía).
  select api_key_secret_id
    into v_existing_secret_id
    from public.user_llm_config
   where user_id = auth.uid();

  -- Gestionar Vault solo si se proporciona una key no vacía.
  if p_api_key is not null and p_api_key <> '' then
    if v_existing_secret_id is not null then
      -- Actualizar el secreto existente en Vault.
      perform vault.update_secret(v_existing_secret_id, p_api_key);
      v_new_secret_id := v_existing_secret_id;
    else
      -- Crear un secreto nuevo en Vault; el nombre es único por usuario.
      v_new_secret_id := vault.create_secret(
        p_api_key,
        'llm_key_' || auth.uid()::text
      );
    end if;
  else
    -- null → conservar el secret_id que ya hubiera (o null si nunca tuvo key).
    v_new_secret_id := v_existing_secret_id;
  end if;

  -- Upsert de la fila de configuración.
  insert into public.user_llm_config (
    user_id,
    provider,
    transport,
    model_fast,
    model_capable,
    base_url,
    api_key_secret_id
  ) values (
    auth.uid(),
    p_provider,
    p_transport,
    p_model_fast,
    p_model_capable,
    p_base_url,
    v_new_secret_id
  )
  on conflict (user_id) do update set
    provider          = excluded.provider,
    transport         = excluded.transport,
    model_fast        = excluded.model_fast,
    model_capable     = excluded.model_capable,
    base_url          = excluded.base_url,
    api_key_secret_id = coalesce(v_new_secret_id, public.user_llm_config.api_key_secret_id);
end;
$$;

grant execute on function public.upsert_llm_config(text, text, text, text, text, text)
  to authenticated;

-- 4b. get_llm_config
--     Devuelve la fila del usuario sin exponer la key; has_api_key indica si tiene.
create or replace function public.get_llm_config()
returns table(
  provider    text,
  transport   text,
  model_fast  text,
  model_capable text,
  base_url    text,
  has_api_key boolean
)
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  return query
    select
      c.provider,
      c.transport,
      c.model_fast,
      c.model_capable,
      c.base_url,
      (c.api_key_secret_id is not null) as has_api_key
    from public.user_llm_config c
   where c.user_id = auth.uid();
end;
$$;

grant execute on function public.get_llm_config()
  to authenticated;

-- 4c. get_llm_api_key
--     Devuelve la key descifrada leyendo vault.decrypted_secrets; null si no hay.
--     Pensada para que el gateway la consuma con el JWT del usuario.
create or replace function public.get_llm_api_key()
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
  v_key       text;
begin
  select api_key_secret_id
    into v_secret_id
    from public.user_llm_config
   where user_id = auth.uid();

  if v_secret_id is null then
    return null;
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where id = v_secret_id;

  return v_key;
end;
$$;

grant execute on function public.get_llm_api_key()
  to authenticated;
