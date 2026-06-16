-- S10.3 — Borrado suave (papelera de diagramas).
-- deleted_at null = diagrama activo; con valor = en la papelera. El borrado deja
-- de ser físico (DELETE) por defecto: el historial mueve a papelera (UPDATE) y
-- solo el "borrar definitivamente" / "vaciar papelera" hacen el DELETE real.

alter table public.diagrams
  add column deleted_at timestamptz;

-- El historial activo filtra por deleted_at is null; un índice parcial cubre ese
-- caso (el común) sin que las filas en papelera lo engorden. Sustituye en la
-- práctica al uso de diagrams_user_updated_idx para esa consulta.
create index diagrams_user_active_idx
  on public.diagrams (user_id, updated_at desc)
  where deleted_at is null;

-- La papelera se ordena por fecha de borrado; índice parcial simétrico.
create index diagrams_user_trash_idx
  on public.diagrams (user_id, deleted_at desc)
  where deleted_at is not null;

-- Las políticas RLS de S9.1 ya cubren las operaciones nuevas: el soft-delete y el
-- restore son UPDATE (política "update own"), el borrado definitivo y vaciar son
-- DELETE (política "delete own"). No hace falta tocar RLS.
