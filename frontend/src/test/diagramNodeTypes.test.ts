/**
 * Tests del util de mapeo diagram_type → node_types disponibles.
 * Verifica que cada tipo de diagrama devuelve exactamente los node_types
 * declarados en ALLOWED_NODE_TYPES del backend (agent/schemas.py).
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

  it('uml_class → solo "class"', () => {
    const types = getNodeTypesForDiagram('uml_class')
    expect(types.map((t) => t.type)).toEqual(['class'])
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

  it('state_machine → state, terminator', () => {
    const types = getNodeTypesForDiagram('state_machine').map((t) => t.type)
    expect(types).toContain('state')
    expect(types).toContain('terminator')
    expect(types).toHaveLength(2)
  })

  it('mindmap → solo "topic"', () => {
    const types = getNodeTypesForDiagram('mindmap')
    expect(types.map((t) => t.type)).toEqual(['topic'])
  })

  it('todos los tipos de diagrama tienen al menos un node_type', () => {
    const diagramTypes: DiagramType[] = [
      'erd', 'uml_class', 'sequence', 'flowchart', 'architecture', 'state_machine', 'mindmap',
    ]
    for (const dt of diagramTypes) {
      expect(getNodeTypesForDiagram(dt).length).toBeGreaterThan(0)
    }
  })

  it('DIAGRAM_NODE_TYPES cubre exactamente los 7 tipos de diagrama del enum', () => {
    const keys = Object.keys(DIAGRAM_NODE_TYPES) as DiagramType[]
    const expected: DiagramType[] = [
      'erd', 'uml_class', 'sequence', 'flowchart', 'architecture', 'state_machine', 'mindmap',
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
