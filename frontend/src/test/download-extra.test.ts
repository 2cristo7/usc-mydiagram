import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest'
import {
  triggerDownload,
  triggerJsonDownload,
  triggerTextDownload,
  loadImage,
  getRenderedNodeBounds,
  getRenderedEdges,
  getRenderedEdgeBounds,
  getRenderedLabelBounds,
} from '../ui/utils/download'

// ── triggerDownload / triggerJsonDownload / triggerTextDownload ─────────────
// Se espía createElement('a') para capturar el <a> sintético: href + download +
// que se llamó click() (no llega a navegar en jsdom).

describe('triggerDownload', () => {
  let clickSpy: ReturnType<typeof vi.fn>
  let lastAnchor: HTMLAnchorElement | null

  beforeEach(() => {
    clickSpy = vi.fn()
    lastAnchor = null
    const realCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string, ...rest: unknown[]) => {
      const el = realCreate(tag as 'a', ...(rest as []))
      if (tag === 'a') {
        lastAnchor = el as HTMLAnchorElement
        ;(el as HTMLAnchorElement).click = clickSpy
      }
      return el
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('crea un <a download> con href y filename y le hace click', () => {
    triggerDownload('data:text/plain,hola', 'fichero.txt')
    expect(lastAnchor).not.toBeNull()
    expect(lastAnchor!.download).toBe('fichero.txt')
    expect(lastAnchor!.getAttribute('href')).toBe('data:text/plain,hola')
    expect(clickSpy).toHaveBeenCalledTimes(1)
  })

  test('triggerJsonDownload serializa indentado a data URL application/json', () => {
    triggerJsonDownload({ a: 1, b: 'x' }, 'd.json')
    expect(lastAnchor!.download).toBe('d.json')
    const href = lastAnchor!.getAttribute('href')!
    expect(href.startsWith('data:application/json;charset=utf-8,')).toBe(true)
    const decoded = decodeURIComponent(href.replace('data:application/json;charset=utf-8,', ''))
    expect(JSON.parse(decoded)).toEqual({ a: 1, b: 'x' })
    // Indentado con 2 espacios.
    expect(decoded).toContain('\n  ')
    expect(clickSpy).toHaveBeenCalled()
  })

  test('triggerTextDownload usa el MIME por defecto (text/plain)', () => {
    triggerTextDownload('contenido libre', 'd.txt')
    const href = lastAnchor!.getAttribute('href')!
    expect(href.startsWith('data:text/plain;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(href.split(',')[1])).toBe('contenido libre')
  })

  test('triggerTextDownload respeta un MIME personalizado', () => {
    triggerTextDownload('<mxfile/>', 'd.drawio', 'application/xml')
    const href = lastAnchor!.getAttribute('href')!
    expect(href.startsWith('data:application/xml;charset=utf-8,')).toBe(true)
  })
})

// ── loadImage ───────────────────────────────────────────────────────────────
// Se sustituye Image por una clase mock que dispara onload/onerror al fijar src.

describe('loadImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('resuelve con la imagen cuando carga (onload)', async () => {
    class MockImage {
      onload: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      private _src = ''
      set src(v: string) {
        this._src = v
        // Carga síncrona simulada en microtask.
        Promise.resolve().then(() => this.onload?.())
      }
      get src() {
        return this._src
      }
    }
    vi.stubGlobal('Image', MockImage)
    const img = await loadImage('data:image/png;base64,AAAA')
    expect(img).toBeInstanceOf(MockImage)
    expect((img as unknown as MockImage).src).toBe('data:image/png;base64,AAAA')
  })

  test('rechaza cuando la imagen falla (onerror)', async () => {
    class MockImage {
      onload: (() => void) | null = null
      onerror: ((e: unknown) => void) | null = null
      set src(_v: string) {
        Promise.resolve().then(() => this.onerror?.(new Error('fail')))
      }
    }
    vi.stubGlobal('Image', MockImage)
    await expect(loadImage('bad')).rejects.toBeTruthy()
  })
})

// ── getRenderedNodeBounds: ramas no cubiertas por download.test.ts ───────────
// (download.test.ts ya cubre el happy path; aquí se añade alguna rama defensiva
//  que conviene re-ejercitar para asegurar el módulo cargado en este fichero.)

describe('getRenderedNodeBounds (ramas)', () => {
  function makeNode(x: number, y: number, w: number, h: number, transform?: string): HTMLElement {
    const el = document.createElement('div')
    el.className = 'react-flow__node'
    el.style.transform = transform ?? `translate(${x}px, ${y}px)`
    Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true })
    Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true })
    return el
  }

  test('ignora nodos con transform no parseable y null si ninguno casa', () => {
    const vp = document.createElement('div')
    vp.appendChild(makeNode(0, 0, 10, 10, 'none'))
    expect(getRenderedNodeBounds(vp)).toBeNull()
  })

  test('forma de Firefox translate(240px) → y = 0', () => {
    const vp = document.createElement('div')
    vp.appendChild(makeNode(0, 0, 100, 40, 'translate(240px)'))
    expect(getRenderedNodeBounds(vp)).toEqual({ x: 240, y: 0, width: 100, height: 40 })
  })
})

// ── getRenderedEdges: filtrado por visibilidad y parseo de dash ──────────────

