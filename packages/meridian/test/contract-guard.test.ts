import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  isInside,
  isLoopbackUrl,
  paidKeysIn,
  paidKeysInEnviron,
  proxySchemes,
  readRegistryProxies,
  refusal,
  runtimeDir,
  type Environ,
  type RegistryEntries
} from '../../../scripts/contract-guard.mjs'
import { contractEngine, describeFake, testEngine } from './support/engine'
import {
  BOTH,
  GEMINI,
  HIDING,
  label,
  NOT_SET_FOR_ANY_READER,
  OPENROUTER,
  PRINTABLE,
  REVIEW_FIXTURES,
  TEXTS
} from './support/guard-texts'

const SECRET = 'v' + 'q'.repeat(24) // a stand-in value, built at run time; no message may ever contain it
const roots: string[] = []

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'meridian-guard-'))

  roots.push(root)

  return root
}

/** A runtime folder under a scratch LOCALAPPDATA, holding one env file. */
function runtimeWith(text = 'GAUSSMERIDIAN_DB_PASSWORD=x\n') {
  const root = scratch()
  const folder = join(root, 'Gaussian', 'MeridianEngine')

  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'meridian-engine.env'), text)

  return { environ: { LOCALAPPDATA: root } as Environ, folder, root }
}

/** The guard with no registry proxy: a test must not depend on this machine's registry. */
const judge = (environ: Environ, registry: RegistryEntries = {}) => refusal(environ, { registry: () => registry })

/** A directory link: a junction on Windows (no privilege needed), a symlink elsewhere. */
function link(target: string, at: string) {
  symlinkSync(target, at, process.platform === 'win32' ? 'junction' : 'dir')
}

describe('contract guard: the env file text', () => {
  it.each(TEXTS.map(([text, names], at) => ({ at, text, names })))('texts[$at]', ({ text, names }) => {
    expect(paidKeysIn(text)).toEqual(names)
  })

  it.each(HIDING.map(char => ({ name: label(char), char })))(
    '$name anywhere means neither name can be checked',
    ({ char }) => {
      expect(paidKeysIn(`A=1\n# a note${char}x\nB=2\n`)).toEqual(BOTH)
      expect(paidKeysIn(`${GEMINI}${char}=\n`)).toEqual(BOTH)
    }
  )

  it.each([...PRINTABLE].map(char => ({ name: label(char), char })))('$name does not stop the check', ({ char }) => {
    expect(paidKeysIn(`A=1${char}\n# a note ${char}\n${GEMINI}=\n`)).toEqual([])
    expect(paidKeysIn(`${GEMINI}=${char}\n`)).toEqual([GEMINI])
  })

  it('never returns a value', () => {
    const found = paidKeysIn(`${GEMINI}=${SECRET}\n${OPENROUTER}="${SECRET}"`)

    expect(found).toEqual([GEMINI, OPENROUTER])
    expect(JSON.stringify(found)).not.toContain(SECRET)
  })

  it.each(Object.keys(REVIEW_FIXTURES).sort())('reviewer probe %s is refused by name only', fixture => {
    const { environ, folder } = runtimeWith()
    const text = REVIEW_FIXTURES[fixture]!

    writeFileSync(join(folder, 'meridian-engine.env'), text)
    const message = judge(environ)

    if (NOT_SET_FOR_ANY_READER.has(fixture)) return expect(message).toBeNull()
    expect(message).toContain(text.includes(OPENROUTER) ? OPENROUTER : GEMINI)
    expect(message).not.toContain('FAKE')
  })

  it('cannot check a file with two byte order marks', () => {
    const { environ, folder } = runtimeWith()
    const bom = Buffer.from([0xef, 0xbb, 0xbf])

    writeFileSync(join(folder, 'meridian-engine.env'), Buffer.concat([bom, bom, Buffer.from(`${GEMINI}=\n`)]))
    expect(judge(environ)).toContain(GEMINI)
    writeFileSync(join(folder, 'meridian-engine.env'), Buffer.concat([bom, Buffer.from(`${GEMINI}=\n`)]))
    expect(judge(environ)).toBeNull()
  })
})

