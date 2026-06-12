import { supabaseService } from './supabase'

// S9.3b — Caché EXACTA de generaciones (prompt → diagrama) sobre la tabla global
// generation_cache, accedida solo con service_role (ver supabase.ts). Evita
// re-pagar al LLM una generación ya vista. La versión semántica (embeddings) es
// Extra 1.
//
// Solo aplica a GENERACIÓN (no a refinamiento: ese depende del diagrama de
// entrada, no solo del prompt) y solo se cachea un éxito LIMPIO (≥1 nodo, no
// degradado): así un hit nunca sirve un diagrama parcial como si fuera bueno.

// Namespace por modelo: un diagrama de Qwen no se sirve a un usuario de GPT-4o.
// El backend lee el MISMO LLM_PROFILE que el agente (env espejo del deployment);
// si difieren, la clave no casaría y, en el peor caso, se regenera (nunca sirve
// el modelo equivocado de forma silenciosa más allá de lo que el env declare).
const MODEL = process.env.LLM_PROFILE ?? 'local'
const TTL_DAYS = Number(process.env.CACHE_TTL_DAYS ?? 30)

// Normalización para MAXIMIZAR aciertos (decisión P2): trim + minúsculas +
// colapsar espacios. "Crear un ERD de Blog" y "crear un erd de  blog" comparten
// entrada. El prompt original se guarda aparte (columna prompt) para depurar.
//
// S10.2 — El tipo preseleccionado entra en la CLAVE: el mismo prompt forzado a
// "flowchart" y dejado en automático son peticiones distintas y no deben
// compartir entrada (un hit cruzado serviría un diagrama del tipo equivocado).
// Se pliega como sufijo del prompt_key (no una columna nueva → sin migración) y
// el onConflict 'prompt_key,model' sigue valiendo. AUTO (undefined) → SIN sufijo:
// la clave queda IDÉNTICA a la histórica, así las entradas ya cacheadas en
// automático siguen acertando sin invalidarse.
export function normalizeKey(prompt: string, diagramType?: string): string {
  const base = prompt.trim().toLowerCase().replace(/\s+/g, ' ')
  return diagramType ? `${base}|type=${diagramType}` : base
}

export interface CachedDiagram {
  title: string | null
  diagram: unknown
}

/**
 * Busca una generación cacheada para `prompt` (con el modelo actual), ignorando
 * las entradas más viejas que el TTL. Devuelve null en miss o ante cualquier
 * error de BD (la caché es un acelerador, nunca debe tumbar la generación).
 */
export async function getCached(prompt: string, diagramType?: string): Promise<CachedDiagram | null> {
  const cutoff = new Date(Date.now() - TTL_DAYS * 86_400_000).toISOString()
  try {
    const { data, error } = await supabaseService()
      .from('generation_cache')
      .select('title, diagram')
      .eq('prompt_key', normalizeKey(prompt, diagramType))
      .eq('model', MODEL)
      .gte('created_at', cutoff)
      .maybeSingle()
    if (error || !data) return null
    return { title: data.title, diagram: data.diagram }
  } catch (err) {
    console.warn('[cache] lookup falló (se generará normal):', (err as Error).message)
    return null
  }
}

/**
 * Guarda (o refresca) una generación. upsert por (prompt_key, model): reescribir
 * renueva created_at → resetea el TTL. Best-effort: un fallo se loguea y no
 * propaga (no debe romper la respuesta ya servida al usuario).
 */
export async function setCached(prompt: string, title: string | null, diagram: unknown, diagramType?: string): Promise<void> {
  try {
    const { error } = await supabaseService()
      .from('generation_cache')
      .upsert(
        {
          prompt_key: normalizeKey(prompt, diagramType),
          prompt,
          model: MODEL,
          title,
          diagram,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'prompt_key,model' },
      )
    if (error) console.warn('[cache] no se pudo guardar:', error.message)
  } catch (err) {
    console.warn('[cache] error al guardar:', (err as Error).message)
  }
}
