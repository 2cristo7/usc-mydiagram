#!/usr/bin/env bash
# =============================================================================
# test_tools_e2e.sh — Smoke test E2E del workflow de tools (S7)
#
# Levanta los 3 servicios (o reutiliza los que ya corran), ejecuta la batería
# de escenarios del agente de refinamiento contra el stream NDJSON real, narra
# cada evento y valida la fontanería de S7.1-S7.5.
#
#   FAIL  → fontanería rota (contrato de eventos, HTTP, transmisión). Bug nuestro.
#   WARN  → el LLM no obedeció (no conectó el nodo, no preguntó…). Calidad del
#           modelo, no del código — esperable con qwen3:8b local.
#
# Uso:
#   ./scripts/test_tools_e2e.sh           # corre todo y apaga lo que arrancó
#   KEEP=1 ./scripts/test_tools_e2e.sh    # deja los servicios corriendo al final
#
# Requisitos: agent/.venv creado, npm install hecho en backend/ y frontend/,
# y el LLM del perfil de agent/.env disponible (Ollama arrancado si es local).
# =============================================================================
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AGENT_DIR="$ROOT/agent"
BACKEND_DIR="$ROOT/backend"
FRONTEND_DIR="$ROOT/frontend"
PY="$AGENT_DIR/.venv/bin/python"
LOG_DIR="$(mktemp -d /tmp/mydiagram_e2e.XXXXXX)"
KEEP="${KEEP:-0}"
CURL_TIMEOUT=300   # por escenario: el 8b local es lento

PASS=0; FAIL=0; WARN=0
STARTED_PIDS=()

c_green=$'\033[32m'; c_red=$'\033[31m'; c_yellow=$'\033[33m'; c_blue=$'\033[34m'; c_dim=$'\033[2m'; c_off=$'\033[0m'

ok()   { echo "  ${c_green}✓ PASS${c_off}  $1"; PASS=$((PASS+1)); }
bad()  { echo "  ${c_red}✗ FAIL${c_off}  $1"; FAIL=$((FAIL+1)); }
meh()  { echo "  ${c_yellow}⚠ WARN${c_off}  $1"; WARN=$((WARN+1)); }
title(){ echo; echo "${c_blue}━━━ $1 ━━━${c_off}"; }
info() { echo "  ${c_dim}$1${c_off}"; }

cleanup() {
  if [ "$KEEP" = "1" ]; then
    echo; info "KEEP=1: servicios siguen corriendo. Logs en $LOG_DIR"
    return
  fi
  for pid in "${STARTED_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null
  done
  info "Servicios arrancados por el script detenidos. Logs en $LOG_DIR"
}
trap cleanup EXIT

# -----------------------------------------------------------------------------
# Helpers Python embebidos (intérprete del stream + aserciones sobre NDJSON)
# -----------------------------------------------------------------------------
cat > "$LOG_DIR/interpret.py" <<'PYEOF'
import sys, json
raw = open(sys.argv[1], "w")
for line in sys.stdin:
    raw.write(line); raw.flush()
    line = line.strip()
    if not line:
        continue
    try:
        e = json.loads(line)
    except Exception:
        print(f"     ?  línea no-JSON: {line[:120]}"); continue
    t = e.get("_type")
    if t == "node":
        print(f"     📦 node_ready    {e['data']['id']} ({e['data']['node_type']})")
    elif t == "edge":
        d = e["data"]; print(f"     ─  edge_ready    {d['id']}: {d['source']} → {d['target']}")
    elif t == "tool_call":
        print(f"     🔧 tool_call     {e['tool']}({json.dumps(e.get('args', {}), ensure_ascii=False)[:100]})")
    elif t == "tool_result":
        r = json.dumps(e.get("result"), ensure_ascii=False)[:100]
        extra = f" +node {e['node']['id']}" if "node" in e else (f" +edge {e['edge']['id']}" if "edge" in e else "")
        res = e.get("result")
        is_err = (isinstance(res, dict) and res.get("error")) or (isinstance(res, str) and res.startswith("Error"))
        mark = "⚠️" if is_err else "✅"
        print(f"     {mark} tool_result   {e['tool']}: {r}{extra}")
    elif t == "clarification":
        print(f"     ⏸  clarification \"{e.get('question','')}\" opciones={e.get('options', [])}")
    elif t == "done":
        d = e.get("diagram") or {}
        print(f"     🏁 done          {len(d.get('nodes', []))} nodos, {len(d.get('edges', []))} aristas")
    elif t == "error":
        print(f"     ❌ error         [{e.get('category')}] {e.get('message')}")
    sys.stdout.flush()
