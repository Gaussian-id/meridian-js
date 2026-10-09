import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ENGINE_ERROR_CODES } from '../src/internal/errors'

describe('error codes', () => {
  it('match the enum the engine publishes in its spec', () => {
    const spec = JSON.parse(readFileSync(new URL('../../../spec/meridian-public.json', import.meta.url), 'utf8'))
    const codes = spec.components?.schemas?.ErrorBody?.properties?.code?.enum as string[] | undefined

    expect(codes, 'the spec must publish ErrorBody.code as an enum').toBeDefined()
    expect([...codes!].sort()).toEqual([...ENGINE_ERROR_CODES].sort())
  })
})
