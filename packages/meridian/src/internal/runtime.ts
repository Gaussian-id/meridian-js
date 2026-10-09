import { configError, type MeridianError } from './errors'

interface RuntimeGlobals {
  window?: unknown
  document?: unknown
  navigator?: { product?: string }
}

/** True in a browser page or a React Native app: places where a key would ship to users. */
export function isBrowserLike(): boolean {
  const g = globalThis as RuntimeGlobals

  if (g.navigator?.product === 'ReactNative') return true

  return typeof g.window === 'object' && g.window !== null && typeof g.document === 'object' && g.document !== null
}

/** `alternative` names the client to use instead; null when there is none (provisioning belongs on a server). */
export function refusal(fn: string, alternative: string | null): MeridianError | null {
  const advice = alternative
    ? `In a browser or mobile app use ${alternative}().`
    : 'Provisioning must run on a server, never in a browser or mobile app.'

  return isBrowserLike() ? configError(`${fn}() holds a secret key and runs only on a server. ${advice}`) : null
}

export function urlRefusal(url: string, name: string): MeridianError | null {
  try {
    const parsed = new URL(url)

    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
      ? null
      : configError(`${name} must be an http(s) URL.`)
  } catch {
    return configError(`${name} must be an absolute http(s) URL.`)
  }
}
