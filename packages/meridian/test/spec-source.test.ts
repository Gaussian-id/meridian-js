import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ENGINE_API_VERSION, ENGINE_SPEC_COMMIT } from 'meridian'

const source = JSON.parse(readFileSync(new URL('../../../spec/SOURCE.json', import.meta.url), 'utf8')) as {
  engineCommit: string
  publicVersion: string
}

describe('pinned engine spec', () => {
  it('reports the engine commit and API version it was generated from', () => {
    expect(ENGINE_SPEC_COMMIT).toBe(source.engineCommit)
    expect(ENGINE_API_VERSION).toBe(source.publicVersion)
    expect(ENGINE_SPEC_COMMIT).toMatch(/^[0-9a-f]{7,40}$/)
  })
})
