import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ENGINE_API_VERSION } from '@gaussian/meridian'

import config from '../../../vitest.config'

describe('workspace', () => {
  it('resolves the core package from its source', () => {
    expect(ENGINE_API_VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('lets no .env file reach the suite (envDir: false)', () => {
    expect(config.envDir).toBe(false)
  })

  it('uses no deprecated vitest entry point in the engine helper', () => {
    expect(readFileSync(new URL('./support/engine.ts', import.meta.url), 'utf8')).not.toContain("'vitest/suite'")
  })
})
