/** Unit tests replace expo/fetch; the type-check uses the real package. */
export const fetch: typeof globalThis.fetch = () =>
  Promise.reject(new Error('expo/fetch is not available in unit tests'))
