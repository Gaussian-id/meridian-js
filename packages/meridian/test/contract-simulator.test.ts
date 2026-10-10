// The simulator proof (S1-S4) of the contract guard, with a fake docker. The real docker is never run here.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { refusal, simulatorProof, SIM_TEMPLATE, type Environ } from '../../../scripts/contract-guard.mjs'
import { ENGINE_ID, fakeDocker, healthySim, SIM_TOKENS, type FakeSim } from './support/fake-docker'

const SECRET = 'v' + 'q'.repeat(24)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function runtime(text = 'GAUSSMERIDIAN_DB_PASSWORD=x\n') {
  const root = mkdtempSync(join(tmpdir(), 'meridian-sim-'))
  const folder = join(root, 'Gaussian', 'MeridianEngine')

  roots.push(root)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'meridian-engine.env'), text)

  return { environ: { LOCALAPPDATA: root } as Environ, folder }
}

/** The proof for a healthy simulator, changed by `change`. */
function prove(change: (sim: FakeSim) => void = () => {}, extra: Environ = {}) {
  const { environ, folder } = runtime()
  const all = { ...environ, ...extra }
  const sim = healthySim(all)

  change(sim)
  const docker = fakeDocker(sim)

  return { reason: simulatorProof(all, folder, { docker }), docker, folder, environ: all }
}

describe('simulator proof', () => {
  it('passes for a simulator engine started from this runtime', () => {
    expect(prove().reason).toBeNull()
  })

  it('asks docker with a fixed argv, a format on every inspect, and never for logs or raw env', () => {
    const { docker } = prove()

    expect(docker.calls.length).toBeGreaterThan(0)

    for (const args of docker.calls) {
      expect(['ps', 'port', 'inspect']).toContain(args[0])

      if (args[0] === 'inspect') expect(args).toContain('--format')
    }

    const inspected = docker.calls.filter(args => args[0] === 'inspect').map(args => args[args.indexOf('--format') + 1])

    expect(inspected).toContain(SIM_TEMPLATE)
    expect(SIM_TEMPLATE).not.toMatch(/\.Config\.Env\}\}\s*$/)
    expect(JSON.stringify(docker.calls)).not.toContain('logs')
  })

  it('uses the default project and the GAUSSMERIDIAN_LOCAL_PROJECT override', () => {
    const [, , , filter] = prove().docker.calls[0]!
    const other = prove(() => {}, { GAUSSMERIDIAN_LOCAL_PROJECT: 'meridian-sim' }).docker.calls[0]!

    expect(filter).toBe('label=com.docker.compose.project=meridian-engine')
    expect(other).toContain('label=com.docker.compose.project=meridian-sim')
  })

  it('refuses a project name that is not a plain name', () => {
    expect(prove(() => {}, { GAUSSMERIDIAN_LOCAL_PROJECT: 'a b;c' }).reason).toContain('GAUSSMERIDIAN_LOCAL_PROJECT')
  })

  it('refuses when docker is missing, fails, or throws', () => {
    expect(prove(sim => (sim.missing = true)).reason).toContain('docker')
    expect(prove(sim => (sim.status = 1)).reason).toContain('docker')
  })

  it('refuses when provider-sim is not running exactly once', () => {
    expect(prove(sim => (sim.provider = [])).reason).toContain('provider-sim')
    expect(prove(sim => (sim.provider = ['a'.repeat(12), 'b'.repeat(12)])).reason).toContain('provider-sim')
    expect(prove(sim => (sim.provider = ['not an id'])).reason).toContain('provider-sim')
  })

  it('refuses no engine, two engines', () => {
    expect(prove(sim => (sim.engines = [])).reason).toContain('exactly one engine')
    expect(prove(sim => (sim.engines = [ENGINE_ID, 'f'.repeat(12)])).reason).toContain('exactly one engine')
  })

  it.each([
    ['public', { '8180/tcp': '0.0.0.0:8180', '8181/tcp': '127.0.0.1:8181' }],
    ['admin', { '8180/tcp': '127.0.0.1:8180', '8181/tcp': '127.0.0.1:9999' }],
    ['absent', { '8180/tcp': '', '8181/tcp': '127.0.0.1:8181' }],
    ['two bindings', { '8180/tcp': '127.0.0.1:8180\n0.0.0.0:8180', '8181/tcp': '127.0.0.1:8181' }]
  ])('refuses when the %s port is not owned on 127.0.0.1', (_name, ports) => {
    expect(prove(sim => (sim.ports = ports as FakeSim['ports'])).reason).toContain('ports')
  })

  it('compares the ports with the URLs the suite uses', () => {
    const urls = { MERIDIAN_PUBLIC_URL: 'http://127.0.0.1:9180', MERIDIAN_ADMIN_URL: 'http://127.0.0.1:9181' }

    const default8180 = { '8180/tcp': '127.0.0.1:8180', '8181/tcp': '127.0.0.1:8181' }

    expect(prove(sim => (sim.ports = default8180), urls).reason).toContain('ports')
    expect(prove(() => {}, urls).reason).toBeNull()
  })

  it.each(SIM_TOKENS)('refuses when %s is missing, naming it', token => {
    const { reason } = prove(sim => (sim.tokens = SIM_TOKENS.filter(name => name !== token)))

    expect(reason).toContain(token)
  })

  it('refuses a token it does not know', () => {
    expect(prove(sim => sim.tokens.push('live_key')).reason).toContain('simulator')
  })

  it('compares inside the template and prints only the match tokens, never a value', () => {
    expect(SIM_TEMPLATE).toContain('{{if eq . "GAUSSMERIDIAN_GEMINI_BASE_URL=http://provider-sim:8184/v1beta"}}')
    expect(SIM_TEMPLATE).toContain('{{if eq . "GAUSSMERIDIAN_OPENROUTER_BASE_URL=http://provider-sim:8184/api/v1"}}')
    expect(SIM_TEMPLATE).toContain('{{if eq . "GAUSSMERIDIAN_PROVIDER_SIMULATOR=true"}}')
    expect(SIM_TEMPLATE).toContain('{{if eq . "GAUSSMERIDIAN_GEMINI_API_KEY=sim-local-key"}}')
    expect(SIM_TEMPLATE).toContain('{{if eq . "GAUSSMERIDIAN_OPENROUTER_API_KEY=sim-local-key"}}')

    // the only thing the range body prints is a token followed by a space
    expect(SIM_TEMPLATE.replace(/\{\{[^}]*\}\}/g, '').replace(/[a-z_]+ /g, '')).toBe('')
  })

  it('refuses an engine started from another env file', () => {
    expect(prove(sim => (sim.label = join(tmpdir(), 'other', 'meridian-engine.env'))).reason).toContain('env file')
  })

  it('takes the label with forward slashes, or any letter case on Windows', () => {
    const forward = prove(sim => (sim.label = sim.label.replaceAll('\\', '/')))

    expect(forward.reason).toBeNull()
  })

  it('binds to GAUSSMERIDIAN_ENV_FILE when that is the engine env file', () => {
    const { environ, folder } = runtime()
    const own = join(folder, 'other.env')

    writeFileSync(own, 'A=1\n')
    const all = { ...environ, GAUSSMERIDIAN_ENV_FILE: own }

    expect(simulatorProof(all, folder, { docker: fakeDocker(healthySim(all)) })).toBeNull()

    const sim = healthySim(all)

    sim.label = join(folder, 'meridian-engine.env')
    expect(simulatorProof(all, folder, { docker: fakeDocker(sim) })).toContain('env file')
  })

  it('without the label, needs a marker in the runtime folder that holds the engine id', () => {
    const none = prove(sim => (sim.label = ''))

    expect(none.reason).toContain('env file')

    const { environ, folder } = runtime()
    const sim = healthySim(environ)

    sim.label = ''
    writeFileSync(join(folder, `.sim-started-${ENGINE_ID}`), `${ENGINE_ID}${'e'.repeat(52)}\n`)
    expect(simulatorProof(environ, folder, { docker: fakeDocker(sim) })).toBeNull()

    writeFileSync(join(folder, `.sim-started-${ENGINE_ID}`), `${'9'.repeat(64)}\n`)
    expect(simulatorProof(environ, folder, { docker: fakeDocker(sim) })).toContain('env file')
  })

  it('never puts a value, a path or an id in a message', () => {
    const messages = [
      prove(sim => (sim.missing = true)).reason,
      prove(sim => (sim.engines = [])).reason,
      prove(sim => (sim.tokens = [])).reason,
      prove(sim => (sim.label = SECRET)).reason,
      prove(sim => (sim.ports = { '8180/tcp': SECRET, '8181/tcp': SECRET })).reason
    ]

    for (const message of messages) {
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain(ENGINE_ID)
      expect(message).not.toContain(tmpdir())
    }
  })
})

