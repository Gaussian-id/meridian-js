import { describe, expect, it } from 'vitest'

import { ENGINE_API_VERSION } from 'meridian'

describe('workspace', () => {
  it('resolves the core package from its source', () => {
    expect(ENGINE_API_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })
})
