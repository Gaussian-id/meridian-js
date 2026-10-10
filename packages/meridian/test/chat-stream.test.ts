import { expect, it } from 'vitest'

import { createClient } from '@gaussian-id/meridian'
import type { ChatParams } from '@gaussian-id/meridian'

import { describeEngine, describeFake, testEngine } from './support/engine'
import { chunk, envelope, finish, frame, usageChunk } from './support/fake-engine'

const messages = [{ role: 'user' as const, content: 'hello' }]

function client() {
  const engine = testEngine()

  return { engine, meridian: createClient(engine.publicUrl, engine.projectKey, { fetch: engine.fetch, maxRetries: 0 }) }
}

describeEngine('chat.stream', () => {
  it('always sends stream: true and include_usage: true, whatever the caller passes', async () => {
    const { engine, meridian } = client()

    const { data: stream } = await meridian.chat.stream({
      messages,
      stream: false,
      stream_options: { include_usage: false }
    } as ChatParams)

    await stream?.text()

    if (engine.fake) {
      const sent = (await engine.fake.requests.at(-1)!.json()) as {
        stream: unknown
        stream_options: { include_usage: unknown }
      }

      expect(sent.stream).toBe(true)
      expect(sent.stream_options.include_usage).toBe(true)
    }
  })

  it('yields text chunks, ends cleanly and reports token usage', async () => {
    const { engine, meridian } = client()
    const { data: stream, error } = await meridian.chat.stream({ model: engine.model, messages })

    expect(error).toBeNull()
    let text = ''

    for await (const piece of stream!) text += piece.delta

    expect(text.length).toBeGreaterThan(0)
    expect(stream!.error).toBeNull()
    expect(typeof stream!.usage?.total_tokens).toBe('number')
  })

  it('collects the reply with text()', async () => {
    const { engine, meridian } = client()
    const { data: stream } = await meridian.chat.stream({ model: engine.model, messages })

    const { data, error } = await stream!.text()

    expect(error).toBeNull()
    expect(data!.length).toBeGreaterThan(0)
  })

  it('hands the engine events back unchanged with toResponse()', async () => {
    const { engine, meridian } = client()
    const { data: stream } = await meridian.chat.stream({ model: engine.model, messages })

    const response = stream!.toResponse()
    const body = await response.text()

    expect(response.headers.get('content-type')).toContain('text/event-stream')
    expect(body).toMatch(/^data: /)
    expect(body.trimEnd().endsWith('data: [DONE]')).toBe(true)
  })

  it('refuses a refused request before streaming, as an error value', async () => {
    const engine = testEngine()
    const meridian = createClient(engine.publicUrl, `gmr_${'e'.repeat(64)}`, { fetch: engine.fetch })

    const { data, error } = await meridian.chat.stream({ model: engine.model, messages })

    expect(data).toBeNull()
    expect(error?.code).toBe('invalid_api_key')
  })
})

