import { createRouteHandler } from '@gaussian-id/meridian-next'

export const { POST } = createRouteHandler({ authorize: () => true })