PYEOF

cat > "$LOG_DIR/check.py" <<'PYEOF'
"""Aserciones sobre un fichero NDJSON de eventos. Exit: 0=pass, 1=fail, 2=warn."""
import sys, json

def load(path):
    evs = []
    for line in open(path):
        line = line.strip()
        if line:
            try: evs.append(json.loads(line))
            except Exception: pass
    return evs

def done_diagram(evs):
    for e in evs:
        if e.get("_type") == "done":
            return e.get("diagram") or {}
    return None

def main():
    cmd, path = sys.argv[1], sys.argv[2]
    args = sys.argv[3:]
    evs = load(path)
    if not evs:
        print("stream vacío (¿servicio caído?)"); sys.exit(1)
    last = evs[-1].get("_type")

    if cmd == "terminal_ok":
        # Contrato: el stream cierra con un único evento terminal en última posición.
        if last in ("done", "clarification", "error"):
            print(f"evento terminal: {last}"); sys.exit(0)
        print(f"el stream no cierra con evento terminal (último: {last})"); sys.exit(1)

    if cmd == "gen_ok":
        nodes = [e for e in evs if e.get("_type") == "node"]
        d = done_diagram(evs)
        if last != "done": print(f"generación no terminó en done (último: {last})"); sys.exit(1)
        if len(nodes) < 2: print(f"solo {len(nodes)} node_ready streameados"); sys.exit(1)
        if not d or not d.get("diagram_type"):
            print("el done NO incluye diagram.diagram_type (regresión S7-T5.6 → 422 al refinar)"); sys.exit(1)
        print(f"{len(nodes)} nodos streameados; done con snapshot type={d['diagram_type']}"); sys.exit(0)

    if cmd == "extract_diagram":
        d = done_diagram(evs)
        if d is None: sys.exit(1)
        print(json.dumps(d)); sys.exit(0)

    if cmd == "pairs_ok":
        # Contrato S7.5: cada tool_result se empareja con un tool_call ANTERIOR
        # por id, y los add/update llevan su delta (node/edge) si no son error.
        seen = set(); n_calls = 0
        for e in evs:
            if e.get("_type") == "tool_call":
                seen.add(e.get("id")); n_calls += 1
            elif e.get("_type") == "tool_result":
                if e.get("id") not in seen:
                    print(f"tool_result {e.get('tool')} sin tool_call previo (id {e.get('id')})"); sys.exit(1)
                r = e.get("result")
                is_err = isinstance(r, dict) and r.get("error")
                if not is_err and e.get("tool") in ("add_node", "update_node") and "node" not in e:
                    print(f"tool_result {e['tool']} ok sin delta 'node'"); sys.exit(1)
                if not is_err and e.get("tool") == "add_edge" and "edge" not in e:
                    print("tool_result add_edge ok sin delta 'edge'"); sys.exit(1)
        if n_calls == 0:
            print("el agente no invocó ninguna tool"); sys.exit(2)
        print(f"{n_calls} tool_calls, todos emparejados y con delta"); sys.exit(0)

    if cmd == "has_node":   # warn-level: obediencia del LLM
        d = done_diagram(evs) or {}
        ids = [n["id"] for n in d.get("nodes", [])]
        hits = [i for i in ids if args[0] in i]
        if hits: print(f"nodo presente: {hits[0]}"); sys.exit(0)
        print(f"no hay ningún nodo '*{args[0]}*' en el done ({ids})"); sys.exit(2)

    if cmd == "node_connected":  # warn-level
        d = done_diagram(evs) or {}
        target = args[0]
        ids = [n["id"] for n in d.get("nodes", []) if target in n["id"]]
        if not ids: print(f"nodo '{target}' no existe"); sys.exit(2)
        nid = ids[0]
        deg = sum(1 for e in d.get("edges", []) if e["source"] == nid or e["target"] == nid)
        if deg > 0: print(f"'{nid}' conectado ({deg} aristas)"); sys.exit(0)
        print(f"'{nid}' quedó DESCONECTADO (el LLM no creó sus aristas)"); sys.exit(2)

    if cmd == "node_deleted":
        d = done_diagram(evs) or {}
        target = args[0]
        present = [n["id"] for n in d.get("nodes", []) if target in n["id"]]
        deleted = any(e.get("_type") == "tool_result" and e.get("tool") == "delete_node"
                      and isinstance(e.get("result"), dict) and not e["result"].get("error")
                      for e in evs)
        if deleted and present:
            print(f"delete_node ejecutado pero '{present[0]}' sigue en el done (¡bug de workspace!)"); sys.exit(1)
        if not deleted:
            print(f"el LLM no llegó a invocar delete_node"); sys.exit(2)
        print(f"'{target}' eliminado y ausente del done"); sys.exit(0)

    if cmd == "cascade_declared":
        for e in evs:
            if e.get("_type") == "tool_result" and e.get("tool") == "delete_node":
                r = e.get("result") or {}
                if isinstance(r, dict) and "deleted_edges" in r:
                    print(f"cascade declarado: {r['deleted_edges']}"); sys.exit(0)
        print("ningún delete_node con deleted_edges en este run"); sys.exit(2)

    if cmd == "error_observed":
        # Tres desenlaces válidos ante un nodo inexistente: (a) la tool devolvió
        # error y el loop siguió, (b) el agente creó el nodo primero, (c) el
        # agente PREGUNTÓ antes de actuar (clarification) — manejo legítimo.
        for e in evs:
            if e.get("_type") == "tool_result" and isinstance(e.get("result"), dict) and e["result"].get("error"):
                print(f"observación de error recibida y el loop siguió ({e['tool']})"); sys.exit(0)
        if last == "clarification":
            print("el agente preguntó antes de actuar sobre el nodo inexistente (válido)"); sys.exit(0)
        d = done_diagram(evs) or {}
        if any("almacen" in n["id"] for n in d.get("nodes", [])):
            print("el LLM esquivó el error creando 'almacen' primero (válido)"); sys.exit(0)
        print("ni error, ni nodo creado, ni pregunta — el LLM ignoró la petición"); sys.exit(2)

    if cmd == "clar_payload":
        for e in evs:
            if e.get("_type") == "clarification":
                print(json.dumps({"thread_id": e["thread_id"], "question": e.get("question", "")})); sys.exit(0)
        sys.exit(2)

    if cmd == "tool_called":   # warn-level: ¿el LLM invocó esta tool sin error?
        target = args[0]
        for e in evs:
            if e.get("_type") == "tool_result" and e.get("tool") == target:
                r = e.get("result")
                if isinstance(r, dict) and r.get("error"):
                    print(f"{target} invocada pero devolvió error: {r['error'][:80]}"); sys.exit(2)
                print(f"{target} invocada y ejecutada"); sys.exit(0)
        print(f"el LLM no invocó {target}"); sys.exit(2)

    if cmd == "node_has_attr":  # warn-level: update_node aplicado de verdad
        d = done_diagram(evs) or {}
        slug, substr = args[0], args[1].lower()
        for n in d.get("nodes", []):
            if slug in n["id"]:
                if any(substr in a.lower() for a in n.get("attributes", [])):
                    print(f"'{n['id']}' tiene atributo con '{substr}'"); sys.exit(0)
                print(f"'{n['id']}' existe pero sin atributo '{substr}' ({n.get('attributes')})"); sys.exit(2)
        print(f"no existe nodo '*{slug}*'"); sys.exit(2)

    if cmd == "edge_deleted":
        # FONTANERÍA: un id que el resultado declara borrado NO puede seguir en
        # el done. OBEDIENCIA: que la arista borrada sea justo la pedida (match
        # EXACTO de extremos — substring casaría 'pedido' con 'pedido_producto').
        a, b = args[0], args[1]
        d = done_diagram(evs) or {}
        deleted_ids = [e["result"]["deleted_edge"] for e in evs
                       if e.get("_type") == "tool_result" and e.get("tool") == "delete_edge"
                       and isinstance(e.get("result"), dict) and e["result"].get("deleted_edge")]
        ghosts = [i for i in deleted_ids if any(x["id"] == i for x in d.get("edges", []))]
        if ghosts:
            print(f"arista(s) {ghosts} declaradas borradas pero siguen en el done (¡bug de workspace!)"); sys.exit(1)
        if not deleted_ids:
            print("el LLM no llegó a ejecutar delete_edge con éxito"); sys.exit(2)
        exists = any({e["source"], e["target"]} == {a, b} for e in d.get("edges", []))
        if exists:
            print(f"delete_edge borró {deleted_ids} pero la arista {a}-{b} pedida sigue (borró otra)"); sys.exit(2)
        print(f"arista {a}-{b} eliminada ({deleted_ids}) y ausente del done"); sys.exit(0)

    if cmd == "diagram_type_is":
        d = done_diagram(evs) or {}
        if d.get("diagram_type") == args[0]:
            print(f"diagram_type = {args[0]} (workspace REEMPLAZADO)"); sys.exit(0)
        print(f"diagram_type sigue siendo {d.get('diagram_type')} (el LLM no regeneró)"); sys.exit(2)

    print(f"comando desconocido: {cmd}"); sys.exit(1)

