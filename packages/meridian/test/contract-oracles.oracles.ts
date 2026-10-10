// The guard against the readers themselves: compose (which hands the engine its keys) and copies of both local-up
// readers (which decide simulator mode). Whenever a reader sets a paid key from an env file, the guard must refuse it.
// Each oracle is skipped, with the reason, when its tool is missing. Only names ever leave a reader, never a value.

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { afterAll, expect, it } from 'vitest'

import { isInside, refusal } from '../../../scripts/contract-guard.mjs'
import { describeFake } from './support/engine'
import { differentialTexts, GEMINI, OPENROUTER } from './support/guard-texts'

/** The paid names a reader sets to a non-empty value, per text label; null where it rejects the file. */
type Found = Record<string, Set<string> | null>
type Reader = (texts: Record<string, string>) => Promise<Found>

const SUPPORT = join(__dirname, 'support')

// The engine's deploy/compose.yaml hands the keys over the same way
const COMPOSE_FILE = `services:\n  probe:\n    image: busybox\n    environment:\n      G: \${${GEMINI}:-}\n      O: \${${OPENROUTER}:-}\n`

// What docker, pwsh and bash need to start. No other variable of this process reaches them, so a bare `NAME` line
// cannot pick up a value from here.
const TOOL_ENV = [
  'PATH',
  'SYSTEMROOT',
  'PROGRAMFILES',
  'PROGRAMDATA',
  'HOME',
  'USERPROFILE',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL'
]

const PARALLEL = 8
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function scratch(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `meridian-oracle-${name}-`))

  roots.push(root)

  return root
}

const toolEnv = () =>
  Object.fromEntries(Object.entries(process.env).filter(([name]) => TOOL_ENV.includes(name.toUpperCase())))

function which(name: string): string | null {
  const extensions = process.platform === 'win32' ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : ['']

  for (const folder of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(folder, name + extension.toLowerCase())

      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
    }
  }

  return null
}

/** Runs a command with only the tool environment; stdout comes back as text, stderr is dropped (it may hold a value). */
function run(command: string, args: string[], cwd?: string, timeout = 600_000) {
  return new Promise<{ status: number | null; stdout: string }>(done => {
    const child = spawn(command, args, { cwd, env: toolEnv(), stdio: ['ignore', 'pipe', 'ignore'], timeout })
    const chunks: Buffer[] = []

    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', () => done({ status: null, stdout: '' }))
    child.on('close', status => done({ status, stdout: Buffer.concat(chunks).toString('utf8') }))
  })
}

async function pool<T, R>(items: T[], each: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  await Promise.all(
    Array.from({ length: PARALLEL }, async () => {
      while (next < items.length) {
        const at = next++

        results[at] = await each(items[at]!)
      }
    })
  )

  return results
}

/** `docker compose config`, which hands the engine its keys. It only parses: nothing is pulled, built or started. */
async function composeReader(): Promise<Reader | string> {
  const docker = which('docker')

  if (!docker) return 'docker is not on PATH'
  const version = await run(docker, ['compose', 'version'], undefined, 60_000)

  if (version.status === null) return 'docker compose did not answer'
  if (version.status !== 0) return 'docker compose is not available'
  const folder = scratch('compose')

  writeFileSync(join(folder, 'compose.yaml'), COMPOSE_FILE)

  return async texts => {
    const labels = Object.keys(texts)

    const found = await pool(
      labels.map((label, at) => [label, at] as const),
      async ([label, at]) => {
        const envFile = join(folder, `${at}.env`)

        writeFileSync(envFile, Buffer.from(texts[label]!, 'utf8'))

        const args = [
          'compose',
          '-p',
          'meridian-guard-probe',
          '--env-file',
          envFile,
          '-f',
          join(folder, 'compose.yaml')
        ]

        const done = await run(docker, [...args, 'config', '--format', 'json'], folder)

        // compose refuses the file, so it would hand the engine nothing
        if (done.status !== 0) return null
        const environment = JSON.parse(done.stdout).services.probe.environment ?? {}

        const keys: [string, string][] = [
          ['G', GEMINI],
          ['O', OPENROUTER]
        ]

        return new Set(keys.filter(([key]) => environment[key]).map(([, name]) => name))
      }
    )

    return Object.fromEntries(labels.map((label, at) => [label, found[at] ?? null]))
  }
}

