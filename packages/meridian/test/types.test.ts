import { describe, expectTypeOf, it } from 'vitest'

import type { ChatCompletion, ChatParams, Model } from 'meridian'

import type { components } from '../src/generated/public'
import type { EngineErrorCode } from '../src/internal/errors'

describe('public types come from the engine spec', () => {
  it('describes the chat request and reply', () => {
    expectTypeOf<ChatParams['messages']>().not.toBeUnknown()
    expectTypeOf<ChatParams['messages']>().not.toBeAny()
    expectTypeOf<ChatCompletion['choices']>().not.toBeUnknown()
    expectTypeOf<Model['id']>().toEqualTypeOf<string>()
  })

  it('never exposes a model field the SDK fills in, nor stream controls', () => {
    expectTypeOf<ChatParams>().not.toHaveProperty('stream')
    expectTypeOf<ChatParams>().not.toHaveProperty('stream_options')
  })

  it('keeps the engine error codes equal to the generated enum', () => {
    expectTypeOf<EngineErrorCode>().toEqualTypeOf<components['schemas']['ErrorBody']['code']>()
  })
})
