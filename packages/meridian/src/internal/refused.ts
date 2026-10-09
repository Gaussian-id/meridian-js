import { fail, type MeridianError, type Result } from './errors'
import type { Transport } from './transport'
import type { MeridianClient } from '../types'

/** A client that cannot work: every call resolves to the same configuration error, never throws. */
export function refusedClient(error: MeridianError): MeridianClient {
  const refuse = async () => fail<never>(error)

  return { chat: { create: refuse, stream: refuse }, models: { list: refuse } }
}

/** A transport that cannot work: a client built on it keeps its full shape and every call resolves to `error`. */
export function refusedTransport(error: MeridianError): Transport {
  const refuse = async (): Promise<Result<never>> => fail(error)

  return { json: refuse, open: refuse }
}