describeFake('chat.stream edge cases', () => {
  it('keeps text intact when frames split mid-line, mid-CRLF and mid UTF-8 character', async () => {
    const { engine, meridian } = client()
    const wire = `data: ${JSON.stringify(chunk('Halo dunia 👋'))}\r\n\r\ndata: ${JSON.stringify(chunk(' é'))}\r\n\r\n${frame(finish())}${frame('[DONE]')}`
    const bytes = new TextEncoder().encode(wire)
    const emoji = wire.indexOf('👋')
    const cut = new TextEncoder().encode(wire.slice(0, emoji)).length + 2
    const crlf = new TextEncoder().encode(wire.slice(0, wire.indexOf('\r\n\r\n'))).length + 1

    engine.fake!.next({ chunks: [bytes.slice(0, 7), bytes.slice(7, crlf), bytes.slice(crlf, cut), bytes.slice(cut)] })

    const { data: stream } = await meridian.chat.stream({ messages })
    const { data } = await stream!.text()

    expect(data).toBe('Halo dunia 👋 é')
    expect(stream!.error).toBeNull()
  })

  it('loses and duplicates nothing when a CRLF wire arrives one byte at a time', async () => {
    const { engine, meridian } = client()
    const one = JSON.stringify(chunk('Selamat pagi 👋 é'))
    const two = JSON.stringify(chunk('!'))
    const wire = `data: ${one}\r\n\r\ndata: ${two}\r\n\r\n${frame(finish())}${frame('[DONE]')}`
    const bytes = new TextEncoder().encode(wire)

    expect(wire).toContain('\r\n\r\n')
    engine.fake!.next({ chunks: Array.from(bytes, (_, index) => bytes.slice(index, index + 1)) })

    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) pieces.push(piece.delta)

    expect(pieces).toEqual(['Selamat pagi 👋 é', '!', ''])
    expect(stream!.error).toBeNull()
  })

  it('keeps a multi-line data field as one event when the split falls inside its CRLF', async () => {
    const { engine, meridian } = client()
    const encoder = new TextEncoder()
    const half = JSON.stringify(chunk('x'))
    const cut = half.indexOf(',')
    const wire = [`data: ${half.slice(0, cut)}\r`, `\ndata: ${half.slice(cut)}\r\n\r\n`, frame('[DONE]')]

    engine.fake!.next({ chunks: wire.map(piece => encoder.encode(piece)) })
    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) pieces.push(piece.delta)

    expect(pieces).toEqual(['x'])
    expect(stream!.error).toBeNull()
  })

  it('cancel() mid-stream ends as aborted and reaches the engine', async () => {
    const engine = testEngine()
    const signals: AbortSignal[] = []

    const meridian = createClient(engine.publicUrl, engine.projectKey, {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal)

        return engine.fetch(input, init)
      }) as typeof fetch,
      maxRetries: 0
    })

    engine.fake!.next({ chunks: [frame(chunk('first'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) {
      pieces.push(piece.delta)
      stream!.cancel()
    }

    expect(pieces).toEqual(['first'])
    expect(stream!.error).toMatchObject({ code: 'aborted', retryable: false })
    expect(signals.at(-1)!.aborted).toBe(true)
  })

  it('cancel() before reading ends as aborted and detaches from the caller signal', async () => {
    const { engine, meridian } = client()
    const controller = new AbortController()

    engine.fake!.next({ chunks: [frame(chunk('a'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages }, { signal: controller.signal })

    stream!.cancel()
    const { data, error } = await stream!.text()

    expect(data).toBeNull()
    expect(error?.code).toBe('aborted')
  })

  it('aborts upstream when the consumer breaks out of the loop', async () => {
    const engine = testEngine()
    const signals: AbortSignal[] = []

    const meridian = createClient(engine.publicUrl, engine.projectKey, {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal)

        return engine.fetch(input, init)
      }) as typeof fetch,
      maxRetries: 0
    })

    engine.fake!.next({ chunks: [frame(chunk('a')), frame(chunk('b'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages })

    for await (const piece of stream!) {
      expect(piece.delta).toBe('a')
      break
    }

    expect(signals.at(-1)!.aborted).toBe(true)
  })

  it('aborts upstream and names the problem when a frame is not valid JSON', async () => {
    const engine = testEngine()
    const signals: AbortSignal[] = []

    const meridian = createClient(engine.publicUrl, engine.projectKey, {
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal)

        return engine.fetch(input, init)
      }) as typeof fetch,
      maxRetries: 0
    })

    engine.fake!.next({ chunks: [frame(chunk('ok')), frame('{not json'), frame(chunk('late'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) pieces.push(piece.delta)

    expect(pieces).toEqual(['ok'])
    expect(stream!.error).toMatchObject({ code: 'network_error' })
    expect(stream!.error?.message).toMatch(/not valid JSON/)
    expect(signals.at(-1)!.aborted).toBe(true)
  })

  it('copies only the three token counts into usage', async () => {
    const { engine, meridian } = client()
    const extra = { ...usageChunk(1, 2), usage: { ...usageChunk(1, 2).usage, cost: 0.5 } }

    engine.fake!.next({ chunks: [frame(chunk('x')), frame(extra), frame('[DONE]')] })
    const { data: stream } = await meridian.chat.stream({ messages })

    await stream!.text()

    expect(stream!.usage).toEqual({ prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 })
  })

  it('leaves out token counts the engine did not report', async () => {
    const { engine, meridian } = client()
    const partial = { ...usageChunk(1, 2), usage: { prompt_tokens: 1, prompt_tokens_details: { cached_tokens: 1 } } }

    engine.fake!.next({ chunks: [frame(chunk('x')), frame(partial), frame('[DONE]')] })
    const { data: stream } = await meridian.chat.stream({ messages })

    await stream!.text()

    expect(stream!.usage).toStrictEqual({ prompt_tokens: 1 })
  })

  it('reports an error frame mid-stream on stream.error, without throwing', async () => {
    const { engine, meridian } = client()

    engine.fake!.next({ chunks: [frame(chunk('partial')), frame(envelope('upstream_error'))] })
    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) pieces.push(piece.delta)

    expect(pieces).toEqual(['partial'])
    expect(stream!.error).toMatchObject({ code: 'upstream_error', status: 502, type: 'api_error' })
  })

  it('treats a stream that stops without [DONE] as network_error', async () => {
    const { engine, meridian } = client()

    engine.fake!.next({ chunks: [frame(chunk('cut'))] })
    const { data: stream } = await meridian.chat.stream({ messages })

    const { data, error } = await stream!.text()

    expect(data).toBeNull()
    expect(error).toMatchObject({ code: 'network_error' })
    expect(stream!.error?.code).toBe('network_error')
  })

  it('cancels upstream when the caller aborts mid-stream', async () => {
    const { engine, meridian } = client()
    const controller = new AbortController()

    engine.fake!.next({ chunks: [frame(chunk('first'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages }, { signal: controller.signal })
    const pieces: string[] = []

    for await (const piece of stream!) {
      pieces.push(piece.delta)
      controller.abort()
    }

    expect(pieces).toEqual(['first'])
    expect(stream!.error?.code).toBe('aborted')
  })

  it('stops quietly when the consumer breaks out of the loop', async () => {
    const { engine, meridian } = client()

    engine.fake!.next({ chunks: [frame(chunk('a')), frame(chunk('b'))], hang: true })
    const { data: stream } = await meridian.chat.stream({ messages })

    for await (const piece of stream!) {
      expect(piece.delta).toBe('a')
      break
    }

    expect(stream!.error).toBeNull()
  })

  it('asks the engine for the usage chunk and keeps it off the chunk list', async () => {
    const { engine, meridian } = client()

    engine.fake!.next({ chunks: [frame(chunk('x')), frame(finish()), frame(usageChunk(4, 6)), frame('[DONE]')] })
    const { data: stream } = await meridian.chat.stream({ messages })
    const pieces: string[] = []

    for await (const piece of stream!) pieces.push(piece.delta)
    const sent = (await engine.fake!.requests.at(-1)!.json()) as Record<string, unknown>

    expect(sent).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(pieces).toEqual(['x', ''])
    expect(stream!.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6, total_tokens: 10 })
  })

  it('is consumed once', async () => {
    const { meridian } = client()
    const { data: stream } = await meridian.chat.stream({ messages })

    await stream!.text()
    const second = await stream!.text()

    expect(second.error?.code).toBe('aborted')
  })
})
