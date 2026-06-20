// Geometría del nodo de DECISIÓN del diagrama de flujo: un ROMBO con la diagonal
// mayor HORIZONTAL (más ancho que alto), con el texto dentro repartido en varias
// líneas y SIN rotar (legible en horizontal), centrado.
//
// Como el mayor rectángulo centrado inscrito en un rombo de diagonales W×H mide
// W/2 × H/2, el rombo debe ser ~2× el bloque de texto para que el texto quepa sin
// tocar los bordes. Esta función parte la etiqueta en líneas y calcula el tamaño
// del rombo; la usan TANTO el render (FlowNode) COMO el layout inicial
// (estimateNodeSize) para que la caja estimada y la renderizada coincidan.

const CHAR_W = 7.8            // ancho medio por carácter a 14px bold
const LINE_H = 20            // altura de línea del texto
const MAX_CHARS_PER_LINE = 15 // objetivo de longitud de línea antes de partir
const PAD = 22              // margen entre el bloque de texto y el rect inscrito

// Parte una etiqueta en líneas por palabras, intentando no pasar de `maxChars`
// por línea (una palabra más larga que el límite ocupa su propia línea).
export function wrapLabel(label: string, maxChars = MAX_CHARS_PER_LINE): string[] {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    if (!line) { line = w; continue }
    if ((line + ' ' + w).length <= maxChars) line += ' ' + w
    else { lines.push(line); line = w }
  }
  if (line) lines.push(line)
  return lines
}

// Tamaño del rombo de decisión y las líneas en que se reparte su etiqueta.
export function decisionNodeSize(label: string): { width: number; height: number; lines: string[] } {
  const lines = wrapLabel(label)
  const longest = Math.max(...lines.map((l) => l.length), 1)
  const textW = longest * CHAR_W
  const textH = lines.length * LINE_H
  // Rombo ≈ 2× el bloque de texto (rect inscrito = mitad de cada diagonal) + margen.
  let width = Math.max(200, Math.round(2 * (textW + PAD)))
  let height = Math.max(120, Math.round(2 * (textH + PAD)))
  // Garantiza la diagonal mayor horizontal: el ancho ≥ 1.4× el alto.
  width = Math.max(width, Math.round(height * 1.4))
  return { width, height, lines }
}
