import { describe, expect, it } from 'vitest'

import { isInside, isLoopbackUrl, paidKeysIn } from '../../../scripts/contract-guard.mjs'

describe('contract guard: paidKeysIn', () => {
  it('finds plain, exported, quoted, CRLF and differently cased assignments', () => {
    const text = ['GAUSSMERIDIAN_GEMINI_API_KEY=abc', 'export GAUSSMERIDIAN_OPENROUTER_API_KEY="def"', ''].join('\r\n')

    expect(paidKeysIn(text).sort()).toEqual(['GAUSSMERIDIAN_GEMINI_API_KEY', 'GAUSSMERIDIAN_OPENROUTER_API_KEY'])
    expect(paidKeysIn("  gaussmeridian_gemini_api_key = 'x'")).toEqual(['GAUSSMERIDIAN_GEMINI_API_KEY'])
    expect(paidKeysIn('export   GAUSSMERIDIAN_GEMINI_API_KEY=x # c')).toEqual(['GAUSSMERIDIAN_GEMINI_API_KEY'])
  })

  it('ignores comments and empty values', () => {
    const text = [
      '# GAUSSMERIDIAN_GEMINI_API_KEY=abc',
      '  # export GAUSSMERIDIAN_OPENROUTER_API_KEY=abc',
      'GAUSSMERIDIAN_GEMINI_API_KEY=',
      'GAUSSMERIDIAN_OPENROUTER_API_KEY=""',
      "export GAUSSMERIDIAN_GEMINI_API_KEY=''",
      'GAUSSMERIDIAN_OPENROUTER_API_KEY=   # none',
      'OTHER=1'
    ].join('\n')

    expect(paidKeysIn(text)).toEqual([])
  })
})

describe('contract guard: addresses and paths', () => {
  it('accepts only loopback URLs', () => {
    for (const ok of ['http://127.0.0.1:8180', 'http://localhost:1', 'http://[::1]:8180'])
      expect(isLoopbackUrl(ok)).toBe(true)
    for (const bad of ['https://api.example.com', 'http://127.0.0.1.evil.com', 'nonsense'])
      expect(isLoopbackUrl(bad)).toBe(false)
  })

  it('accepts files only inside the runtime folder', () => {
    expect(isInside('/a/b', '/a/b/meridian-engine.env')).toBe(true)
    expect(isInside('/a/b', '/a/c/meridian-engine.env')).toBe(false)
    expect(isInside('/a/b', '/a/b/../c/x.env')).toBe(false)
  })
})