main()
PYEOF

cat > "$LOG_DIR/socket_test.cjs" <<'JSEOF'
// Cliente Socket.io que hace de frontend: envía un refine por el gateway y
// verifica que recibe agent:tool_call / agent:tool_result / diagram:done.
// El script vive en /tmp → require resuelve desde SU ruta, no desde el cwd;
// createRequire ancla la resolución al node_modules del frontend (argv[3]).
const fs = require('fs');
const { createRequire } = require('module');
const frontendRequire = createRequire(process.argv[3] + '/package.json');
const { io } = frontendRequire('socket.io-client');
const diagram = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const socket = io('http://localhost:3001', { transports: ['websocket'] });
const got = { tool_call: 0, tool_result: 0, done: false, diagram: false };
const timeout = setTimeout(() => {
  console.log(JSON.stringify({ ...got, timeout: true }));
  process.exit(1);
}, 280000);
socket.on('connect', () => {
  socket.emit('message:refine', { prompt: 'Añade un nodo Factura conectado a Pedido', diagram });
});
socket.on('agent:tool_call', (d) => { got.tool_call++; console.error(`     🔧 [socket] tool_call ${d.tool}`); });
socket.on('agent:tool_result', (d) => { got.tool_result++; console.error(`     ✅ [socket] tool_result ${d.tool}`); });
socket.on('diagram:done', (d) => {
  got.done = true; got.diagram = !!d.diagram;
  clearTimeout(timeout);
  console.log(JSON.stringify(got));
  process.exit(got.tool_call > 0 && got.tool_result > 0 && got.diagram ? 0 : 1);
});
socket.on('diagram:error', (d) => {
  clearTimeout(timeout);
  console.log(JSON.stringify({ ...got, error: d.error }));
  process.exit(1);
});
JSEOF