describe('contract guard: the process environment', () => {
  it('is judged by name and without case', () => {
    expect(paidKeysInEnviron({ gaussmeridian_gemini_api_key: 'x', [OPENROUTER]: '' })).toEqual([GEMINI])
    expect(paidKeysInEnviron({ [OPENROUTER]: ' ', [GEMINI]: 'x' })).toEqual([OPENROUTER, GEMINI])
    expect(paidKeysInEnviron({ GAUSSMERIDIAN_DB_PASSWORD: 'x', PATH: '/bin' })).toEqual([])
    expect(paidKeysInEnviron({})).toEqual([])
  })
})

describe('contract guard: loopback', () => {
  it.each([
    'http://127.0.0.1:8180',
    'http://127.0.0.1',
    'http://127.0.0.2:8181',
    'http://127.255.255.254/',
    'http://localhost:8181',
    'http://LocalHost:8181',
    'https://127.0.0.1:8180/ready',
    'http://[::1]:8180',
    'http://[::ffff:127.0.0.1]:8180',
    'http://[::ffff:7f00:1]:8180'
  ])('accepts %s', url => {
    expect(isLoopbackUrl(url)).toBe(true)
  })

  it.each([
    'http://127.0.0.1.evil.com',
    'http://localhost.evil.com',
    'http://localhost@evil.com',
    'http://127.0.0.1@evil.com',
    'http://127.0.0.1:80@evil.com',
    'http://evil.com@127.0.0.1',
    'http://user:pass@127.0.0.1:8180',
    'http://127.0.0.1\\@evil.com',
    'http://evil.com\\@127.0.0.1',
    'http://127.0.0.1 .evil.com',
    'http://127.0.0.1\n.evil.com',
    'http://127.0.0.1:8180\n',
    'http://127.0.0.1:8180\t',
    ' http://127.0.0.1:8180',
    'http://127.0.0.1:8180\x7f',
    'https://api.example.com',
    'http://0.0.0.0:8180',
    'http://[::]:8180',
    'http://10.0.0.5',
    'http://192.168.1.10:8180',
    'http://[::ffff:8.8.8.8]',
    'http://[::ffff:808:808]',
    'http://2130706433',
    'http://0x7f000001',
    'http://0x7f.0.0.1',
    'http://0177.0.0.1',
    'http://127.1',
    'http://127.0.0.1.',
    'http://localhost.',
    'http://localhost%2eevil.com',
    'http://[::1%25lo]:8180',
    'http://\uff11\uff12\uff17.0.0.1',
    'http://127.0.0.1:99999',
    'http://127.0.0.1:abc',
    'http://::1',
    'http://[::1',
    'ftp://127.0.0.1',
    'file:///etc/passwd',
    'localhost:8180',
    '//127.0.0.1:8180',
    '127.0.0.1',
    '',
    'not a url'
  ])('refuses %j', url => {
    expect(isLoopbackUrl(url)).toBe(false)
  })

  it('refuses a value that is not text', () => {
    expect(isLoopbackUrl(null)).toBe(false)
    expect(isLoopbackUrl(undefined)).toBe(false)
  })
})

