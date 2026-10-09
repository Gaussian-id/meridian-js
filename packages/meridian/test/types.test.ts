import { describe, expectTypeOf, it } from 'vitest'

import type { ChatChunkRaw, ChatCompletion, ChatMessage, ChatParams, Model } from 'meridian'

import type { components } from '../src/generated/public'
import type { EngineErrorCode } from '../src/internal/errors'

/** The declared keys of an object type, ignoring the open `[key: string]: unknown` signature the spec adds. */
type KnownKeys<T> = keyof { [P in keyof T as string extends P ? never : number extends P ? never : P]: T[P] }

describe('public types come from the engine spec', () => {
  it('describes the chat request and reply', () => {
    expectTypeOf<ChatParams['messages']>().not.toBeUnknown()
    expectTypeOf<ChatParams['messages']>().not.toBeAny()
    expectTypeOf<ChatCompletion['choices']>().not.toBeUnknown()
    expectTypeOf<Model['id']>().toEqualTypeOf<string>()
  })

  it('never exposes a model field the SDK fills in, nor stream controls', () => {
    expectTypeOf<KnownKeys<ChatParams>>().not.toEqualTypeOf<never>()
    expectTypeOf<'stream' | 'stream_options'>().not.toExtend<KnownKeys<ChatParams>>()
    expectTypeOf<'messages'>().toExtend<KnownKeys<ChatParams>>()
  })

  it('keeps the engine error codes equal to the generated enum', () => {
    expectTypeOf<EngineErrorCode>().toEqualTypeOf<components['schemas']['ErrorBody']['code']>()
  })

  it('accepts a function tool literal', () => {
    const params: ChatParams = {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ type: 'function', function: { name: 'f', parameters: { type: 'object' } } }]
    }

    expectTypeOf(params.tools).not.toBeAny()
    expectTypeOf(params.tools).not.toBeUnknown()
  })

  it('accepts multi-turn tool messages and user', () => {
    const result: ChatMessage = { role: 'tool', tool_call_id: 'c1', name: 'f', content: '{}' }

    const call: ChatMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{}' } }]
    }

    const params: ChatParams = { messages: [call, result], user: 'u1' }

    expectTypeOf(params.user).toEqualTypeOf<string | null | undefined>()
  })

  it('keeps the raw chunk usable', () => {
    expectTypeOf<ChatChunkRaw['id']>().toEqualTypeOf<string>()
    expectTypeOf<ChatChunkRaw['choices'][number]['finish_reason']>().not.toBeNever()
  })

  it('exposes only the three token counts', () => {
    expectTypeOf<ChatCompletion['usage']>().not.toHaveProperty('prompt_tokens_details')
  })
})