# -----------------------------------------------------------------------------
# Arranque / reutilización de servicios
# -----------------------------------------------------------------------------
wait_http() { # url, segundos
  local i=0
  until curl -sf -o /dev/null --max-time 2 "$1"; do
    i=$((i+1)); [ "$i" -ge "$2" ] && return 1
    sleep 1
  done
}

start_services() {
  title "Servicios"

  if curl -sf -o /dev/null --max-time 2 http://localhost:8000/health; then
    meh "agente ya corriendo en :8000 — lo reutilizo (OJO: su AGENT_RATE_LIMIT puede cortar la batería)"
  else
    (cd "$AGENT_DIR" && AGENT_RATE_LIMIT=1000 .venv/bin/uvicorn main:app --port 8000 >"$LOG_DIR/agent.log" 2>&1) &
    STARTED_PIDS+=($!)
    wait_http http://localhost:8000/health 30 || { bad "el agente no levanta (ver $LOG_DIR/agent.log)"; exit 1; }
    ok "agente levantado en :8000 (AGENT_RATE_LIMIT=1000)"
  fi

  if curl -sf -o /dev/null --max-time 2 http://localhost:3001/health; then
    info "gateway ya corriendo en :3001 — lo reutilizo"
  else
    (cd "$BACKEND_DIR" && npm run dev >"$LOG_DIR/backend.log" 2>&1) &
    STARTED_PIDS+=($!)
    wait_http http://localhost:3001/health 30 || { bad "el gateway no levanta (ver $LOG_DIR/backend.log)"; exit 1; }
    ok "gateway levantado en :3001"
  fi

  if curl -sf -o /dev/null --max-time 2 http://localhost:5173; then
    info "frontend ya corriendo en :5173 — lo reutilizo"
  else
    (cd "$FRONTEND_DIR" && npm run dev >"$LOG_DIR/frontend.log" 2>&1) &
    STARTED_PIDS+=($!)
    wait_http http://localhost:5173 30 || { bad "el frontend no levanta (ver $LOG_DIR/frontend.log)"; exit 1; }
    ok "frontend levantado en :5173"
  fi

  # Perfil LLM visible en el informe
  local profile
  profile=$(grep -E '^LLM_PROFILE=' "$AGENT_DIR/.env" 2>/dev/null | cut -d= -f2)
  info "LLM_PROFILE=${profile:-local}"
  if [ "${profile:-local}" = "local" ] && ! curl -sf -o /dev/null --max-time 2 http://localhost:11434/api/version; then
    bad "perfil local pero Ollama no responde en :11434"; exit 1
  fi
}

