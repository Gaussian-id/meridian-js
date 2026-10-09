import { engineError, FAKE_INTEGRATOR_KEY, type AdminRouter, type Scripted } from './fake-engine'

interface Org {
  id: string
  name: string
  external_reference: string | null
}

interface Project {
  id: string
  org: string
  name: string
}

/** An in-memory admin API speaking the engine's wire shapes. */
export function createFakeAdmin(): AdminRouter {
  const orgs = new Map<string, Org>()
  const projects = new Map<string, Project>()
  const keys = new Map<string, { id: string; project_id: string; key_prefix: string; name: string | null }>()
  const models = new Map<string, string[]>()
  const credentials = new Map<string, { provider: string; hint: string; policy: 'prefer' | 'require' }>()
  let next = 0
  const id = (prefix: string) => `${prefix}_${++next}`
  const json = (status: number, value: unknown): Scripted => ({ status, json: value })

  return (request, payload) => {
    // [1] Every route needs the integrator credential
    if (request.headers.get('authorization') !== `Bearer ${FAKE_INTEGRATOR_KEY}`) return engineError('invalid_api_key')

    const path = new URL(request.url).pathname
    const parts = path.split('/').filter(Boolean)
    const body = payload ?? {}

    // [2] Organisations, with replay by external reference
    if (path === '/v1/orgs' && request.method === 'POST') {
      const reference = typeof body.external_reference === 'string' ? body.external_reference : null
      const existing = reference ? [...orgs.values()].find(org => org.external_reference === reference) : undefined

      if (existing) return json(200, existing)
      const org = { id: id('org'), name: String(body.name), external_reference: reference }

      orgs.set(org.id, org)

      return json(201, org)
    }

    if (path === '/v1/orgs' && request.method === 'GET') return json(200, [...orgs.values()])

    if (parts[2] === 'by-reference') {
      const org = [...orgs.values()].find(candidate => candidate.external_reference === decodeURIComponent(parts[3]!))

      return org ? json(200, org) : engineError('not_found')
    }

    const org = orgs.get(parts[2] ?? '')

    if (!org) return engineError('not_found')
    if (parts.length === 3 && request.method === 'GET') return json(200, org)

    // Organisation rename and delete are human-only on the engine: an integrator gets permission_denied
    if (parts.length === 3) return engineError('permission_denied')

    // [3] Provider credentials (BYOK): never echo the secret
    if (parts[3] === 'provider-credentials') {
      if (request.method === 'GET') return json(200, [...credentials.values()])
      const provider = parts[4]!

      if (request.method === 'DELETE') {
        credentials.delete(provider)

        return { status: 204 }
      }

      const record = {
        provider,
        hint: String(body.credential).slice(-4),
        policy: (body.policy ?? 'prefer') as 'prefer' | 'require'
      }

      credentials.set(provider, record)

      return json(200, record)
    }

    // [4] Projects, keys and project models
    if (parts[3] === 'projects' && parts.length === 4) {
      if (request.method === 'GET')
        return json(
          200,
          [...projects.values()].filter(project => project.org === org.id)
        )
      const project = { id: id('prj'), org: org.id, name: String(body.name) }

      projects.set(project.id, project)

      return json(201, project)
    }

    const project = projects.get(parts[4] ?? '')

    if (!project) return engineError('not_found')

    if (parts.length === 5) {
      if (request.method === 'DELETE') {
        projects.delete(project.id)

        return { status: 204 }
      }

      if (request.method === 'PATCH' && typeof body.name === 'string') project.name = body.name

      return json(200, project)
    }

    if (parts[5] === 'keys' && request.method === 'POST') {
      const key = { id: id('key'), project_id: project.id, key_prefix: 'gmr_abcd', name: (body.name as string) ?? null }

      keys.set(key.id, key)

      return {
        status: 201,
        headers: { 'cache-control': 'no-store' },
        json: { key_id: key.id, api_key: `gmr_${'a'.repeat(64)}`, key_prefix: key.key_prefix, message: 'shown once' }
      }
    }

    if (parts[5] === 'keys' && request.method === 'GET') {
      return json(
        200,
        [...keys.values()].filter(key => key.project_id === project.id)
      )
    }

    if (parts[5] === 'keys' && request.method === 'DELETE') {
      keys.delete(parts[6]!)

      return { status: 204 }
    }

    if (parts[5] === 'models') {
      if (request.method === 'PUT') models.set(project.id, body.models as string[])

      return json(200, { models: models.get(project.id) ?? [] })
    }

    return engineError('not_found')
  }
}
