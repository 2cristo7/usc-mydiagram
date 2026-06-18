-- S10.3 — El diario de versiones pasa de lista a ÁRBOL.
--
-- `parent_version_id` es la versión de la que se derivó esta (el estado sobre el
-- que se aplicó la operación). NULL = raíz (primera generación). Navegar a una
-- versión anterior y crear una nueva la cuelga de AHÍ → rama nueva; lo que queda
-- fuera del camino vivo son "ramas muertas" (no se borran: el diario nunca pierde
-- progreso, solo se reordena la lista).
--
-- Migración separada (no edición de 20260617150000) porque esa ya se aplicó: las
-- migraciones son inmutables una vez corridas.
--
-- on delete set null: borrar una versión suelta no es un flujo real (las versiones
-- solo desaparecen en cascada al borrar el diagrama), pero si ocurriera no deja
-- hijos apuntando a un id inexistente.
alter table public.diagram_versions
  add column parent_version_id uuid references public.diagram_versions(id) on delete set null;