/** A copied local-up reader, run over every text in eight parallel batches. Two flags per file come back. */
function scriptReader(command: string[], name: string): Reader {
  const folder = scratch(name)

  return async texts => {
    const labels = Object.keys(texts)

    const outputs = await pool(
      Array.from({ length: PARALLEL }, (_, start) => start),
      async start => {
        const batch = join(folder, String(start))

        mkdirSync(batch)

        for (let at = start; at < labels.length; at += PARALLEL) {
          writeFileSync(join(batch, `${String(at).padStart(6, '0')}.env`), Buffer.from(texts[labels[at]!]!, 'utf8'))
        }

        const done = await run(command[0]!, [...command.slice(1), batch.replaceAll('\\', '/')])

        // not its output, which might hold a value
        if (done.status !== 0) throw new Error(`${name} reader failed`)

        return done.stdout
      }
    )

    const found: Found = {}

    for (const row of outputs.join('').split(/\r?\n/).filter(Boolean)) {
      const [stem, gemini, openrouter] = row.split('\t')

      const flags: [string, string | undefined][] = [
        [GEMINI, gemini],
        [OPENROUTER, openrouter]
      ]

      found[labels[Number(stem)]!] = new Set(flags.filter(([, flag]) => flag === '1').map(([key]) => key))
    }

    return found
  }
}

/** local-up.ps1's Get-EnvValue under pwsh, with its culture-sensitive StartsWith (ICU, the default culture). */
async function pwshReader(): Promise<Reader | string> {
  const pwsh = which('pwsh')

  if (!pwsh) return 'pwsh is not on PATH'

  return scriptReader([pwsh, '-NoProfile', '-NonInteractive', '-File', join(SUPPORT, 'get_env_value.ps1')], 'pwsh')
}

/** local-up.sh's env_value under bash. */
async function bashReader(): Promise<Reader | string> {
  const bash = which('bash')

  if (!bash) return 'bash is not on PATH'

  if (process.platform === 'win32' && isInside(process.env.SYSTEMROOT ?? 'C:\\Windows', bash)) {
    return 'the bash on PATH is the WSL launcher (as from PowerShell), which cannot read these Windows paths: run pnpm test:oracles from Git Bash'
  }

  return scriptReader([bash, join(SUPPORT, 'env_value.sh').replaceAll('\\', '/')], 'bash')
}

let allowed: Set<string> | null = null

/** The texts the guard lets a contract run start with, as the runtime's env file. */
function guardAllows(): Set<string> {
  if (allowed) return allowed
  const root = scratch('guard')
  const folder = join(root, 'Gaussian', 'MeridianEngine')

  mkdirSync(folder, { recursive: true })
  allowed = new Set()

  for (const [label, text] of Object.entries(differentialTexts())) {
    writeFileSync(join(folder, 'meridian-engine.env'), Buffer.from(text, 'utf8'))
    if (refusal({ LOCALAPPDATA: root }, { registry: () => ({}) }) === null) allowed.add(label)
  }

  return allowed
}

// What each reader must find, so one that reads nothing cannot pass. Compose takes '' as empty, matches a name
// without case and keeps the last line; both local-up readers keep '', match case and take the first line; pwsh
// splits lines at a lone CR, bash deletes it.
const ANCHORS: Record<string, Record<string, string[]>> = {
  compose: { 'r3-sq-G': [], '20-lower': [GEMINI], '08-after-multiline': [OPENROUTER], '19-first-empty': [GEMINI] },
  pwsh: { 'r3-sq-G': [GEMINI], '20-lower': [], '19-first-empty': [], '01-cr-after-eq': [] },
  bash: { 'r3-sq-G': [GEMINI], '20-lower': [], '19-first-empty': [], '01-cr-after-eq': [GEMINI] }
}

const READERS = { compose: composeReader, pwsh: pwshReader, bash: bashReader }

describeFake('contract guard: differential against compose and both local-up readers', () => {
  it.concurrent.for(Object.keys(READERS) as (keyof typeof READERS)[])(
    'whenever %s sets a paid key, the guard refuses',
    { timeout: 900_000 },
    async (name, ctx) => {
      const reader = await READERS[name]()

      if (typeof reader === 'string') return ctx.skip(reader)
      const texts = differentialTexts()
      const found = await reader(texts)
      const guard = guardAllows()

      expect(Object.keys(found).sort()).toEqual(Object.keys(texts).sort())
      const missed = [...guard].sort().flatMap(label => [...(found[label] ?? [])].sort().map(key => `${label}: ${key}`))

      expect(missed).toEqual([])

      const expected = ANCHORS[name]!
      const anchors = Object.fromEntries(Object.keys(expected).map(label => [label, [...(found[label] ?? [])].sort()]))

      expect(anchors).toEqual(expected)
      expect(Object.values(found).filter(names => names !== null).length).toBeGreaterThan(Object.keys(texts).length / 2)
    }
  )
})
