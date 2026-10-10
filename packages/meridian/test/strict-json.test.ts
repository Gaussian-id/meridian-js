import { describe, expect, it } from 'vitest'

import { NOT_JSON, strictJson } from '../src/internal/errors'

describe('strictJson', () => {
  it('parses an 8 MiB array of zeros in under 500 ms (a reviver made this about 100 times slower)', () => {
    const text = '[' + '0,'.repeat(4 * 1024 * 1024 - 1) + '0]'
    const started = performance.now()
    const value = strictJson(text) as number[]
    const elapsed = performance.now() - started

    expect(value.length).toBe(4 * 1024 * 1024)
    expect(elapsed).toBeLessThan(500)
  })

  it.each(['1e999', '-1e999', '[1e999]', '{"a":{"b":[0,{"c":-1e999}]}}'])('refuses %s', text => {
    expect(strictJson(text)).toBe(NOT_JSON)
  })

  it('walks a deep value without recursing', () => {
    const depth = 200_000

    expect(strictJson('['.repeat(depth) + '1e999' + ']'.repeat(depth))).toBe(NOT_JSON)
  })

  it('gives finite values and non-JSON as before', () => {
    expect(strictJson('{"a":[1,2.5,null,"x",true]}')).toEqual({ a: [1, 2.5, null, 'x', true] })
    expect(strictJson('nope')).toBe(NOT_JSON)
  })
})