describe('getRenderedEdges (ramas)', () => {
  function appendEdge(vp: HTMLElement, d: string, opts: { stroke?: string; strokeWidth?: string; dash?: string } = {}): SVGPathElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'react-flow__edge')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement
    if (d) path.setAttribute('d', d)
    path.style.stroke = opts.stroke ?? '#b1b1b7'
    path.style.strokeWidth = opts.strokeWidth ?? '1'
    if (opts.dash) path.style.strokeDasharray = opts.dash
    g.appendChild(path)
    svg.appendChild(g)
    vp.appendChild(svg)
    return path
  }

  test('descarta rgba con alpha 0 (área de click) y conserva rgb opaco', () => {
    const vp = document.createElement('div')
    const transparent = appendEdge(vp, 'M 0 0 L 10 0')
    const opaque = appendEdge(vp, 'M 0 0 L 20 0')
    const orig = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const cs = orig(el, pseudo)
      if (el === transparent) return { ...cs, stroke: 'rgba(0, 0, 0, 0)', strokeWidth: '20', strokeDasharray: 'none' } as CSSStyleDeclaration
      if (el === opaque) return { ...cs, stroke: 'rgb(0, 0, 255)', strokeWidth: '2', strokeDasharray: 'none' } as CSSStyleDeclaration
      return cs
    })
    const edges = getRenderedEdges(vp)
    expect(edges).toHaveLength(1)
    expect(edges[0].stroke).toBe('rgb(0, 0, 255)')
    vi.restoreAllMocks()
  })

  test('rgb opaco no se descarta aunque el componente azul sea 0', () => {
    // Regresión del bug documentado: usar el último número como alpha rechazaría
    // rgb(255, 0, 0) por error. rgb(...) (3 componentes) es siempre opaco.
    const vp = document.createElement('div')
    appendEdge(vp, 'M 0 0 L 10 0', { stroke: '#ff0000' })
    const edges = getRenderedEdges(vp)
    expect(edges).toHaveLength(1)
    expect(edges[0].stroke).toBe('rgb(255, 0, 0)')
  })

  test('parsea dash separado por comas y descarta NaN', () => {
    const vp = document.createElement('div')
    appendEdge(vp, 'M 0 0 L 10 0', { stroke: '#000', dash: '4, 2' })
    expect(getRenderedEdges(vp)[0].dash).toEqual([4, 2])
  })

  test('strokeWidth no numérico cae a 1', () => {
    const vp = document.createElement('div')
    const path = appendEdge(vp, 'M 0 0 L 10 0')
    const orig = window.getComputedStyle
    vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
      const cs = orig(el, pseudo)
      if (el === path) return { ...cs, stroke: 'rgb(0,0,0)', strokeWidth: 'auto', strokeDasharray: 'none' } as CSSStyleDeclaration
      return cs
    })
    expect(getRenderedEdges(vp)[0].strokeWidth).toBe(1)
    vi.restoreAllMocks()
  })
})

// ── getRenderedEdgeBounds / getRenderedLabelBounds ──────────────────────────
// En jsdom getBBox/DOMMatrix no dan layout real: deben devolver null sin lanzar
// (rama catch / sin elementos). También se cubre la rama finita de edgeBounds
// con un getBBox stubbeado por instancia.

describe('getRenderedEdgeBounds', () => {
  test('null cuando no hay paths', () => {
    expect(getRenderedEdgeBounds(document.createElement('div'))).toBeNull()
  })

  test('null cuando getBBox lanza (jsdom)', () => {
    const vp = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'react-flow__edge')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement
    path.setAttribute('d', 'M 0 0 L 10 10')
    g.appendChild(path)
    svg.appendChild(g)
    vp.appendChild(svg)
    expect(getRenderedEdgeBounds(vp)).toBeNull()
  })

  test('rama finita: getBBox stubbeado devuelve los bounds del path', () => {
    const vp = document.createElement('div')
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    g.setAttribute('class', 'react-flow__edge')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement
    path.setAttribute('d', 'M 0 0 L 100 60')
    ;(path as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: -10, y: 5, width: 110, height: 55 }) as DOMRect
    // Un segundo path de bbox vacía (0x0) que debe ignorarse.
    const empty = document.createElementNS('http://www.w3.org/2000/svg', 'path') as SVGPathElement
    empty.setAttribute('d', 'M 0 0')
    ;(empty as unknown as { getBBox: () => DOMRect }).getBBox = () =>
      ({ x: 0, y: 0, width: 0, height: 0 }) as DOMRect
    g.append(path, empty)
    svg.appendChild(g)
    vp.appendChild(svg)
    expect(getRenderedEdgeBounds(vp)).toEqual({ x: -10, y: 5, width: 110, height: 55 })
  })
})

describe('getRenderedLabelBounds', () => {
  test('null cuando no hay etiquetas', () => {
    expect(getRenderedLabelBounds(document.createElement('div'))).toBeNull()
  })

  test('null en jsdom (transform none / DOMMatrix identidad → tamaño 0)', () => {
    const vp = document.createElement('div')
    const renderer = document.createElement('div')
    renderer.className = 'react-flow__edgelabel-renderer'
    const label = document.createElement('div')
    // offsetWidth/Height son 0 en jsdom → la rama de tamaño 0 los descarta.
    renderer.appendChild(label)
    vp.appendChild(renderer)
    expect(getRenderedLabelBounds(vp)).toBeNull()
  })
})
