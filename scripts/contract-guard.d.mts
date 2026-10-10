export type Environ = Record<string, string | undefined>
export type RegistryEntries = Record<string, string>
export interface SpawnResult {
  error?: Error
  status: number | null
  stdout?: string
}

export const PAID_KEYS: string[]
export const KEY_FILES: string[]
export const ENV_FILE: string
export const DEFAULT_URLS: Record<'MERIDIAN_PUBLIC_URL' | 'MERIDIAN_ADMIN_URL', string>
export function paidKeysIn(text: string): string[]
export function paidKeysInEnviron(environ: Environ): string[]
export function isLoopbackUrl(value: unknown): boolean
export function isInside(parent: string, child: string): boolean
export function runtimeDir(environ: Environ): string | null
export function readRegistryProxies(
  run?: (command: string, args: string[], options: object) => SpawnResult,
  platform?: string
): RegistryEntries
export function proxySchemes(environ: Environ, entries: RegistryEntries): string[]
export type DockerRunner = (args: string[]) => SpawnResult
export const SIM_TEMPLATE: string
export function simulatorProof(environ: Environ, runtime: string, options?: { docker?: DockerRunner }): string | null
export function refusal(
  environ: Environ,
  options?: { registry?: () => RegistryEntries; docker?: DockerRunner }
): string | null
