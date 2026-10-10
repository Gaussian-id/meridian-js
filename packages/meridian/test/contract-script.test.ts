// scripts/contract.mjs: only its refusals and the command it would run are tested. Nothing here starts the suite
// against an engine, and the only socket is a throwaway server on this machine.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COMMAND, engineReady, main, readyEndpoint, ROOT } from '../../../scripts/contract.mjs'
import type { Environ } from '../../../scripts/contract-guard.mjs'

const GEMINI = 'GAUSSMERIDIAN_GEMINI_API_KEY'
const SECRET = 'v' + 'q'.repeat(24) // built at run time; nothing the script prints may contain it
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function runtimeWith(text = 'GAUSSMERIDIAN_DB_PASSWORD=x\n') {
  const root = mkdtempSync(join(tmpdir(), 'meridian-script-'))
  const folder = join(root, 'Gaussian', 'MeridianEngine')

  roots.push(root)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'meridian-engine.env'), text)

  return { environ: { LOCALAPPDATA: root, PATH: process.env.PATH ?? '' } as Environ, folder }
}

/** A runner and a readiness probe that record what they were asked and launch nothing. */
function calls({ ready = true, code = 0, registry = {} as Record<string, string> } = {}) {
  const readyUrls: string[] = []
  const runs: { command: string[]; env: Environ; cwd: string }[] = []

  return {
    readyUrls,
    runs,
    options: {
      ready: async (url: string) => {
        readyUrls.push(url)

        return ready
      },
      runner: (command: string[], options: { env: Environ; cwd: string }) => {
        runs.push({ command, ...options })

        return code
      },
      registry: () => registry
    }
  }
}

let errors: string[] = []