describe('simulator proof inside the guard', () => {
  it('is required: a clean runtime without a proof is refused', () => {
    const { environ } = runtime()
    const sim = healthySim(environ)

    sim.provider = []
    expect(refusal(environ, { registry: () => ({}), docker: fakeDocker(sim) })).toContain('provider-sim')
    expect(refusal(environ, { registry: () => ({}), docker: fakeDocker(healthySim(environ)) })).toBeNull()
  })

  it('comes after the paid-key scan and the loopback check', () => {
    const { environ } = runtime(`GAUSSMERIDIAN_GEMINI_API_KEY=${SECRET}\n`)
    const sim = healthySim(environ)

    sim.missing = true
    const paid = fakeDocker(sim)

    expect(refusal(environ, { registry: () => ({}), docker: paid })).toContain('GAUSSMERIDIAN_GEMINI_API_KEY')
    expect(paid.calls).toEqual([])

    const clean = runtime().environ
    const down = healthySim(clean)

    down.missing = true
    const loopback = fakeDocker(down)

    expect(
      refusal({ ...clean, MERIDIAN_PUBLIC_URL: 'http://example.com:8180' }, { registry: () => ({}), docker: loopback })
    ).toContain('MERIDIAN_PUBLIC_URL')
    expect(loopback.calls).toEqual([])
    expect(refusal(clean, { registry: () => ({}), docker: fakeDocker(down) })).toContain('docker')
  })

  it('honours a throwaway LOCALAPPDATA only when the live engine was started from it', () => {
    const real = runtime()
    const throwaway = runtime()
    const sim = healthySim(real.environ) // an engine started from the other runtime

    expect(refusal(throwaway.environ, { registry: () => ({}), docker: fakeDocker(sim) })).toContain('env file')
    expect(
      refusal(throwaway.environ, { registry: () => ({}), docker: fakeDocker(healthySim(throwaway.environ)) })
    ).toBeNull()
  })
})