# -----------------------------------------------------------------------------
# Runner de escenarios
# -----------------------------------------------------------------------------
check() { # nivel-info: nombre, comando check.py, fichero, args...
  local name="$1"; shift
  local out rc
  out=$("$PY" "$LOG_DIR/check.py" "$@" 2>&1); rc=$?
  case $rc in
    0) ok  "$name — $out" ;;
    2) meh "$name — $out" ;;
    *) bad "$name — $out" ;;
  esac
  return $rc
}

refine() { # prompt, fichero_salida  (usa $LOG_DIR/current.json como diagrama)
  "$PY" - "$LOG_DIR/current.json" "$1" <<'PYEOF' > "$LOG_DIR/refine_body.json"
import sys, json
diagram = json.load(open(sys.argv[1]))
print(json.dumps({"prompt": sys.argv[2], "diagram": diagram}))
PYEOF
  curl -sN --max-time $CURL_TIMEOUT -X POST http://localhost:8000/refine/stream \
       -H 'Content-Type: application/json' -d @"$LOG_DIR/refine_body.json" \
    | "$PY" -u "$LOG_DIR/interpret.py" "$2"
}

update_current() { # si el run terminó en done, su snapshot pasa a ser el diagrama actual
  if "$PY" "$LOG_DIR/check.py" extract_diagram "$1" > "$LOG_DIR/current.json.tmp" 2>/dev/null; then
    mv "$LOG_DIR/current.json.tmp" "$LOG_DIR/current.json"
  fi
}