beforeEach(() => {
  errors = []
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.join(' ')))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('contract script', () => {
  it('runs the suite with node and the installed vitest: no pnpm, no install, no network, no env file', () => {
    const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')

    expect(COMMAND).toEqual([process.execPath, vitest, 'run', '--passWithNoTests'])
  })

  it('refuses a paid key in the env file before anything runs', async () => {
    const { environ } = runtimeWith(`export ${GEMINI}="${SECRET}"\r\n`)
    const seen = calls()

    expect(await main(environ, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain(GEMINI)
    expect(errors.join('\n')).not.toContain(SECRET)
    expect([seen.readyUrls, seen.runs]).toEqual([[], []])
  })

  it('refuses a paid key in the process environment before anything runs', async () => {
    const { environ } = runtimeWith()
    const seen = calls()

    expect(await main({ ...environ, [GEMINI]: SECRET }, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain(GEMINI)
    expect(errors.join('\n')).not.toContain(SECRET)
    expect([seen.readyUrls, seen.runs]).toEqual([[], []])
  })

  it('refuses a non-loopback URL before anything runs', async () => {
    const { environ } = runtimeWith()
    const seen = calls()

    expect(await main({ ...environ, MERIDIAN_ADMIN_URL: 'http://localhost.evil.com:8181' }, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain('MERIDIAN_ADMIN_URL')
    expect(errors.join('\n')).not.toContain('evil')
    expect([seen.readyUrls, seen.runs]).toEqual([[], []])
  })

  it('refuses without running when the engine is not ready', async () => {
    const { environ } = runtimeWith()
    const seen = calls({ ready: false })

    expect(await main(environ, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain('not ready')
    expect(seen.readyUrls).toEqual(['http://127.0.0.1:8180'])
    expect(seen.runs).toEqual([])
  })

  it('launches the suite in contract mode, without a proxy or NODE_OPTIONS, and returns its code', async () => {
    const { environ, folder } = runtimeWith()
    const seen = calls({ code: 3 })
    const env = { ...environ, MERIDIAN_PUBLIC_URL: 'http://localhost:9180', MERIDIAN_CONTRACT: '0' }

    expect(await main({ ...env, NODE_OPTIONS: '--env-file=.env', node_options: '-r x' }, seen.options)).toBe(3)
    expect(seen.readyUrls).toEqual(['http://localhost:9180'])
    const { command, env: child, cwd } = seen.runs[0]!

    expect(command).toEqual(COMMAND)
    expect(cwd).toBe(ROOT)
    expect(child.MERIDIAN_CONTRACT).toBe('1')
    expect(child.MERIDIAN_RUNTIME_DIR).toBe(folder)
    expect(child.PATH).toBe(environ.PATH)
    expect([child.NO_PROXY, child.no_proxy]).toEqual(['*', '*'])
    expect(Object.keys(child).filter(name => name.toUpperCase() === 'NODE_OPTIONS')).toEqual([])
  })

  it.each(['HTTP_PROXY', 'https_proxy', 'All_Proxy'])('refuses %s before anything runs', async name => {
    const { environ } = runtimeWith()
    const seen = calls()

    expect(await main({ ...environ, [name]: `http://u:${SECRET}@proxy.example:3128` }, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain('proxy')
    expect(errors.join('\n')).not.toContain(SECRET)
    expect(errors.join('\n')).not.toContain('proxy.example')
    expect([seen.readyUrls, seen.runs]).toEqual([[], []])
  })

  it('refuses a registry proxy before anything runs', async () => {
    const { environ } = runtimeWith()
    const seen = calls({ registry: { http: 'http://reg.example:3128' } })

    expect(await main({ ...environ, no_proxy: '127.0.0.1' }, seen.options)).toBe(1)
    expect(errors.join('\n')).toContain('http')
    expect(errors.join('\n')).not.toContain('reg.example')
    expect([seen.readyUrls, seen.runs]).toEqual([[], []])
  })

  it('gives the child the runtime dir that was checked', async () => {
    const { environ, folder } = runtimeWith()
    const seen = calls()

    mkdirSync(join(folder, 'sub'))
    expect(await main({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'sub') }, seen.options)).toBe(0)
    expect(seen.runs[0]!.env.MERIDIAN_RUNTIME_DIR).toBe(join(folder, 'sub'))
  })

  it('asks for /ready whatever the trailing slash', async () => {
    const { environ } = runtimeWith()
    const seen = calls({ ready: false })

    await main({ ...environ, MERIDIAN_PUBLIC_URL: 'http://127.0.0.1:8180/' }, seen.options)
    expect(seen.readyUrls).toEqual(['http://127.0.0.1:8180/'])
    expect(readyEndpoint('http://127.0.0.1:8180/')).toBe('http://127.0.0.1:8180/ready')
    expect(readyEndpoint('http://127.0.0.1:8180')).toBe('http://127.0.0.1:8180/ready')
  })

  it('run as a program, refuses with a non-zero exit and no values', () => {
    const { environ } = runtimeWith()

    // port 1 answers nobody: even if the guard were wrong, the readiness probe would still refuse
    const env = {
      ...environ,
      [GEMINI]: SECRET,
      MERIDIAN_PUBLIC_URL: 'http://127.0.0.1:1',
      SYSTEMROOT: process.env.SYSTEMROOT ?? ''
    } as NodeJS.ProcessEnv

    const done = spawnSync(process.execPath, [join(ROOT, 'scripts', 'contract.mjs')], {
      env,
      encoding: 'utf8',
      timeout: 60_000
    })

    expect(done.status).not.toBe(0)
    expect(done.stdout + done.stderr).toContain(GEMINI)
    expect(done.stdout + done.stderr).not.toContain(SECRET)
  })
})

describe('contract script: the readiness probe, against a throwaway server on this machine', () => {
  let server: Server
  let base = ''

  beforeEach(async () => {
    server = createServer((request, response) => {
      if (request.url === '/ready') response.writeHead(200)
      else if (request.url === '/redirect/ready') response.writeHead(302, { Location: `${base}/ready` })
      else if (request.url === '/empty/ready') response.writeHead(204)
      else response.writeHead(503)
      response.end()
    })
    await new Promise<void>(listening => server.listen(0, '127.0.0.1', listening))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await new Promise(closed => server.close(closed))
  })

  it('means a plain 200', async () => {
    expect(await engineReady(base)).toBe(true)
    expect(await engineReady(base + '/')).toBe(true)
  })

  it('is false for other answers, redirects and nobody listening', async () => {
    expect(await engineReady(base + '/redirect')).toBe(false)
    expect(await engineReady(base + '/elsewhere')).toBe(false)
    expect(await engineReady(base + '/empty')).toBe(false)
    expect(await engineReady('http://127.0.0.1:1')).toBe(false)
  })

  it('does not go through a proxy from the environment', async () => {
    vi.stubEnv('HTTP_PROXY', 'http://127.0.0.1:1')
    vi.stubEnv('http_proxy', 'http://127.0.0.1:1')
    vi.stubEnv('NODE_USE_ENV_PROXY', '1')

    try {
      expect(await engineReady(base)).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})
