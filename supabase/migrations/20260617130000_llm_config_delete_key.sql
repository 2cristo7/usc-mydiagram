-- S10.3b — Borrado explícito de la API key persistida.
-- Complementa la migración de user_llm_config: permite al usuario revocar el
-- guardado permanente de su key. Elimina el secreto de Vault y deja la fila de
-- config intacta (provider/modelos/transporte siguen valiendo; solo desaparece
-- la credencial). Es la contrapartida del consentimiento explícito del frontend.

create or replace function public.delete_llm_api_key()
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
    from public.user_llm_config
   where user_id = auth.uid();

  if v_secret_id is null then
    return; -- no hay nada que borrar (idempotente)
  end if;

  -- Desreferenciar primero la fila (evita dejar un secret_id colgando si el
  -- delete del secreto fallara) y luego eliminar el secreto de Vault.
  update public.user_llm_config
     set api_key_secret_id = null
   where user_id = auth.uid();

  delete from vault.secrets where id = v_secret_id;
end;
$$;

grant execute on function public.delete_llm_api_key() to authenticated;
