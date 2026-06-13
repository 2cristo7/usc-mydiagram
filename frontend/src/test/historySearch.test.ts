import { describe, it, expect } from 'vitest'

const filterByTitle = (items: { title: string }[], query: string) =>
  query.trim() === ''
    ? items
    : items.filter(i => i.title.toLowerCase().includes(query.toLowerCase()))

const items = [
  { title: 'ERD Users' },
  { title: 'Flow Login' },
  { title: 'UML Classes' },
]

describe('filterByTitle', () => {
  it('empty query returns all items', () => {
    expect(filterByTitle(items, '')).toHaveLength(3)
  })

  it('case-insensitive match', () => {
    expect(filterByTitle(items, 'erd')).toEqual([{ title: 'ERD Users' }])
  })

  it('substring match', () => {
    expect(filterByTitle(items, 'Log')).toEqual([{ title: 'Flow Login' }])
  })

  it('no match returns empty', () => {
    expect(filterByTitle(items, 'xyz')).toEqual([])
  })

  it('whitespace-only query returns all', () => {
    expect(filterByTitle(items, '   ')).toHaveLength(3)
  })
})
