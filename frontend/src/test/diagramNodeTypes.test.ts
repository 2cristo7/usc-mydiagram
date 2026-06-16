/**
 * Tests del util de mapeo diagram_type → node_types disponibles.
 * Verifica que cada tipo de diagrama devuelve exactamente los node_types
 * declarados en ALLOWED_NODE_TYPES del backend (agent/schemas.py).
 * Actualizado en S10.3: eliminados uml_class y state_machine; añadido use_case.
 */

import { describe, it, expect } from 'vitest'
import {
  getNodeTypesForDiagram,
  DIAGRAM_NODE_TYPES,
} from '../ui/utils/diagramNodeTypes'
import type { DiagramType } from '../types'

describe('getNodeTypesForDiagram', () => {
  it('devuelve [] si diagramType es null', () => {
    expect(getNodeTypesForDiagram(null)).toEqual([])
  })

  it('devuelve [] si diagramType es undefined', () => {
    expect(getNodeTypesForDiagram(undefined)).toEqual([])
  })

  it('erd → solo "table"', () => {
    const types = getNodeTypesForDiagram('erd')
    expect(types.map((t) => t.type)).toEqual(['table'])
  })

  it('sequence → solo "actor"', () => {
    const types = getNodeTypesForDiagram('sequence')
    expect(types.map((t) => t.type)).toEqual(['actor'])
  })

  it('flowchart → terminator, step, decision (en cualquier orden)', () => {
    const types = getNodeTypesForDiagram('flowchart').map((t) => t.type)
    expect(types).toContain('terminator')
    expect(types).toContain('step')
    expect(types).toContain('decision')
    expect(types).toHaveLength(3)
  })

  it('architecture → 8 tipos (service, database, queue, gateway, person, system, container, component)', () => {
    const types = getNodeTypesForDiagram('architecture').map((t) => t.type)
    const expected = ['service', 'database', 'queue', 'gateway', 'person', 'system', 'container', 'component']
    for (const t of expected) {
      expect(types).toContain(t)
    }
    expect(types).toHaveLength(expected.length)
  })

  it('mindmap → solo "topic"', () => {
    const types = getNodeTypesForDiagram('mindmap')
    expect(types.map((t) => t.type)).toEqual(['topic'])
  })

  it('use_case → actor, use_case, system', () => {
    const types = getNodeTypesForDiagram('use_case').map((t) => t.type)
    expect(types).toContain('actor')
    expect(types).toContain('use_case')
    expect(types).toContain('system')
    expect(types).toHaveLength(3)
  })

  it('todos los tipos de diagrama tienen al menos un node_type', () => {
    const diagramTypes: DiagramType[] = [
      'erd', 'sequence', 'flowchart', 'architecture', 'mindmap', 'use_case',
    ]
    for (const dt of diagramTypes) {
      expect(getNodeTypesForDiagram(dt).length).toBeGreaterThan(0)
    }
  })

  it('DIAGRAM_NODE_TYPES cubre exactamente los 6 tipos de diagrama del enum', () => {
    const keys = Object.keys(DIAGRAM_NODE_TYPES) as DiagramType[]
    const expected: DiagramType[] = [
      'erd', 'sequence', 'flowchart', 'architecture', 'mindmap', 'use_case',
    ]
    expect(keys.sort()).toEqual(expected.sort())
  })

  it('cada NodeTypeInfo tiene label y symbol no vacíos', () => {
    for (const [, infos] of Object.entries(DIAGRAM_NODE_TYPES)) {
      for (const info of infos) {
        expect(info.label.length).toBeGreaterThan(0)
        expect(info.symbol.length).toBeGreaterThan(0)
      }
    }
  })
})
