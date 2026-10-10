import type { DockerRunner, Environ, RegistryEntries } from './contract-guard.mjs'

export const ROOT: string
export const COMMAND: string[]
export function readyEndpoint(publicUrl: string): string
export function engineReady(publicUrl: string): Promise<boolean>
export function main(
  environ?: Environ,
  options?: {
    ready?: (publicUrl: string) => Promise<boolean>
    runner?: (command: string[], options: { env: Environ; cwd: string }) => number | Promise<number>
    registry?: () => RegistryEntries
    docker?: DockerRunner
  }
): Promise<number>
