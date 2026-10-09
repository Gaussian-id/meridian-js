/** Stands in for Nuxt's virtual `#imports` in unit tests. */
export const useRuntimeConfig = () => ({
  meridian: { url: process.env.NUXT_MERIDIAN_URL ?? '', key: process.env.NUXT_MERIDIAN_KEY ?? '' }
})
