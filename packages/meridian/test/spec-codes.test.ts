import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ENGINE_ERROR_CODES } from '../src/internal/errors'

type Json = Record<string, unknown>

function enumsNamedCode(node: unknown, found: string[][] = []): string[][] {
  if (Array.isArray(node)) node.forEach(child => enumsNamedCode(child, found))
  else if (node && typeof node === 'object') {
    const properties = (node as Json).properties as Json | undefined
    const code = properties?.code as Json | undefined

    if (Array.isArray(code?.enum)) found.push(code.enum as string[])
    Object.values(node).forEach(child => enumsNamedCode(child, found))
  }

  return found
}

describe('error codes', () => {
  it('match the enum the engine publishes in its spec', () => {
    const spec = JSON.parse(readFileSync(new URL('../../../spec/meridian-public.json', import.meta.url), 'utf8'))
    const enums = enumsNamedCode(spec)

    expect(enums.length, 'E1 must publish the error envelope with an enum of codes').toBeGreaterThan(0)
    expect([...enums[0]!].sort()).toEqual([...ENGINE_ERROR_CODES].sort())
  })
})