# =============================================================================
echo "${c_blue}MydIAgram — smoke test E2E del workflow de tools (S7)${c_off}"
info "logs y artefactos: $LOG_DIR"
[ -x "$PY" ] || { echo "no existe $PY (crea el venv del agente)"; exit 1; }

start_services

# --- Escenario 1: generación (prepara el lienzo) -----------------------------
title "1 · Generación ERD base"
curl -sN --max-time $CURL_TIMEOUT -X POST http://localhost:8000/generate/stream \
     -H 'Content-Type: application/json' \
     -d '{"prompt": "Diagrama ERD de una tienda online con Usuario, Producto y Pedido. Usuario hace Pedidos, los Pedidos contienen Productos"}' \
  | "$PY" -u "$LOG_DIR/interpret.py" "$LOG_DIR/01_gen.ndjson"
check "generación streamea y el done lleva snapshot con tipo" gen_ok "$LOG_DIR/01_gen.ndjson" || exit 1
update_current "$LOG_DIR/01_gen.ndjson"

# --- Escenario 2: add_node + add_edge ----------------------------------------
title "2 · Refine: «Añade Carrito entre Usuario y Pedido»"
refine "Añade Carrito entre Usuario y Pedido" "$LOG_DIR/02_add.ndjson"
check "contrato de eventos (terminal único al final)" terminal_ok "$LOG_DIR/02_add.ndjson"
check "tool_calls emparejados con sus results + deltas" pairs_ok "$LOG_DIR/02_add.ndjson"
check "[LLM] el nodo carrito existe" has_node "$LOG_DIR/02_add.ndjson" carrito
check "[LLM] carrito quedó conectado" node_connected "$LOG_DIR/02_add.ndjson" carrito
update_current "$LOG_DIR/02_add.ndjson"

# --- Escenario 3: observación de error → autocorrección ----------------------
title "3 · Refine: «Conecta Producto con Almacén» (Almacén no existe)"
refine "Conecta Producto con Almacén" "$LOG_DIR/03_err.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/03_err.ndjson"
check "tool_calls emparejados" pairs_ok "$LOG_DIR/03_err.ndjson"
check "[LLM] error observado o esquivado creando el nodo" error_observed "$LOG_DIR/03_err.ndjson"
update_current "$LOG_DIR/03_err.ndjson"

# --- Escenario 4: delete_node con cascade ------------------------------------
title "4 · Refine: «Elimina Carrito del diagrama»"
refine "Elimina Carrito del diagrama" "$LOG_DIR/04_del.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/04_del.ndjson"
check "carrito borrado del workspace (done lo confirma)" node_deleted "$LOG_DIR/04_del.ndjson" carrito
check "cascade declarado por el servidor (deleted_edges)" cascade_declared "$LOG_DIR/04_del.ndjson"
update_current "$LOG_DIR/04_del.ndjson"

# --- Escenario 5: update_node -------------------------------------------------
title "5 · Refine: «Añade el atributo telefono a la tabla Usuario» (update_node)"
refine "Añade el atributo telefono: VARCHAR a la tabla Usuario" "$LOG_DIR/05_upd.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/05_upd.ndjson"
check "tool_calls emparejados + deltas" pairs_ok "$LOG_DIR/05_upd.ndjson"
check "[LLM] update_node invocada" tool_called "$LOG_DIR/05_upd.ndjson" update_node
check "[LLM] usuario tiene el atributo telefono" node_has_attr "$LOG_DIR/05_upd.ndjson" usuario telefono
update_current "$LOG_DIR/05_upd.ndjson"

# --- Escenario 6: delete_edge ---------------------------------------------------
title "6 · Refine: «Elimina la relación entre Pedido y Producto» (delete_edge)"
refine "Elimina la relación entre Pedido y Producto" "$LOG_DIR/06_deledge.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/06_deledge.ndjson"
check "arista pedido-producto borrada del workspace" edge_deleted "$LOG_DIR/06_deledge.ndjson" pedido producto
update_current "$LOG_DIR/06_deledge.ndjson"

