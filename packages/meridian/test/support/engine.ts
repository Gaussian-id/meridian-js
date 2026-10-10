import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, TestRunner } from 'vitest'

import {
  DEFAULT_URLS,
  refusal,
  runtimeDir,
  type Environ,
  type RegistryEntries
} from '../../../../scripts/contract-guard.mjs'
import { createFakeEngine, type AdminRouter, type FakeEngine } from './fake-engine'

/** True when the suite runs against the real local engine (scripts/contract.mjs sets it). */
export const contract = process.env.MERIDIAN_CONTRACT === '1'

/**
 * Tests that script failures the real engine cannot be told to produce. Against the real engine they are not
 * registered at all (deselected, not skipped), so no option can make them run there.
 */
export function describeFake(name: string, fn: () => void) {
  if (!contract) describe(name, { tags: ['fake'] }, fn)
}

/** Tests that run against the fake engine, and against the real local engine in contract mode. */
export function describeEngine(name: string, fn: () => void) {
  describe(name, { tags: ['contract'] }, fn)
}

export interface TestEngine {
  fetch: typeof fetch
  publicUrl: string
  adminUrl: string
  projectKey: string
  integratorKey: string
  model: string
  fake: FakeEngine | null
}

/** The real local engine, behind the same guard scripts/contract.mjs runs: even a direct contract-mode run meets it. */
export function contractEngine(environ: Environ, options?: { registry?: () => RegistryEntries }): TestEngine {
  const reason = refusal(environ, options)
  const folder = environ.MERIDIAN_RUNTIME_DIR || runtimeDir(environ)

  if (reason !== null || !folder) throw new Error(`Contract run refused: ${reason ?? 'no runtime folder.'}`)

  // Reads a key file without ever printing its value
  const readKey = (file: string) => readFileSync(join(folder, file), 'utf8').trim()

  return {
    fetch: globalThis.fetch.bind(globalThis),
    publicUrl: environ.MERIDIAN_PUBLIC_URL ?? DEFAULT_URLS.MERIDIAN_PUBLIC_URL,
    adminUrl: environ.MERIDIAN_ADMIN_URL ?? DEFAULT_URLS.MERIDIAN_ADMIN_URL,
    projectKey: readKey('local-api-key.txt'),
    integratorKey: readKey('local-integrator-key.txt'),
    model: 'gemini-3.8-flash',
    fake: null
  }
}

/** The engine for one test. A test (or suite) outside describeFake and describeEngine gets neither. */
export function testEngine(adminRouter?: AdminRouter): TestEngine {
  const test = TestRunner.getCurrentTest()
  const tags = test ? test.tags : TestRunner.getCurrentSuite()?.suite?.tags

  if (!tags?.some(tag => tag === 'fake' || tag === 'contract')) {
    throw new Error(`${test?.fullTestName ?? 'a suite'} uses the engine without describeFake or describeEngine`)
  }

  if (contract) return contractEngine(process.env)
  const fake = createFakeEngine(adminRouter)

  return { ...fake, model: 'gemini-3.8-flash', fake }
}
