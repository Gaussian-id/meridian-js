import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe } from 'vitest'

import { createFakeEngine, type AdminRouter, type FakeEngine } from './fake-engine'

/** True when the suite runs against the real local engine (scripts/contract.mjs sets it). */
export const contract = process.env.MERIDIAN_CONTRACT === '1'

/** Tests that script failures the real engine cannot be told to produce. */
export const describeFake = describe.runIf(!contract)

export interface TestEngine {
  fetch: typeof fetch
  publicUrl: string
  adminUrl: string
  projectKey: string
  integratorKey: string
  model: string
  fake: FakeEngine | null
}

function runtimeDir(): string {
  if (process.env.MERIDIAN_RUNTIME_DIR) return process.env.MERIDIAN_RUNTIME_DIR
  const base = process.env.LOCALAPPDATA ?? join(process.env.HOME ?? '', '.local', 'state')

  return process.env.LOCALAPPDATA ? join(base, 'Gaussian', 'MeridianEngine') : join(base, 'gaussian', 'meridian-engine')
}

/** Reads a key file without ever printing its value. */
function readKey(file: string): string {
  return readFileSync(join(runtimeDir(), file), 'utf8').trim()
}

export function testEngine(adminRouter?: AdminRouter): TestEngine {
  if (!contract) {
    const fake = createFakeEngine(adminRouter)

    return { ...fake, model: 'gemini-3.8-flash', fake }
  }

  return {
    fetch: globalThis.fetch.bind(globalThis),
    publicUrl: process.env.MERIDIAN_PUBLIC_URL ?? 'http://127.0.0.1:8180',
    adminUrl: process.env.MERIDIAN_ADMIN_URL ?? 'http://127.0.0.1:8181',
    projectKey: readKey('local-api-key.txt'),
    integratorKey: readKey('local-integrator-key.txt'),
    model: 'gemini-3.8-flash',
    fake: null
  }
}
