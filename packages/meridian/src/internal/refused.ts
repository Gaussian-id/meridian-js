import { fail, type MeridianError } from './errors'
import type { MeridianClient } from '../types'

/** A client that cannot work: every call resolves to the same configuration error, never throws. */
export function refusedClient(error: MeridianError): MeridianClient {
  const refuse = async () => fail<never>(error)

  return { chat: { create: refuse, stream: refuse }, models: { list: refuse } }
}
