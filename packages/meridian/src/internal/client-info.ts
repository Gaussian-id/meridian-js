/** This package's version; kept equal to package.json's `version` when a release is cut. */
export const VERSION = '0.2.0'

interface RuntimeGlobals {
  Deno?: { version?: { deno?: string } }
  Bun?: { version?: string }
  EdgeRuntime?: unknown
  process?: { versions?: { node?: string } }
}

/** The runtime a server client runs in, and its version when the runtime reports one. */
function runtime(): { name: string; version?: string } | null {
  const g = globalThis as RuntimeGlobals

  if (g.Deno?.version?.deno) return { name: 'deno', version: g.Deno.version.deno }
  if (typeof g.Bun?.version === 'string') return { name: 'bun', version: g.Bun.version }
  if (typeof g.EdgeRuntime === 'string') return { name: 'edge' }
  if (g.process?.versions?.node) return { name: 'node', version: g.process.versions.node }

  return null
}

/**
 * The `X-Client-Info` value the server and admin clients send, in supabase-js's format:
 * `meridian-js/0.2.0; runtime=node; runtime-version=24.14.0`. It names no app, key or user.
 */
export function clientInfo(): string {
  const parts = [`meridian-js/${VERSION}`]
  const found = runtime()

  if (found) parts.push(`runtime=${found.name}`)
  if (found?.version) parts.push(`runtime-version=${found.version}`)

  return parts.join('; ')
}
