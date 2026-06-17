-- S10.3c — Una API key guardada POR PROVEEDOR (antes: una sola por usuario).
--
-- Permite al usuario tener guardadas a la vez su key de OpenAI, Anthropic y
-- Gemini, y cambiar de proveedor sin reintroducirlas. La key sigue viviendo
-- cifrada en Vault; la referencia (secret_id) pasa de una columna en
-- user_llm_config a una fila por proveedor en user_llm_api_keys.

-- Migración idempotente: segura de reejecutar (si una pasada anterior falló a
-- mitad). Por eso los create usan IF NOT EXISTS y se hace drop previo de
-- trigger/policies/funciones antes de recrearlos.

-- 1. Tabla de keys por proveedor (1 fila por (usuario, proveedor)).
create table if not exists public.user_llm_api_keys (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  provider          text        not null
                                check (provider in ('openai','anthropic','gemini')),
  api_key_secret_id uuid        not null,   -- referencia lógica a vault.secrets.id
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, provider)
);

drop trigger if exists user_llm_api_keys_set_updated_at on public.user_llm_api_keys;
create trigger user_llm_api_keys_set_updated_at
  before update on public.user_llm_api_keys
  for each row execute function public.set_updated_at();

-- 2. RLS — mismo patrón que user_llm_config.
alter table public.user_llm_api_keys enable row level security;

drop policy if exists "select own llm keys" on public.user_llm_api_keys;
create policy "select own llm keys" on public.user_llm_api_keys
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own llm keys" on public.user_llm_api_keys;
create policy "insert own llm keys" on public.user_llm_api_keys
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own llm keys" on public.user_llm_api_keys;
create policy "update own llm keys" on public.user_llm_api_keys
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "delete own llm keys" on public.user_llm_api_keys;
create policy "delete own llm keys" on public.user_llm_api_keys
  for delete to authenticated using (auth.uid() = user_id);

-- 3+4. Migrar la key existente (single-key) a la nueva tabla y eliminar la
--      columna antigua. En un bloque condicionado a que la columna exista, para
--      que la reejecución (tras una pasada parcial que ya la borró) no falle al
--      referenciar una columna inexistente.
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'user_llm_config'
       and column_name = 'api_key_secret_id'
  ) then
    insert into public.user_llm_api_keys (user_id, provider, api_key_secret_id)
    select user_id, provider, api_key_secret_id
      from public.user_llm_config
     where api_key_secret_id is not null
       and provider in ('openai','anthropic','gemini')
    on conflict (user_id, provider) do nothing;

    alter table public.user_llm_config drop column api_key_secret_id;
  end if;
end $$;

-- 5. RPCs redefinidas para operar sobre user_llm_api_keys.

-- 5a. upsert_llm_config — guarda la config (sin key) y, si p_api_key viene, la
--     persiste en Vault para EL proveedor que se está guardando (p_provider).
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
  -- Upsert de la fila de configuración (provider/modelos/transporte).
  insert into public.user_llm_config (
    user_id, provider, transport, model_fast, model_capable, base_url
  ) values (
    auth.uid(), p_provider, p_transport, p_model_fast, p_model_capable, p_base_url
  )
  on conflict (user_id) do update set
    provider      = excluded.provider,
    transport     = excluded.transport,
    model_fast    = excluded.model_fast,
    model_capable = excluded.model_capable,
    base_url      = excluded.base_url;

  -- Gestionar la key SOLO si se proporciona una no vacía y el proveedor es comercial.
  if p_api_key is not null and p_api_key <> ''
     and p_provider in ('openai','anthropic','gemini') then
    select api_key_secret_id
      into v_existing_secret_id
      from public.user_llm_api_keys
     where user_id = auth.uid() and provider = p_provider;

    if v_existing_secret_id is not null then
      perform vault.update_secret(v_existing_secret_id, p_api_key);
    else
      v_new_secret_id := vault.create_secret(
        p_api_key,
        'llm_key_' || auth.uid()::text || '_' || p_provider
      );
      insert into public.user_llm_api_keys (user_id, provider, api_key_secret_id)
      values (auth.uid(), p_provider, v_new_secret_id);
    end if;
  end if;
end;
$$;

grant execute on function public.upsert_llm_config(text, text, text, text, text, text)
  to authenticated;

-- 5b. get_llm_config — config del usuario + array de proveedores con key guardada.
--     Reemplaza el booleano has_api_key por saved_providers (text[]). Cambia el
--     tipo de retorno, así que NO basta create or replace: hay que dropearla antes.
drop function if exists public.get_llm_config();
create or replace function public.get_llm_config()
returns table(
  provider    text,
  transport   text,
  model_fast  text,
  model_capable text,
  base_url    text,
  saved_providers text[]
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
      coalesce(
        (select array_agg(k.provider order by k.provider)
           from public.user_llm_api_keys k
          where k.user_id = auth.uid()),
        '{}'::text[]
      ) as saved_providers
    from public.user_llm_config c
   where c.user_id = auth.uid();
end;
$$;

grant execute on function public.get_llm_config() to authenticated;

-- 5c. get_llm_api_key(p_provider) — key descifrada del proveedor pedido; null si no hay.
create or replace function public.get_llm_api_key(p_provider text)
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
    from public.user_llm_api_keys
   where user_id = auth.uid() and provider = p_provider;

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

grant execute on function public.get_llm_api_key(text) to authenticated;

-- La firma antigua sin parámetros queda obsoleta: se elimina para evitar usos
-- accidentales que devolverían siempre null tras el cambio de esquema.
drop function if exists public.get_llm_api_key();

-- 5d. delete_llm_api_key(p_provider) — revoca la key de un proveedor concreto.
create or replace function public.delete_llm_api_key(p_provider text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select api_key_secret_id
    into v_secret_id
    from public.user_llm_api_keys
   where user_id = auth.uid() and provider = p_provider;

  if v_secret_id is null then
    return; -- idempotente
  end if;

  delete from public.user_llm_api_keys
   where user_id = auth.uid() and provider = p_provider;

  delete from vault.secrets where id = v_secret_id;
end;
$$;

grant execute on function public.delete_llm_api_key(text) to authenticated;

-- La firma antigua sin parámetros queda obsoleta.
drop function if exists public.delete_llm_api_key();

-- 5e. delete_all_llm_api_keys — borra TODAS las keys del usuario de Vault.
--     Usada al eliminar la cuenta (RGPD art. 17): Vault no está cubierto por el
--     `on delete cascade`, así que hay que vaciar los secretos explícitamente
--     antes de borrar al usuario. Idempotente (no falla si no había ninguna).
create or replace function public.delete_all_llm_api_keys()
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  delete from vault.secrets
   where id in (
     select api_key_secret_id
       from public.user_llm_api_keys
      where user_id = auth.uid()
   );

  delete from public.user_llm_api_keys where user_id = auth.uid();
end;
$$;

grant execute on function public.delete_all_llm_api_keys() to authenticated;
