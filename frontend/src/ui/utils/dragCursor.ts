// Bloqueo global del cursor durante un gesto de arrastre.
//
// Problema: mientras se arrastra (un nodo, un handle de arista, un segmento…),
// el navegador pinta el cursor del elemento que está FÍSICAMENTE bajo el puntero,
// no el del elemento que originó el gesto. Al pasar por encima del pane, otros
// nodos o aristas —cada uno con su `cursor: … !important`— el cursor parpadea
// entre `grabbing` y `default`/`pointer`/`*-resize`.
//
// Solución: al empezar el gesto fijamos una clase en <body> que fuerza un único
// cursor en TODO el documento (vía `cursor: var(--drag-cursor) !important`,
// definido en index.css), ganando a cualquier regla por elemento. Al soltar se
// limpia. Un contador protege contra begin/end desbalanceados o anidados.
let depth = 0

export function beginDragCursor(cursor = 'grabbing') {
  depth += 1
  document.body.style.setProperty('--drag-cursor', cursor)
  document.body.classList.add('is-dragging')
}

export function endDragCursor() {
  depth = Math.max(0, depth - 1)
  if (depth > 0) return
  document.body.classList.remove('is-dragging')
  document.body.style.removeProperty('--drag-cursor')
}
