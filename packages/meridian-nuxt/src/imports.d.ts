/** Nuxt's virtual `#imports`, which only exists inside a Nuxt build; just what the server entry uses. */
declare module '#imports' {
  export function useRuntimeConfig(): Record<string, unknown>
}