describe('contract guard: containment', () => {
  it('resolves paths', () => {
    const root = scratch()
    const runtime = join(root, 'MeridianEngine')

    expect(isInside(runtime, join(runtime, 'meridian-engine.env'))).toBe(true)
    expect(isInside(runtime, join(runtime, 'a', '..', 'meridian-engine.env'))).toBe(true)
    expect(isInside(runtime, join(runtime, '..', 'elsewhere.env'))).toBe(false)
    expect(isInside(runtime, runtime)).toBe(false)
    expect(isInside(runtime, join(root, 'MeridianEngine2', 'x.env'))).toBe(false)
    expect(isInside(runtime, root)).toBe(false)
  })

  it('follows a link out of the folder', () => {
    const root = scratch()
    const runtime = join(root, 'MeridianEngine')
    const outside = join(root, 'outside')

    mkdirSync(runtime)
    mkdirSync(outside)
    link(outside, join(runtime, 'escape'))
    expect(isInside(runtime, join(runtime, 'escape', 'meridian-engine.env'))).toBe(false)
    expect(isInside(runtime, join(runtime, 'escape'))).toBe(false)
  })

  it('takes a link into the folder as inside', () => {
    const root = scratch()
    const runtime = join(root, 'MeridianEngine')

    mkdirSync(runtime)
    link(runtime, join(root, 'alias'))
    expect(isInside(runtime, join(root, 'alias', 'meridian-engine.env'))).toBe(true)
    expect(isInside(join(root, 'alias'), join(runtime, 'meridian-engine.env'))).toBe(true)
  })

  it.runIf(process.platform === 'win32')('ignores drive letter case and separators on Windows', () => {
    const root = scratch()
    const spelled = join(root, 'MeridianEngine')

    const drive = spelled.slice(0, 1)
    const swapped = (drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase()) + spelled.slice(1)

    mkdirSync(spelled)
    expect(isInside(swapped, spelled + '\\meridian-engine.env')).toBe(true)
    expect(isInside(spelled.replaceAll('\\', '/'), swapped + '\\a/b.env')).toBe(true)
    expect(isInside(spelled.toUpperCase(), spelled.toLowerCase() + '/x.env')).toBe(true)
    expect(isInside(spelled.replaceAll('\\', '/'), swapped + '\\..\\x.env')).toBe(false)

    // a folder that does not exist yet (a first run) is compared by spelling alone
    expect(isInside(join(root, 'Missing'), join(root, 'MISSING', 'x.env'))).toBe(true)
    expect(isInside(join(root, 'Missing'), join(root, 'MISSING'))).toBe(false)
  })

  it('takes an unresolvable path as outside', () => {
    const root = scratch()

    expect(isInside(root, join(root, 'x') + '\0')).toBe(false)
  })
})

