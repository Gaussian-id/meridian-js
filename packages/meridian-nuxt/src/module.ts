import { addImports, createResolver, defineNuxtModule } from 'nuxt/kit'
import type { NuxtModule } from 'nuxt/schema'

/** Registers private runtime config for the server client and auto-imports useMeridian(). */
const meridianModule: NuxtModule<Record<string, unknown>> = defineNuxtModule({
  meta: { name: 'meridian-nuxt', configKey: 'meridian' },
  setup(_options, nuxt) {
    // [1] Private runtime config: NUXT_MERIDIAN_URL and NUXT_MERIDIAN_KEY, never sent to the browser
    nuxt.options.runtimeConfig.meridian = { url: '', key: '', ...(nuxt.options.runtimeConfig.meridian as object) }

    // [2] The browser client as a composable
    const resolver = createResolver(import.meta.url)

    addImports({ name: 'useMeridian', from: resolver.resolve('./composables') })
  }
})

export default meridianModule
