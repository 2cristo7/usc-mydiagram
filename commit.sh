#!/usr/bin/env bash
#
# Runner de commits del proyecto MydIAgram.
#
# Lee la cola COMMITS.pending (junto a este script), ejecuta cada commit
# pendiente y BORRA del archivo los que ya se han confirmado → la cola se limpia
# sola en cada ejecución. Un commit se considera "ya hecho" (y se descarta sin
# re-confirmar) si su línea de asunto ya aparece en `git log` o si, tras stagear
# sus archivos, no hay nada nuevo que confirmar.
#
# Uso:   ./commit.sh
#
# Formato de cada bloque en COMMITS.pending:
#
#   --- commit ---
#   files: ruta/uno ruta/dos        (rutas separadas por espacios, SIN espacios en los nombres)
#   asunto del commit
#   cuerpo opcional, una o varias líneas
#   --- end ---
#
# REGLA INVIOLABLE: este runner NUNCA añade la línea
#   Co-Authored-By: Claude ...   ni  "Generated with Claude Code"
# y además las ELIMINA del mensaje si alguien las hubiera dejado en la cola.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
QUEUE="$ROOT/COMMITS.pending"

# Patrones prohibidos en el mensaje (se eliminan línea a línea, nunca se añaden).
FORBIDDEN_RE='Co-Authored-By|Generated with .*Claude|🤖'

if [[ ! -f "$QUEUE" ]]; then
  echo "No existe la cola $QUEUE — nada que confirmar."
  exit 0
fi

# ── Parseo: separa cabecera (comentarios iniciales) de los bloques ──────────────
# Bucle while-read (compatible con bash 3.2 de macOS; sin `mapfile`). El
# `|| [[ -n "$line" ]]` rescata la última línea si el archivo no acaba en \n.
header=""
declare -a blocks=()
current=""
in_block=0
seen_block=0

while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" == "--- commit ---" ]]; then
    in_block=1; seen_block=1; current="$line"$'\n'; continue
  fi
  if [[ $in_block -eq 1 ]]; then
    current+="$line"$'\n'
    if [[ "$line" == "--- end ---" ]]; then
      blocks+=("$current"); current=""; in_block=0
    fi
    continue
  fi
  [[ $seen_block -eq 0 ]] && header+="$line"$'\n'
done < "$QUEUE"

if [[ ${#blocks[@]} -eq 0 ]]; then
  echo "Cola vacía — no hay commits pendientes."
  exit 0
fi

# ── Procesa un bloque. Devuelve 0 si queda RESUELTO (commit hecho o ya existía),
#    1 si FALLA y debe permanecer en la cola. ─────────────────────────────────────
process_block() {
  local raw="$1"
  local files="" message="" state="start" l

  while IFS= read -r l; do
    case "$state" in
      start) [[ "$l" == "--- commit ---" ]] && state="files" ;;
      files)
        if [[ "$l" == files:* ]]; then
          files="${l#files:}"; files="${files# }"; state="msg"
        fi
        ;;
      msg)
        [[ "$l" == "--- end ---" ]] && break
        message+="$l"$'\n'
        ;;
    esac
  done <<< "$raw"

  if [[ -z "$files" ]]; then
    echo "✗ bloque sin línea 'files:' — se mantiene en la cola."
    return 1
  fi

  # Limpia el mensaje: elimina cualquier línea prohibida (salvaguarda). La
  # sustitución de comando ya recorta los saltos de línea finales sobrantes.
  message="$(printf '%s' "$message" | grep -viE "$FORBIDDEN_RE" || true)"

  local subject
  subject="$(printf '%s\n' "$message" | head -n1)"
  if [[ -z "$subject" ]]; then
    echo "✗ bloque sin asunto — se mantiene en la cola."
    return 1
  fi

  # Salvaguarda: nunca confirmar nada bajo memoria/ (no se commitea por norma).
  local f
  for f in $files; do
    if [[ "$f" == memoria/* || "$f" == */memoria/* ]]; then
      echo "✗ '$subject' toca memoria/ ($f) — prohibido. Se mantiene en la cola."
      return 1
    fi
  done

  # ¿Ya está hecho? Asunto idéntico ya presente en el historial.
  if git -C "$ROOT" log --pretty=%s | grep -Fxq "$subject"; then
    echo "↷ ya existe en git log: $subject"
    return 0
  fi

  # Stagea solo los archivos del bloque.
  if ! git -C "$ROOT" add -- $files 2>/tmp/commit_add_err; then
    echo "✗ '$subject': fallo al stagear ($(cat /tmp/commit_add_err)). Se mantiene."
    return 1
  fi

  # Si tras stagear no hay nada nuevo, el commit ya estaba hecho → resuelto.
  if git -C "$ROOT" diff --cached --quiet -- $files; then
    echo "↷ sin cambios que confirmar: $subject"
    return 0
  fi

  # Confirma leyendo el mensaje por stdin (preserva multilínea, sin trampas de
  # comillas). -F - NO añade nada al mensaje.
  if printf '%s\n' "$message" | git -C "$ROOT" commit -q -F - -- $files; then
    echo "✓ $subject"
    return 0
  else
    echo "✗ '$subject': fallo en git commit. Se mantiene."
    git -C "$ROOT" restore --staged -- $files 2>/dev/null || true
    return 1
  fi
}

# ── Ejecuta todos los bloques; conserva en la cola solo los que fallan ──────────
declare -a survivors=()
done_count=0
fail_count=0

for b in "${blocks[@]}"; do
  if process_block "$b"; then
    done_count=$((done_count + 1))
  else
    survivors+=("$b")
    fail_count=$((fail_count + 1))
  fi
done

# Reescribe la cola: cabecera + bloques supervivientes (autolimpieza). El guard
# de longitud evita el "unbound variable" de bash 3.2 al expandir un array vacío.
{
  printf '%s' "$header"
  if [[ ${#survivors[@]} -gt 0 ]]; then
    for s in "${survivors[@]}"; do
      printf '%s' "$s"
    done
  fi
} > "$QUEUE"

echo "─────────────────────────────────────────"
echo "Resueltos: $done_count · Pendientes (fallidos): $fail_count"