describe('contract guard: the whole judgement', () => {
  it('allows a clean runtime', () => {
    expect(judge(runtimeWith().environ)).toBeNull()
  })

  it('finds the runtime folder the way the engine scripts do', () => {
    const root = scratch()

    expect(runtimeDir({ LOCALAPPDATA: root })).toBe(join(root, 'Gaussian', 'MeridianEngine'))
    expect(runtimeDir({ XDG_STATE_HOME: root })).toBe(join(root, 'gaussian', 'meridian-engine'))
    expect(runtimeDir({ HOME: root })).toBe(join(root, '.local', 'state', 'gaussian', 'meridian-engine'))
    expect(runtimeDir({ LOCALAPPDATA: join(root, 'a'), XDG_STATE_HOME: join(root, 'b') })).toBe(
      join(root, 'a', 'Gaussian', 'MeridianEngine')
    )
    expect(runtimeDir({})).toBeNull()
    expect(runtimeDir({ LOCALAPPDATA: '', HOME: '' })).toBeNull()
  })

  it('refuses an unknown runtime folder', () => {
    expect(judge({})).toContain('runtime')
  })

  it.each([GEMINI, OPENROUTER])('refuses %s in the env file by name', name => {
    const message = judge(runtimeWith(`A=1\r\nset ${name}=${SECRET}\r\n`).environ)

    expect(message).toContain(name)
    expect(message).not.toContain(SECRET)
  })

  it('refuses a paid key in the process environment by name', () => {
    const { environ } = runtimeWith()
    const message = judge({ ...environ, [GEMINI.toLowerCase()]: SECRET })

    expect(message).toContain(GEMINI)
    expect(message).not.toContain(SECRET)
    expect(judge({ ...environ, [OPENROUTER]: '' })).toBeNull()
  })

  it('names both sources together', () => {
    const { environ } = runtimeWith(`${OPENROUTER}=${SECRET}`)
    const message = judge({ ...environ, [GEMINI]: SECRET })

    expect(message).toContain(GEMINI)
    expect(message).toContain(OPENROUTER)
    expect(message).not.toContain(SECRET)
  })

  it('says a missing env file is missing', () => {
    const root = scratch()
    const folder = join(root, 'Gaussian', 'MeridianEngine')

    mkdirSync(folder, { recursive: true })
    const message = judge({ LOCALAPPDATA: root })

    expect(message).toContain('missing')
    expect(message).not.toContain('UTF-8')

    // the file the engine would read is the override when there is one
    writeFileSync(join(folder, 'meridian-engine.env'), 'A=1\n')
    expect(judge({ LOCALAPPDATA: root, GAUSSMERIDIAN_ENV_FILE: join(folder, 'nope.env') })).toContain('missing')
  })

  it('refuses an env file that cannot be read', () => {
    const root = scratch()
    const folder = join(root, 'Gaussian', 'MeridianEngine')

    mkdirSync(join(folder, 'meridian-engine.env'), { recursive: true }) // a directory cannot be read as text
    expect(judge({ LOCALAPPDATA: root })).toContain('cannot be read')
  })

  it.each([
    ['UTF-16', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${GEMINI}=${SECRET}\n`, 'utf16le')])],
    ['invalid UTF-8', Buffer.from([0x41, 0x3d, 0xff, 0xfe, 0x0a])],
    ['a NUL byte', Buffer.from('A=1\0\n')]
  ])('refuses an env file in %s', (_, raw) => {
    const { environ, folder } = runtimeWith()

    writeFileSync(join(folder, 'meridian-engine.env'), raw)
    const message = judge(environ)

    expect(message).not.toBeNull()
    expect(message).not.toContain(SECRET)
  })

  it('keeps an env file override in the runtime folder', () => {
    const { environ, folder, root } = runtimeWith()

    writeFileSync(join(folder, 'other.env'), 'A=1\n')
    expect(judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: join(folder, 'other.env') })).toBeNull()
    writeFileSync(join(root, 'clean.env'), 'A=1\n')

    for (const bad of [join(root, 'clean.env'), join(folder, '..', 'clean.env'), folder]) {
      expect(judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: bad })).toContain('GAUSSMERIDIAN_ENV_FILE')
    }
  })

  it('refuses an env file that links out of the folder', () => {
    const { environ, folder, root } = runtimeWith()

    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', 'clean.env'), 'A=1\n')
    link(join(root, 'outside'), join(folder, 'escape'))
    const message = judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: join(folder, 'escape', 'clean.env') })

    expect(message).toContain('GAUSSMERIDIAN_ENV_FILE')
  })

  it('keeps a runtime dir override in the runtime folder', () => {
    const { environ, folder, root } = runtimeWith()

    mkdirSync(join(folder, 'sub'))
    expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: folder })).toBeNull()
    expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'sub') })).toBeNull()
    mkdirSync(join(root, 'elsewhere'))
    writeFileSync(join(root, 'elsewhere', 'meridian-engine.env'), 'A=1\n')

    for (const bad of [join(root, 'elsewhere'), join(folder, '..'), join(folder, 'sub', '..', '..'), root]) {
      expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: bad })).toContain('MERIDIAN_RUNTIME_DIR')
    }
  })

  it('refuses a runtime dir that links out of the folder', () => {
    const { environ, folder, root } = runtimeWith()

    mkdirSync(join(root, 'outside'))
    link(join(root, 'outside'), join(folder, 'escape'))
    expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'escape') })).toContain('MERIDIAN_RUNTIME_DIR')
  })

  it("checks the engine's own env file whatever the runtime dir says", () => {
    // the engine scripts read <runtime>/meridian-engine.env; a clean decoy in a sub-folder must not hide it
    const { environ, folder } = runtimeWith(`${GEMINI}=${SECRET}`)

    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, 'sub', 'meridian-engine.env'), 'A=1\n')
    expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'sub') })).toContain(GEMINI)
  })

  it('checks the canonical env file when both overrides point at a clean decoy', () => {
    const { environ, folder } = runtimeWith(`${GEMINI}=${SECRET}`)

    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, 'sub', 'clean.env'), 'A=1\n')

    const message = judge({
      ...environ,
      MERIDIAN_RUNTIME_DIR: join(folder, 'sub'),
      GAUSSMERIDIAN_ENV_FILE: join(folder, 'sub', 'clean.env')
    })

    expect(message).toContain(GEMINI)
    expect(message).not.toContain(SECRET)
  })

  it('checks the canonical env file when only the env file points elsewhere', () => {
    const { environ, folder } = runtimeWith(`${OPENROUTER}=${SECRET}`)

    writeFileSync(join(folder, 'clean.env'), 'A=1\n')
    expect(judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: join(folder, 'clean.env') })).toContain(OPENROUTER)
  })

  it('reads an env file named by two spellings once, and an absent canonical one is fine', () => {
    const { environ, folder } = runtimeWith()

    expect(judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: join(folder, 'sub', '..', 'meridian-engine.env') })).toBeNull()
    unlinkSync(join(folder, 'meridian-engine.env'))
    writeFileSync(join(folder, 'clean.env'), 'A=1\n')
    expect(judge({ ...environ, GAUSSMERIDIAN_ENV_FILE: join(folder, 'clean.env') })).toBeNull()
  })

  it('checks an env file in the runtime dir override too', () => {
    const { environ, folder } = runtimeWith()

    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, 'sub', 'meridian-engine.env'), `${OPENROUTER}=${SECRET}`)
    expect(judge({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'sub') })).toContain(OPENROUTER)
  })

  it.for(['local-api-key.txt', 'local-integrator-key.txt'])('refuses %s linking out of the folder', (name, ctx) => {
    const { environ, folder, root } = runtimeWith()

    mkdirSync(join(root, 'outside'))
    writeFileSync(join(root, 'outside', name), 'k')
    expect(judge(environ)).toBeNull()

    try {
      symlinkSync(join(root, 'outside', name), join(folder, name), 'file')
    } catch {
      return ctx.skip('cannot create a file symlink here')
    }

    expect(judge(environ)).toContain(name)
  })

  it.each(['MERIDIAN_PUBLIC_URL', 'MERIDIAN_ADMIN_URL', 'MERIDIAN_URL'])(
    'refuses a non-loopback %s by variable name only',
    variable => {
      const { environ } = runtimeWith()

      for (const loopback of ['http://127.0.0.1:9999', 'http://localhost:1', 'http://[::1]:2']) {
        expect(judge({ ...environ, [variable]: loopback })).toBeNull()
      }

      const message = judge({ ...environ, [variable]: `http://user:${SECRET}@evil.example.com` })

      expect(message).toContain(variable)
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('evil.example.com')
    }
  )

  it('takes the default URLs as loopback, and a set but empty one as not', () => {
    const { environ } = runtimeWith()

    expect(judge(environ)).toBeNull()
    expect(judge({ ...environ, MERIDIAN_PUBLIC_URL: '' })).not.toBeNull()
  })
})

describe('contract guard: proxies', () => {
  it.each(['http_proxy', 'HTTP_PROXY', 'https_proxy', 'Https_Proxy', 'ALL_PROXY', 'all_proxy'])(
    'refuses %s in the environment by name only',
    name => {
      const message = judge({ ...runtimeWith().environ, [name]: `http://user:${SECRET}@proxy.example:3128` })

      expect(message).toContain('proxy')
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('proxy.example')
    }
  )

  it('takes an empty proxy variable or a bypass list as no proxy', () => {
    const { environ } = runtimeWith()

    expect(judge({ ...environ, HTTP_PROXY: '', all_proxy: '' })).toBeNull()
    expect(judge({ ...environ, NO_PROXY: '*', no_proxy: '127.0.0.1' })).toBeNull()
  })

  it.each(['http', 'https', 'all'])('refuses a registry %s proxy whatever the environment says', scheme => {
    const { environ } = runtimeWith()

    for (const extra of [{}, { no_proxy: 'localhost' }, { ftp_proxy: 'http://sys.example:21' }]) {
      const message = judge({ ...environ, ...extra }, { [scheme]: `http://u:${SECRET}@reg.example:8080` })

      expect(message).toContain(scheme)
      expect(message).not.toContain(SECRET)
      expect(message).not.toContain('reg.example')
    }
  })

  it.each<RegistryEntries>([
    { socks: 'socks://reg.example:1080' },
    { ftp: 'http://reg.example:21' },
    { gopher: 'reg.example:70' }
  ])('refuses any registry proxy entry (%j)', registry => {
    const { environ } = runtimeWith()
    const message = judge(environ, registry)

    expect(message).toContain('registry')
    expect(message).not.toContain('reg.example')
    expect(judge(environ, { socks: '' })).toBeNull()
  })

  it('refuses when the registry cannot be read', () => {
    const message = refusal(runtimeWith().environ, {
      registry: () => {
        throw new Error('no reg.exe')
      }
    })

    expect(message).toContain('registry')
  })

  it('only names schemes', () => {
    expect(proxySchemes({ HTTPS_PROXY: 'x' }, { http: 'y', socks: 'z' })).toEqual(['http', 'https', 'registry'])
    expect(proxySchemes({ FTP_PROXY: 'x', NO_PROXY: '*' }, {})).toEqual([])
  })
})

describe('contract guard: the Windows registry reader', () => {
  const INTERNET = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'

  /** A fake `reg query`: nothing of this machine's registry is read. */
  function reg(values: Record<string, [string, string]>) {
    const asked: string[][] = []

    const run = (command: string, args: string[]) => {
      asked.push([command, ...args])
      const name = args[3] ?? ''
      const value = values[name]

      if (!value) return { status: 1, stdout: '' }

      return { status: 0, stdout: `\r\n${INTERNET}\r\n    ${name}    ${value[0]}    ${value[1]}\r\n\r\n` }
    }

    return { run, asked }
  }

  it.each([
    ['socks=reg.example:1080', { socks: 'reg.example:1080' }],
    ['ftp=reg.example:21', { ftp: 'reg.example:21' }],
    ['reg.example:3128', { http: 'reg.example:3128', https: 'reg.example:3128', ftp: 'reg.example:3128' }],
    ['http=a:1;https=b:2', { http: 'a:1', https: 'b:2' }],
    ['http=a:1;bare:3', { http: 'a:1', registry: 'bare:3' }]
  ])('reads a proxy server entry %s', (server, entries) => {
    const { run } = reg({ ProxyEnable: ['REG_DWORD', '0x1'], ProxyServer: ['REG_SZ', server] })

    expect(readRegistryProxies(run, 'win32')).toEqual(entries)
    expect(judge(runtimeWith().environ, readRegistryProxies(run, 'win32'))).not.toContain('reg.example')
  })

  it('reads nothing when the proxy is off or absent, and never off Windows', () => {
    const off = reg({ ProxyEnable: ['REG_DWORD', '0x0'], ProxyServer: ['REG_SZ', 'reg.example:3128'] })

    expect(readRegistryProxies(off.run, 'win32')).toEqual({})
    expect(readRegistryProxies(reg({}).run, 'win32')).toEqual({})
    const linux = reg({ ProxyEnable: ['REG_DWORD', '0x1'], ProxyServer: ['REG_SZ', 'reg.example:3128'] })

    expect(readRegistryProxies(linux.run, 'linux')).toEqual({})
    expect(linux.asked).toEqual([])
  })

  it('throws when reg cannot be run', () => {
    expect(() => readRegistryProxies(() => ({ error: new Error('ENOENT'), status: null }), 'win32')).toThrow()
  })
})

describe('contract guard: the engine contract tests talk to', () => {
  it('meets the guard even without the script', () => {
    const { environ, folder } = runtimeWith(`${GEMINI}=${SECRET}`)

    writeFileSync(join(folder, 'local-api-key.txt'), 'gmr_' + '0'.repeat(64) + '\n')
    let message = ''

    try {
      contractEngine(environ, { registry: () => ({}) })
    } catch (error) {
      message = String(error)
    }

    expect(message).toContain(GEMINI)
    expect(message).not.toContain(SECRET)
  })

  it('reads its keys from the checked runtime dir', () => {
    const { environ, folder } = runtimeWith()
    const project = 'gmr_' + '2'.repeat(64)
    const integrator = 'gmi_' + '3'.repeat(64)

    mkdirSync(join(folder, 'sub'))
    writeFileSync(join(folder, 'sub', 'local-api-key.txt'), project + '\n')
    writeFileSync(join(folder, 'sub', 'local-integrator-key.txt'), integrator + '\n')
    const engine = contractEngine({ ...environ, MERIDIAN_RUNTIME_DIR: join(folder, 'sub') }, { registry: () => ({}) })

    expect([engine.projectKey, engine.integratorKey]).toEqual([project, integrator])
    expect([engine.publicUrl, engine.adminUrl]).toEqual(['http://127.0.0.1:8180', 'http://127.0.0.1:8181'])
    expect(engine.fake).toBeNull()
  })
})

// In process and fast; the child-vitest runs in both modes are in contract-mode.oracles.ts (pnpm test:oracles)
describe('contract guard: which tests may reach the engine helper', () => {
  it('fails an unmarked test that reaches it', () => {
    expect(() => testEngine()).toThrow('without describeFake or describeEngine')
  })

  describeFake('a marked suite', () => {
    it('gets the fake engine', () => {
      expect(testEngine().fake).not.toBeNull()
    })
  })
})
