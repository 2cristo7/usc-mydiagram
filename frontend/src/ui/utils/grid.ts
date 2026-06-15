// Paso del grid de snapping del lienzo. Coincide con el `gap` del <Background>
// para que los puntos del fondo señalen exactamente las posiciones de anclaje.
export const GRID_SIZE = 20

// Redondea un punto en coordenadas de flujo a la celda de grid más cercana.
// Usado por los waypoints de las aristas, que flotan libres y deben caer en una
// intersección del grid (ambos ejes).
export function snapPoint(p: { x: number; y: number }, size = GRID_SIZE) {
  return {
    x: Math.round(p.x / size) * size,
    y: Math.round(p.y / size) * size,
  }
}

// Redondea un único valor al grid. Para extremos de arista anclados a un nodo:
// se snappea solo el eje en el que viaja la arista (la columna/fila del grid) y
// se conserva el otro, para que el extremo siga tocando el borde del nodo.
export function snapValue(v: number, size = GRID_SIZE) {
  return Math.round(v / size) * size
}
