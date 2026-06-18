import { describe, it, expect } from 'vitest'
import type { DiagramSchema } from '../types'
import { mindmapLayout } from '../ui/utils/mindmapLayout'

// Diagrama básico de mapa mental: 1 raíz, 4 ramas, 2 hojas por rama
function makeSimpleMindmap(): DiagramSchema {
  return {
    title: 'Test Mindmap',
    diagram_type: 'mindmap',
    nodes: [
      { id: 'root', label: 'Raíz', node_type: 'topic', attributes: [] },
      { id: 'b1', label: 'Rama 1', node_type: 'topic', attributes: [] },
      { id: 'b2', label: 'Rama 2', node_type: 'topic', attributes: [] },
      { id: 'b3', label: 'Rama 3', node_type: 'topic', attributes: [] },
      { id: 'b4', label: 'Rama 4', node_type: 'topic', attributes: [] },
      { id: 'l1', label: 'Hoja 1', node_type: 'topic', attributes: [] },
      { id: 'l2', label: 'Hoja 2', node_type: 'topic', attributes: [] },
    ],
    edges: [
      { id: 'e1', source: 'root', target: 'b1', label: '', edge_type: 'association' },
      { id: 'e2', source: 'root', target: 'b2', label: '', edge_type: 'association' },
      { id: 'e3', source: 'root', target: 'b3', label: '', edge_type: 'association' },
      { id: 'e4', source: 'root', target: 'b4', label: '', edge_type: 'association' },
      { id: 'e5', source: 'b1', target: 'l1', label: '', edge_type: 'association' },
      { id: 'e6', source: 'b1', target: 'l2', label: '', edge_type: 'association' },
    ],
  }
}

// Reconstruye el tamaño estimado del nodo igual que el layout, para comprobar AABBs.
function estSize(label: string, role: string): { w: number; h: number } {
  const charW = role === 'leaf' ? 6.4 : role === 'branch' ? 7.6 : 9
  const padX = role === 'leaf' ? 24 : role === 'branch' ? 34 : 48
  const h = role === 'leaf' ? 28 : role === 'branch' ? 40 : 48
  const minW = role === 'root' ? 120 : 60
  return { w: Math.max(minW, label.length * charW + padX), h }
}