# --- Escenario 7: apply_layout --------------------------------------------------
title "7 · Refine: «Reorganiza el layout del diagrama» (apply_layout)"
refine "Reorganiza el layout del diagrama" "$LOG_DIR/07_layout.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/07_layout.ndjson"
check "[LLM] apply_layout invocada" tool_called "$LOG_DIR/07_layout.ndjson" apply_layout
update_current "$LOG_DIR/07_layout.ndjson"

# --- Escenario 8: clarificación + resume -------------------------------------
title "8 · Refine: clarificación forzada + /refine/resume"
refine "Añade un nodo Descuento, pero antes de conectarlo pregúntame con ask_clarification a qué nodo debe ir" "$LOG_DIR/08_clar.ndjson"
if payload=$("$PY" "$LOG_DIR/check.py" clar_payload "$LOG_DIR/08_clar.ndjson" 2>/dev/null); then
  ok "el agente pausó con clarification"
  thread_id=$(echo "$payload" | "$PY" -c 'import sys,json;print(json.load(sys.stdin)["thread_id"])')
  info "reanudando thread $thread_id con la respuesta «Usuario»…"
  curl -sN --max-time $CURL_TIMEOUT -X POST http://localhost:8000/refine/resume \
       -H 'Content-Type: application/json' \
       -d "{\"thread_id\": \"$thread_id\", \"answer\": \"Usuario\"}" \
    | "$PY" -u "$LOG_DIR/interpret.py" "$LOG_DIR/08_resume.ndjson"
  check "la reanudación cierra el run (contrato de eventos)" terminal_ok "$LOG_DIR/08_resume.ndjson"
  check "[LLM] descuento existe tras reanudar" has_node "$LOG_DIR/08_resume.ndjson" descuento
  update_current "$LOG_DIR/08_resume.ndjson"
else
  meh "[LLM] el modelo no invocó ask_clarification — escenario de resume no ejercitado"
  check "aun así el run cerró con evento terminal" terminal_ok "$LOG_DIR/08_clar.ndjson"
  update_current "$LOG_DIR/08_clar.ndjson"
fi

# --- Escenario 9: transmisión Socket.io por el gateway ------------------------
title "9 · Gateway: transmisión Socket.io (agent:tool_call / tool_result / done)"
if node "$LOG_DIR/socket_test.cjs" "$LOG_DIR/current.json" "$FRONTEND_DIR" > "$LOG_DIR/09_socket.json"; then
  ok "el gateway retransmite tool_call/tool_result/done por Socket.io — $(cat "$LOG_DIR/09_socket.json")"
else
  bad "transmisión Socket.io incompleta — $(cat "$LOG_DIR/09_socket.json" 2>/dev/null)"
fi

# --- Escenario 10: regenerate_from_scratch (último: destruye el diagrama) ------
title "10 · Refine: «Conviértelo en un diagrama de secuencia» (regenerate_from_scratch)"
refine "Conviértelo en un diagrama de secuencia del proceso de compra" "$LOG_DIR/10_regen.ndjson"
check "contrato de eventos" terminal_ok "$LOG_DIR/10_regen.ndjson"
check "[LLM] regenerate_from_scratch invocada" tool_called "$LOG_DIR/10_regen.ndjson" regenerate_from_scratch
check "[LLM] el workspace fue reemplazado por una secuencia" diagram_type_is "$LOG_DIR/10_regen.ndjson" sequence

# =============================================================================
title "Resumen"
echo "  ${c_green}PASS: $PASS${c_off} · ${c_yellow}WARN: $WARN${c_off} · ${c_red}FAIL: $FAIL${c_off}"
echo "  Artefactos NDJSON por escenario en: $LOG_DIR"
if [ "$FAIL" -gt 0 ]; then
  echo "  ${c_red}Hay fallos de FONTANERÍA — revisar.${c_off}"; exit 1
fi
if [ "$WARN" -gt 0 ]; then
  echo "  ${c_yellow}Solo warnings de obediencia del LLM (esperable en local). Fontanería OK.${c_off}"
fi
exit 0
