// Which tests may meet a real engine. Each case runs vitest over a sample file in a scratch folder, with a scratch
// runtime whose env file names a paid key: nothing reads this machine's runtime, and no engine is contacted.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterAll, expect, it } from 'vitest'

import { COMMAND } from '../../../scripts/contract.mjs'
import { describeFake } from './support/engine'

const GEMINI = 'GAUSSMERIDIAN_GEMINI_API_KEY'
const SECRET = 'v' + 'q'.repeat(24)
const ENGINE = JSON.stringify(pathToFileURL(join(__dirname, 'support', 'engine.ts')).href)
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

const MARKED = `import { describeEngine, describeFake, testEngine } from ${ENGINE}

it('pure', () => {})

describeFake('scripted', () => {
  it('uses the fake engine', () => {
    if (testEngine().fake === null) throw new Error('not the fake')
  })
})

describeEngine('shared', () => {
  it('uses an engine', () => {
    testEngine()
  })
})
`

const ONLY_FAKE = `import { describeFake } from ${ENGINE}

it('pure', () => {})

describeFake('scripted', () => {
  it('would touch the network', () => {
    throw new Error('ran')
  })
})
`

const UNMARKED = `import { testEngine } from ${ENGINE}

it('pure', () => {})

it('unmarked engine user', () => {
  testEngine()
})
`

const UNMARKED_SUITE = `import { testEngine } from ${ENGINE}

describe('unmarked suite', () => {
  const engine = testEngine()

  it('uses it', () => {
    if (!engine) throw new Error('none')
  })
})
`

interface Result {
  status: number | null
  tests: Record<string, { status: string; message: string }>
  output: string
}

/** vitest, as the contract script runs it, over one sample file; the JSON report comes back by test name. */
function vitestOn(sample: string, contract: boolean): Result {
  const root = mkdtempSync(join(tmpdir(), 'meridian-mode-'))
  const runtime = join(root, 'Gaussian', 'MeridianEngine')

  roots.push(root)
  mkdirSync(runtime, { recursive: true })
  writeFileSync(join(runtime, 'meridian-engine.env'), `${GEMINI}=${SECRET}\n`)
  writeFileSync(join(root, 'sample.test.ts'), sample)
  writeFileSync(
    join(root, 'vitest.config.mjs'),
    "export default { test: { globals: true, include: ['sample.test.ts'], tags: [{ name: 'fake' }, { name: 'contract' }] } }\n"
  )

  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? '',
    SYSTEMROOT: process.env.SYSTEMROOT ?? '',
    TEMP: process.env.TEMP ?? tmpdir(),
    TMP: process.env.TMP ?? tmpdir(),
    LOCALAPPDATA: root
  }

  if (contract) env.MERIDIAN_CONTRACT = '1'
  const report = join(root, 'report.json')

  const args = [
    '--root',
    root,
    '--config',
    join(root, 'vitest.config.mjs'),
    '--reporter=json',
    `--outputFile=${report}`
  ]

  const done = spawnSync(COMMAND[0]!, [...COMMAND.slice(1), ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 120_000
  })

  const tests: Result['tests'] = {}

  try {
    const json = JSON.parse(readFileSync(report, 'utf8'))

    for (const file of json.testResults) {
      for (const test of file.assertionResults) {
        tests[test.title] = { status: test.status, message: (test.failureMessages ?? []).join('\n') }
      }

      if (file.message) tests['(file)'] = { status: 'failed', message: file.message }
    }
  } catch {
    // no report: the run failed before it could write one
  }

  return { status: done.status, tests, output: done.stdout + done.stderr }
}

describeFake('contract mode', () => {
  it('without the real engine, runs fake-only and shared tests against the fake engine', () => {
    const result = vitestOn(MARKED, false)

    expect(result.status).toBe(0)
    expect(Object.entries(result.tests).map(([name, { status }]) => [name, status])).toEqual([
      ['pure', 'passed'],
      ['uses the fake engine', 'passed'],
      ['uses an engine', 'passed']
    ])
  }, 120_000)

  it('against the real engine, deselects fake-only tests, and the shared ones meet the guard first', () => {
    const result = vitestOn(MARKED, true)

    expect(Object.keys(result.tests)).toEqual(['pure', 'uses an engine'])
    expect(result.tests.pure?.status).toBe('passed')
    expect(result.tests['uses an engine']?.status).toBe('failed')
    expect(result.tests['uses an engine']?.message).toContain(`Contract run refused: ${GEMINI} is set`)
    expect(result.output + JSON.stringify(result.tests)).not.toContain(SECRET)
  }, 120_000)

  it('against the real engine, never runs a fake-only test', () => {
    const result = vitestOn(ONLY_FAKE, true)

    expect(result.status).toBe(0)
    expect(result.tests).toEqual({ pure: { status: 'passed', message: '' } })
  }, 120_000)

  it('against the real engine, a file of fake-only tests is not a failure', () => {
    const result = vitestOn(ONLY_FAKE.replace("it('pure', () => {})\n", ''), true)

    expect(result.status).toBe(0)
    expect(result.tests).toEqual({})
  }, 120_000)

  it.for([false, true])(
    'fails an unmarked test that reaches the engine (contract mode: %s)',
    { timeout: 120_000 },
    contract => {
      const result = vitestOn(UNMARKED, contract)

      expect(result.status).toBe(1)
      expect(result.tests.pure?.status).toBe('passed')
      expect(result.tests['unmarked engine user']?.status).toBe('failed')
      expect(result.tests['unmarked engine user']?.message).toContain('without describeFake or describeEngine')
    }
  )

  it.for([false, true])(
    'fails an unmarked suite that reaches the engine (contract mode: %s)',
    { timeout: 120_000 },
    contract => {
      const result = vitestOn(UNMARKED_SUITE, contract)

      expect(result.status).toBe(1)
      expect(result.output + JSON.stringify(result.tests)).toContain('without describeFake or describeEngine')
      expect(result.output + JSON.stringify(result.tests)).not.toContain(SECRET)
    }
  )
})