describe('mindmapLayout — sin solapamientos (regresión visual)', () => {
  // Mapa denso con etiquetas largas y casi verticales (reproduce el caso reportado:
  // ramas con muchas hojas de texto largo que se pisaban arriba/abajo).
  function makeDenseMindmap(): DiagramSchema {
    const branches: Record<string, string[]> = {
      Metabolismo: ['Fosforilación Oxidativa', 'Cadena de Transporte de Electrones', 'Ciclo de Krebs', 'Glucólisis', 'Anabolismo', 'Catabolismo'],
      'Biología Molecular': ['Replicación del ADN', 'Transcripción', 'Traducción'],
      'Estructura y Señalización Celular': ['Membranas Biológicas', 'Transporte Transmembrana', 'Transducción de Señales'],
      Biomoléculas: ['Carbohidratos', 'Lípidos', 'Ácidos Nucleicos'],
      Enzimología: ['Regulación e Inhibición', 'Coenzimas', 'Cinética Enzimática', 'Estructura y Función'],
      Proteínas: ['Aminoácidos'],
    }
    const nodes: DiagramSchema['nodes'] = [{ id: 'root', label: 'Bioquímica General', node_type: 'topic', attributes: [] }]
    const edges: DiagramSchema['edges'] = []
    let i = 0
    for (const [branch, leaves] of Object.entries(branches)) {
      const bId = `b${i++}`
      nodes.push({ id: bId, label: branch, node_type: 'topic', attributes: [] })
      edges.push({ id: `e${bId}`, source: 'root', target: bId, label: '', edge_type: 'association' })
      leaves.forEach((leaf, j) => {
        const lId = `${bId}_l${j}`
        nodes.push({ id: lId, label: leaf, node_type: 'topic', attributes: [] })
        edges.push({ id: `e${lId}`, source: bId, target: lId, label: '', edge_type: 'association' })
      })
    }
    return { title: 'Denso', diagram_type: 'mindmap', nodes, edges }
  }

  it('ningún par de nodos solapa su caja delimitadora', () => {
    const { nodes } = mindmapLayout(makeDenseMindmap())
    const boxes = nodes.map((n) => {
      const { w, h } = estSize(n.data.label as string, n.data.role as string)
      return { id: n.id, cx: n.position.x, cy: n.position.y, w, h }
    })
    const overlaps: string[] = []
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a], B = boxes[b]
        const dx = Math.abs(A.cx - B.cx)
        const dy = Math.abs(A.cy - B.cy)
        // Margen pequeño: no exigimos el hueco completo, solo que las cajas no se crucen
        if (dx < (A.w + B.w) / 2 - 4 && dy < (A.h + B.h) / 2 - 4) {
          overlaps.push(`${A.id} ∩ ${B.id}`)
        }
      }
    }
    expect(overlaps).toEqual([])
  })

  it('ningún edge cruza por encima de un nodo no incidente', () => {
    const { nodes, edges } = mindmapLayout(makeDenseMindmap())
    const pos = new Map(nodes.map((n) => [n.id, n.position]))
    const box = new Map(
      nodes.map((n) => [n.id, estSize(n.data.label as string, n.data.role as string)]),
    )
    // ¿El bezier RADIAL del edge cruza la caja? Muestrea con los mismos puntos de
    // control que el render (manijas según el lado de salida de cada nodo).
    const off = (d: number, c = 0.25) => (d >= 0 ? 0.5 * d : c * 25 * Math.sqrt(-d))
    const ctrl = (side: string, x1: number, y1: number, x2: number, y2: number) =>
      side === 'left' ? { x: x1 - off(x1 - x2), y: y1 }
      : side === 'right' ? { x: x1 + off(x2 - x1), y: y1 }
      : side === 'top' ? { x: x1, y: y1 - off(y1 - y2) }
      : { x: x1, y: y1 + off(y2 - y1) }
    const sideOf = (fx: number, fy: number, fw: number, fh: number, tx: number, ty: number) =>
      Math.abs(tx - fx) / (fw / 2) > Math.abs(ty - fy) / (fh / 2)
        ? (tx - fx > 0 ? 'right' : 'left')
        : (ty - fy > 0 ? 'bottom' : 'top')
    const crosses = (
      p0: { x: number; y: number }, sa: { w: number; h: number },
      p1: { x: number; y: number }, sb: { w: number; h: number },
      c: { x: number; y: number }, w: number, h: number,
    ) => {
      const c1 = ctrl(sideOf(p0.x, p0.y, sa.w, sa.h, p1.x, p1.y), p0.x, p0.y, p1.x, p1.y)
      const c2 = ctrl(sideOf(p1.x, p1.y, sb.w, sb.h, p0.x, p0.y), p1.x, p1.y, p0.x, p0.y)
      const xmin = c.x - w / 2, xmax = c.x + w / 2, ymin = c.y - h / 2, ymax = c.y + h / 2
      for (let i = 1; i < 28; i++) {
        const t = i / 28, u = 1 - t
        const bx = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x
        const by = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y
        if (bx >= xmin && bx <= xmax && by >= ymin && by <= ymax) return true
      }
      return false
    }
    const offenders: string[] = []
    for (const e of edges) {
      const p0 = pos.get(e.source)!, p1 = pos.get(e.target)!
      const sa = box.get(e.source)!, sb = box.get(e.target)!
      for (const n of nodes) {
        if (n.id === e.source || n.id === e.target) continue
        const s = box.get(n.id)!
        // margen negativo de 2px: solo señalamos cruces reales, no roces de borde
        if (crosses(p0, sa, p1, sb, n.position, s.w - 4, s.h - 4)) offenders.push(`${e.id} ✕ ${n.id}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('mindmapLayout — raíz centrada', () => {
  it('la raíz se coloca en (0,0)', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const root = nodes.find((n) => n.id === 'root')!
    expect(root.position.x).toBeCloseTo(0)
    expect(root.position.y).toBeCloseTo(0)
  })
})

describe('mindmapLayout — roles y niveles', () => {
  it('la raíz tiene role=root y level=0', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const root = nodes.find((n) => n.id === 'root')!
    expect(root.data.role).toBe('root')
    expect(root.data.level).toBe(0)
  })

  it('el nodo con hijos (b1) tiene role=branch, los sin hijos tienen role=leaf, todos level=1', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    // b1 tiene hijos (l1, l2) → branch
    const b1 = nodes.find((n) => n.id === 'b1')!
    expect(b1.data.role).toBe('branch')
    expect(b1.data.level).toBe(1)
    // b2, b3, b4 no tienen hijos → leaf, pero nivel 1
    for (const id of ['b2', 'b3', 'b4']) {
      const node = nodes.find((n) => n.id === id)!
      expect(node.data.role).toBe('leaf')
      expect(node.data.level).toBe(1)
    }
  })

  it('las hojas tienen role=leaf y level=2', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    for (const id of ['l1', 'l2']) {
      const node = nodes.find((n) => n.id === id)!
      expect(node.data.role).toBe('leaf')
      expect(node.data.level).toBe(2)
    }
  })
})

describe('mindmapLayout — reparto angular', () => {
  it('las 4 ramas se reparten en ángulos distintos alrededor de la raíz', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const R1 = 180
    const branches = ['b1', 'b2', 'b3', 'b4'].map((id) => nodes.find((n) => n.id === id)!)

    // Cada rama está a ~radio R1 del origen
    branches.forEach((b) => {
      const dist = Math.sqrt(b.position.x ** 2 + b.position.y ** 2)
      expect(dist).toBeGreaterThan(R1 * 0.9)
      expect(dist).toBeLessThan(R1 * 1.1)
    })

    // Los ángulos son distintos entre sí
    const branchAngles = branches.map((b) => Math.atan2(b.position.y, b.position.x))
    const uniqueAngles = new Set(branchAngles.map((a) => Math.round(a * 100)))
    expect(uniqueAngles.size).toBe(4)
  })

  it('cuatro ramas con igual peso (sin hijos) se espacian ~90° entre sí', () => {
    // Diagrama balanceado: 4 ramas directas sin hijos → misma cuña (1 hoja c/u)
    const balanced: DiagramSchema = {
      title: 'Balanced',
      diagram_type: 'mindmap',
      nodes: [
        { id: 'root', label: 'Root', node_type: 'topic', attributes: [] },
        { id: 'b1', label: 'B1', node_type: 'topic', attributes: [] },
        { id: 'b2', label: 'B2', node_type: 'topic', attributes: [] },
        { id: 'b3', label: 'B3', node_type: 'topic', attributes: [] },
        { id: 'b4', label: 'B4', node_type: 'topic', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'b1', label: '', edge_type: 'association' },
        { id: 'e2', source: 'root', target: 'b2', label: '', edge_type: 'association' },
        { id: 'e3', source: 'root', target: 'b3', label: '', edge_type: 'association' },
        { id: 'e4', source: 'root', target: 'b4', label: '', edge_type: 'association' },
      ],
    }
    const { nodes } = mindmapLayout(balanced)
    const branches = ['b1', 'b2', 'b3', 'b4'].map((id) => nodes.find((n) => n.id === id)!)
    const angles = branches
      .map((b) => Math.atan2(b.position.y, b.position.x))
      .sort((a, b) => a - b)

    // Diferencias consecutivas deben ser ~π/2 (90°)
    for (let i = 1; i < angles.length; i++) {
      const diff = angles[i] - angles[i - 1]
      expect(diff).toBeCloseTo(Math.PI / 2, 1)
    }
  })
})

describe('mindmapLayout — herencia de branchColor', () => {
  it('todas las hojas de b1 tienen el mismo branchColor que b1', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const b1 = nodes.find((n) => n.id === 'b1')!
    const l1 = nodes.find((n) => n.id === 'l1')!
    const l2 = nodes.find((n) => n.id === 'l2')!
    expect(l1.data.branchColor).toBe(b1.data.branchColor)
    expect(l2.data.branchColor).toBe(b1.data.branchColor)
  })

  it('ramas distintas tienen colores distintos', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const colors = ['b1', 'b2', 'b3', 'b4'].map((id) => nodes.find((n) => n.id === id)!.data.branchColor)
    const uniqueColors = new Set(colors)
    expect(uniqueColors.size).toBe(4)
  })
})

describe('mindmapLayout — profundidad variable', () => {
  it('los hijos de ramas están a mayor radio que sus padres', () => {
    const { nodes } = mindmapLayout(makeSimpleMindmap())
    const l1 = nodes.find((n) => n.id === 'l1')!
    const b1 = nodes.find((n) => n.id === 'b1')!
    const distL1 = Math.sqrt(l1.position.x ** 2 + l1.position.y ** 2)
    const distB1 = Math.sqrt(b1.position.x ** 2 + b1.position.y ** 2)
    expect(distL1).toBeGreaterThan(distB1)
  })
})

describe('mindmapLayout — tipos de aristas', () => {
  it('todas las aristas usan el edge unificado (type default)', () => {
    const { edges } = mindmapLayout(makeSimpleMindmap())
    edges.forEach((e) => {
      expect(e.type).toBe('default')
    })
  })

  it('las ramas (association) llevan forma radial, color y grosor en data', () => {
    const { edges } = mindmapLayout(makeSimpleMindmap())
    edges.forEach((e) => {
      const data = e.data as Record<string, unknown>
      expect(data.shape).toBe('radial')
      expect(data.strokeColor).toBeTruthy()
      expect(typeof data.strokeWidth).toBe('number')
      expect(data.targetArrow).toBe(false)
    })
  })
})

describe('mindmapLayout — respeto de posición del usuario', () => {
  it('si la raíz tiene posición guardada se respeta', () => {
    const diagram = makeSimpleMindmap()
    diagram.nodes[0].position = { x: 100, y: 200 }
    const { nodes } = mindmapLayout(diagram)
    const root = nodes.find((n) => n.id === 'root')!
    expect(root.position.x).toBe(100)
    expect(root.position.y).toBe(200)
  })
})

describe('mindmapLayout — fallback a dagre', () => {
  it('cae a dagre cuando hay múltiples raíces inconexas', () => {
    const diagram: DiagramSchema = {
      title: 'Disconnected',
      diagram_type: 'mindmap',
      nodes: [
        { id: 'a', label: 'A', node_type: 'topic', attributes: [] },
        { id: 'b', label: 'B', node_type: 'topic', attributes: [] },
        { id: 'c', label: 'C', node_type: 'topic', attributes: [] },
      ],
      edges: [
        // a→b y a→c: a es raíz. Aquí NO hay ciclo, solo un árbol simple.
        // Para provocar múltiples raíces, usamos dos árboles desconectados:
        // a→b (componente 1) y c sin aristas (componente 2, también raíz)
        { id: 'e1', source: 'a', target: 'b', label: '', edge_type: 'association' },
      ],
      // c no tiene aristas: dos candidatos a raíz (a y c) → dagre
    }
    // Con 2 raíces inconexas devuelve dagre (no lanza)
    expect(() => mindmapLayout(diagram)).not.toThrow()
    const { nodes } = mindmapLayout(diagram)
    expect(nodes).toHaveLength(3)
  })

  it('cae a dagre cuando no hay nodos topic', () => {
    const diagram: DiagramSchema = {
      title: 'No topics',
      diagram_type: 'mindmap',
      nodes: [],
      edges: [],
    }
    expect(() => mindmapLayout(diagram)).not.toThrow()
    const { nodes } = mindmapLayout(diagram)
    expect(nodes).toHaveLength(0)
  })

  it('el fallback a dagre no falla con un grafo cíclico', () => {
    const diagram: DiagramSchema = {
      title: 'Cyclic',
      diagram_type: 'mindmap',
      nodes: [
        { id: 'a', label: 'A', node_type: 'topic', attributes: [] },
        { id: 'b', label: 'B', node_type: 'topic', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', label: '', edge_type: 'association' },
        { id: 'e2', source: 'b', target: 'a', label: '', edge_type: 'association' },
      ],
    }
    // a tiene arista entrante desde b → ambos tienen in-degree 1 → múltiples "raíces vacías" → fallback
    expect(() => mindmapLayout(diagram)).not.toThrow()
    const { nodes } = mindmapLayout(diagram)
    expect(nodes).toHaveLength(2)
  })
})

describe('mindmapLayout — robustez ante nodos sueltos (regresión de colores)', () => {
  // Un nodo "Nuevo Tema" suelto (sin aristas) crea una 2ª raíz candidata.
  // Antes esto degradaba TODO a dagre plano y se perdían branchColor/role/tipo de
  // arista (nodos azules iguales, aristas negras). Ahora debe elegir la raíz del
  // mayor subárbol y conservar los colores del árbol principal.
  function makeMindmapWithStrayNode(): DiagramSchema {
    const d = makeSimpleMindmap()
    d.nodes.push({ id: 'stray', label: 'Nuevo Tema', node_type: 'topic', attributes: [] })
    return d
  }

  it('elige el árbol grande como raíz pese al nodo suelto', () => {
    const { nodes } = mindmapLayout(makeMindmapWithStrayNode())
    const root = nodes.find((n) => n.id === 'root')!
    expect(root.data.role).toBe('root')
  })

  it('las ramas conservan branchColor (no se degrada a plano)', () => {
    const { nodes } = mindmapLayout(makeMindmapWithStrayNode())
    const b1 = nodes.find((n) => n.id === 'b1')!
    const b2 = nodes.find((n) => n.id === 'b2')!
    expect(b1.data.role).toBe('branch')
    expect(b1.data.branchColor).toBeTruthy()
    expect(b1.data.branchColor).not.toBe(b2.data.branchColor) // color por rama distinto
  })

  it('las aristas del árbol usan el edge unificado (type default)', () => {
    const { edges } = mindmapLayout(makeMindmapWithStrayNode())
    expect(edges.every((e) => e.type === 'default')).toBe(true)
  })

  it('el nodo suelto sale en estilo neutro (no como una rama real)', () => {
    const { nodes } = mindmapLayout(makeMindmapWithStrayNode())
    const stray = nodes.find((n) => n.id === 'stray')!
    expect(stray.data.branchColor).toBe('#9ca3af')
  })
})

describe('mindmapLayout — robustez al refinar (aristas invertidas y desconexión)', () => {
  // Al refinar, el LLM a veces emite una arista en sentido hijo→padre. El árbol no
  // dirigido debe reconectar ese subárbol en vez de dejarlo suelto.
  it('una arista invertida (hijo→padre) NO despega el subárbol', () => {
    const d: DiagramSchema = {
      title: 'T', diagram_type: 'mindmap',
      nodes: [
        { id: 'root', label: 'R', node_type: 'topic', attributes: [] },
        { id: 'a', label: 'A', node_type: 'topic', attributes: [] },
        { id: 'a1', label: 'A1', node_type: 'topic', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'a', label: '', edge_type: 'association' },
        { id: 'e2', source: 'a1', target: 'a', label: '', edge_type: 'association' }, // invertida
      ],
    }
    const { nodes } = mindmapLayout(d)
    const a = nodes.find((n) => n.id === 'a')!
    const a1 = nodes.find((n) => n.id === 'a1')!
    expect(a.data.role).toBe('branch')          // a mantiene su hijo
    expect(a1.data.role).toBe('leaf')
    expect(a1.data.branchColor).toBe(a.data.branchColor) // color de rama heredado, no gris suelto
    expect(a1.data.branchColor).not.toBe('#9ca3af')
  })

  // Un nodo/sub-árbol desconectado debe quedar DEBAJO del árbol, no sobre el centro.
  it('los nodos sueltos se colocan por debajo del árbol (no pisan el centro)', () => {
    const d: DiagramSchema = {
      title: 'T', diagram_type: 'mindmap',
      nodes: [
        { id: 'root', label: 'R', node_type: 'topic', attributes: [] },
        { id: 'a', label: 'A', node_type: 'topic', attributes: [] },
        { id: 'stray', label: 'Suelto', node_type: 'topic', attributes: [] },
      ],
      edges: [
        { id: 'e1', source: 'root', target: 'a', label: '', edge_type: 'association' },
      ],
    }
    const { nodes } = mindmapLayout(d)
    const a = nodes.find((n) => n.id === 'a')!
    const stray = nodes.find((n) => n.id === 'stray')!
    expect(stray.data.branchColor).toBe('#9ca3af')
    expect(stray.position.y).toBeGreaterThan(a.position.y) // por debajo del árbol
  })
})
