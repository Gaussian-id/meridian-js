import { createChatApi } from './internal/chat'
import { fail, ok, configError, type MeridianError } from './internal/errors'
import { refusal, urlRefusal } from './internal/runtime'
import { createTransport } from './internal/transport'
import type { ClientOptions, MeridianClient, Model, RequestOptions } from './types'

function refusedClient(error: MeridianError): MeridianClient {
  const refuse = async () => fail<never>(error)

  return { chat: { create: refuse, stream: refuse }, models: { list: refuse } }
}

/** The server client: chat and models with a `gmr_` project key. Never runs in a browser. */
export function createClient(url: string, key: string, options: ClientOptions = {}): MeridianClient {
  // [1] Refuse where a key would leak, or when the client cannot work at all
  const refused =
    refusal('createClient', 'createBrowserClient') ??
    urlRefusal(url, 'The Meridian URL') ??
    (key ? null : configError('A Meridian project key is required.'))

  if (refused) return refusedClient(refused)

  // [2] One transport for every call
  const transport = createTransport({ baseUrl: url, key, ...options })

  return {
    chat: createChatApi(transport, '/v1/chat/completions'),
    models: {
      async list(requestOptions: RequestOptions = {}) {
        const result = await transport.json<{ data: Model[] }>({
          method: 'GET',
          path: '/v1/models',
          signal: requestOptions.signal
        })

        return result.error ? result : ok(result.data.data)
      }
    }
  }
}
