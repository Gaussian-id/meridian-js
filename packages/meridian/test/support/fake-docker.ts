// A fake docker for the guard's simulator proof: tests never run the real docker. It answers the fixed argv the
// guard uses, from a description of the containers, and records every call. No value here is secret.

import { join } from 'node:path'

import { ENV_FILE, runtimeDir, type Environ } from '../../../../scripts/contract-guard.mjs'

export interface SpawnResult {
  error?: Error
  status: number | null
  stdout?: string
}

export interface FakeSim {
  provider: string[] // the container ids `docker ps` returns for provider-sim

  /** Container ids `docker ps` returns for the engine. */
  engines: string[]

  /** The tokens the allowlisted comparison prints. */
  tokens: string[]

  /** What `docker port <id> 8180/tcp` and `8181/tcp` print. */
  ports: { '8180/tcp': string; '8181/tcp': string }

  /** The compose environment_file label ('' when absent). */
  label: string

  /** Exit status of every call. */
  status: number

  /** When set, the runner throws as a missing docker would. */
  missing: boolean
}

export const ENGINE_ID = 'e'.repeat(12)
export const SIM_TOKENS = ['gemini_base', 'openrouter_base', 'sim_flag', 'gemini_dummy', 'openrouter_dummy']

/** What a healthy simulator-mode engine answers for the runtime `environ` points at. */
export function healthySim(environ: Environ): FakeSim {
  const runtime = runtimeDir(environ)

  // The engine publishes the ports its URLs name (the defaults when unset or unreadable)
  const port = (value: string | undefined, fallback: string) => {
    try {
      return new URL(value ?? fallback).port || '80'
    } catch {
      return '0'
    }
  }

  return {
    provider: ['a'.repeat(12)],
    engines: [ENGINE_ID],
    tokens: [...SIM_TOKENS],
    ports: {
      '8180/tcp': `127.0.0.1:${port(environ.MERIDIAN_PUBLIC_URL, 'http://127.0.0.1:8180')}`,
      '8181/tcp': `127.0.0.1:${port(environ.MERIDIAN_ADMIN_URL, 'http://127.0.0.1:8181')}`
    },
    label: environ.GAUSSMERIDIAN_ENV_FILE || (runtime ? join(runtime, ENV_FILE) : ''),
    status: 0,
    missing: false
  }
}

export function fakeDocker(sim: FakeSim) {
  const calls: string[][] = []

  const run = (args: string[]): SpawnResult => {
    calls.push(args)
    if (sim.missing) throw new Error('docker is not installed')
    const ok = (stdout: string): SpawnResult => ({ status: sim.status, stdout })

    if (args[0] === 'ps') {
      const wanted = args.find(arg => arg.startsWith('label=com.docker.compose.service='))

      const ids = wanted === 'label=com.docker.compose.service=provider-sim' ? sim.provider : sim.engines

      return ok(ids.map(id => `${id}\n`).join(''))
    }

    if (args[0] === 'port') return ok(`${sim.ports[args[2] as keyof FakeSim['ports']] ?? ''}\n`)

    if (args[0] === 'inspect') {
      const template = args[args.indexOf('--format') + 1] ?? ''

      if (template.includes('environment_file')) return ok(`${sim.label}\n`)

      return ok(sim.tokens.map(token => `${token} `).join('') + '\n')
    }

    return { status: 1, stdout: '' }
  }

  return Object.assign(run, { calls })
}

/** A docker that proves simulator mode for the runtime `environ` points at. */
export const simDocker = (environ: Environ) => fakeDocker(healthySim(environ))
